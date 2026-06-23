import { describe, test, expect, afterEach } from 'bun:test';
import { parsePageId, notionPost, saveTransactions } from '../src/notion-client.js';

describe('parsePageId', () => {
  test('32-char hex → UUID conversion', () => {
    expect(parsePageId('30fbd879c5f080f8a88ac150e349d076')).toBe(
      '30fbd879-c5f0-80f8-a88a-c150e349d076'
    );
  });

  test('UUID passthrough', () => {
    expect(parsePageId('30fbd879-c5f0-80f8-a88a-c150e349d076')).toBe(
      '30fbd879-c5f0-80f8-a88a-c150e349d076'
    );
  });

  test('hex embedded in Notion URL', () => {
    expect(
      parsePageId('https://www.notion.so/My-Page-30fbd879c5f080f8a88ac150e349d076')
    ).toBe('30fbd879-c5f0-80f8-a88a-c150e349d076');
  });

  test('hex embedded in Notion URL with query params', () => {
    expect(
      parsePageId('https://www.notion.so/workspace/30fbd879c5f080f8a88ac150e349d076?v=abc')
    ).toBe('30fbd879-c5f0-80f8-a88a-c150e349d076');
  });

  test('invalid input throws', () => {
    expect(() => parsePageId('not-a-page-id')).toThrow('Invalid page ID');
  });

  test('empty input throws', () => {
    expect(() => parsePageId('')).toThrow('Invalid page ID');
  });

  test('too short hex throws', () => {
    expect(() => parsePageId('30fbd879c5f0')).toThrow('Invalid page ID');
  });
});

describe('notionPost auth errors', () => {
  const realFetch = globalThis.fetch;
  const cfg = { token: 'x', userId: 'u', spaceId: 's' };

  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  test('HTTP 401 throws token_v2 refresh guidance', async () => {
    globalThis.fetch = (async () => new Response('nope', { status: 401 })) as typeof fetch;
    await expect(notionPost(cfg, 'syncRecordValues', {})).rejects.toThrow(/token_v2/);
  });

  test('200 UnauthorizedError envelope throws token_v2 refresh guidance', async () => {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ name: 'UnauthorizedError' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })) as typeof fetch;
    await expect(notionPost(cfg, 'syncRecordValues', {})).rejects.toThrow(/token_v2/);
  });
});

describe('saveTransactions (saveTransactionsFanout migration)', () => {
  const realFetch = globalThis.fetch;
  const cfg = { token: 't', userId: 'u', spaceId: 'space-123' };

  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  function capture() {
    const seen: { url: string; headers: Record<string, string>; body: any }[] = [];
    globalThis.fetch = (async (url: any, init: any) => {
      seen.push({ url: String(url), headers: init?.headers ?? {}, body: JSON.parse(init.body) });
      return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
    }) as typeof fetch;
    return seen;
  }

  test('posts to saveTransactionsFanout, never the removed submitTransaction endpoint', async () => {
    const seen = capture();
    await saveTransactions(cfg, [
      { id: 'b1', table: 'block', path: [], command: 'set', args: { type: 'text' } },
    ]);
    expect(seen).toHaveLength(1);
    expect(seen[0].url).toContain('/saveTransactionsFanout');
    expect(seen[0].url).not.toContain('submitTransaction');
  });

  test('wraps each op in pointer {table, id, spaceId} and preserves command/path/args', async () => {
    const seen = capture();
    await saveTransactions(cfg, [
      { id: 'b1', table: 'block', path: [], command: 'set', args: { type: 'text', id: 'b1' } },
      { id: 'parent', table: 'block', path: ['content'], command: 'listAfter', args: { id: 'b1' } },
    ]);
    const ops = seen[0].body.transactions[0].operations;
    expect(ops).toHaveLength(2);

    expect(ops[0].pointer).toEqual({ table: 'block', id: 'b1', spaceId: 'space-123' });
    expect(ops[0].command).toBe('set');
    expect(ops[0].path).toEqual([]);
    expect(ops[0].args).toEqual({ type: 'text', id: 'b1' });
    // The legacy top-level id/table must not leak into the new op shape.
    expect(ops[0].id).toBeUndefined();
    expect(ops[0].table).toBeUndefined();

    expect(ops[1].pointer).toEqual({ table: 'block', id: 'parent', spaceId: 'space-123' });
    expect(ops[1].command).toBe('listAfter');
    expect(ops[1].path).toEqual(['content']);
    expect(ops[1].args).toEqual({ id: 'b1' });
  });

  test('preserves non-block pointer tables (comment / discussion)', async () => {
    const seen = capture();
    await saveTransactions(cfg, [
      { id: 'c1', table: 'comment', path: [], command: 'set', args: {} },
      { id: 'd1', table: 'discussion', path: [], command: 'set', args: {} },
    ]);
    const ops = seen[0].body.transactions[0].operations;
    expect(ops[0].pointer.table).toBe('comment');
    expect(ops[1].pointer.table).toBe('discussion');
  });

  test('sends transaction-level spaceId + a requestId, and the x-notion-space-id header', async () => {
    const seen = capture();
    await saveTransactions(cfg, [
      { id: 'b1', table: 'block', path: [], command: 'set', args: {} },
    ]);
    const tx = seen[0].body.transactions[0];
    expect(tx.spaceId).toBe('space-123');
    expect(typeof seen[0].body.requestId).toBe('string');
    expect(seen[0].body.requestId.length).toBeGreaterThan(0);
    expect(seen[0].headers['x-notion-space-id']).toBe('space-123');
  });

  test('a 404 on the transaction endpoint surfaces an actionable error', async () => {
    globalThis.fetch = (async () =>
      new Response('Cannot POST /api/v3/saveTransactionsFanout', { status: 404 })) as typeof fetch;
    await expect(
      saveTransactions(cfg, [{ id: 'b1', table: 'block', path: [], command: 'set', args: {} }]),
    ).rejects.toThrow(/transaction endpoint/i);
  });
});
