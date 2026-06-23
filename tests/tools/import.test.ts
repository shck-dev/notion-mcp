import { describe, test, expect, afterEach } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { buildCreateOps, appendMarkdownToPage } from '../../src/tools/import.js';
import type { NotionBlock } from '../../src/types.js';

describe('buildCreateOps', () => {
  test('emits set + listAfter + timestamp ops per block, never deletes', () => {
    const blocks: NotionBlock[] = [{ id: 'b1', type: 'text', properties: { title: [['hi']] } }];
    const ops = buildCreateOps('parent-1', blocks, 'space-1');

    const set = ops.find((o) => o.command === 'set' && o.id === 'b1');
    expect(set).toBeDefined();
    expect(set.args.parent_id).toBe('parent-1');
    expect(set.args.space_id).toBe('space-1');
    expect(set.args.alive).toBe(true);

    const listAfter = ops.find((o) => o.command === 'listAfter');
    expect(listAfter).toBeDefined();
    expect(listAfter.args.id).toBe('b1');

    expect(ops.some((o) => o.command === 'update' && o.args.last_edited_time)).toBe(true);
    expect(ops.some((o) => o.args && o.args.alive === false)).toBe(false);
  });

  test('propagates block.after into the listAfter op', () => {
    const blocks: NotionBlock[] = [
      { id: 'b1', type: 'text', properties: {}, after: 'existing-last' },
    ];
    const ops = buildCreateOps('parent-1', blocks, 'space-1');
    const listAfter = ops.find((o) => o.command === 'listAfter');
    expect(listAfter.args.after).toBe('existing-last');
  });

  test('emits child set + listAfter for nested children (table rows)', () => {
    const blocks: NotionBlock[] = [
      {
        id: 't1',
        type: 'table',
        properties: {},
        children: [{ id: 'r1', type: 'table_row', properties: {} }],
      },
    ];
    const ops = buildCreateOps('parent-1', blocks, 'space-1');
    const childSet = ops.find((o) => o.command === 'set' && o.id === 'r1');
    expect(childSet).toBeDefined();
    expect(childSet.args.parent_id).toBe('t1');
  });
});

describe('appendMarkdownToPage', () => {
  const realFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  test('appends after existing children without deleting them', async () => {
    const pageId = '30fbd879c5f080f8a88ac150e349d076';
    const uuid = '30fbd879-c5f0-80f8-a88a-c150e349d076';
    let submittedOps: any[] | null = null;

    globalThis.fetch = (async (url: any, init: any) => {
      const endpoint = String(url).split('/').pop();
      const body = JSON.parse(init.body);
      if (endpoint === 'syncRecordValues') {
        return new Response(
          JSON.stringify({
            recordMap: {
              block: {
                [uuid]: {
                  value: {
                    value: { id: uuid, type: 'page', alive: true, content: ['child-a', 'child-b'] },
                  },
                },
              },
            },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      if (endpoint === 'submitTransaction') {
        throw new Error('regression: submitTransaction was removed by Notion and must not be called');
      }
      if (endpoint === 'saveTransactionsFanout') {
        submittedOps = body.transactions[0].operations;
      }
      return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
    }) as typeof fetch;

    const result = await appendMarkdownToPage(
      { token: 'x', userId: 'u', spaceId: 's' },
      pageId,
      'one\ntwo',
    );

    expect(result).toContain('Appended');
    expect(submittedOps).not.toBeNull();
    // Ops reach the wire in the saveTransactionsFanout pointer shape.
    expect(submittedOps!.every((o) => o.pointer && o.pointer.spaceId === 's')).toBe(true);
    // Must NOT wipe existing content.
    expect(submittedOps!.some((o) => o.command === 'listRemove')).toBe(false);
    expect(submittedOps!.some((o) => o.args && o.args.alive === false)).toBe(false);
    // First new block is positioned after the last existing child.
    const firstListAfter = submittedOps!.find((o) => o.command === 'listAfter');
    expect(firstListAfter.args.after).toBe('child-b');
  });
});

describe('image write ordering (regression: upload must follow create)', () => {
  const realFetch = globalThis.fetch;
  afterEach(() => { globalThis.fetch = realFetch; });

  test('getUploadFileUrl is called AFTER the create transaction; source is patched', async () => {
    const tmp = path.join(os.tmpdir(), `imp-${crypto.randomUUID()}.png`);
    fs.writeFileSync(tmp, Buffer.from([1, 2, 3, 4]));
    const uuid = '30fbd879-c5f0-80f8-a88a-c150e349d076';
    const calls: string[] = [];
    let patchOps: any[] | null = null;

    globalThis.fetch = (async (url: any, init: any) => {
      const u = String(url);
      if (u.endsWith('/put')) { calls.push('S3PUT'); return new Response('', { status: 200 }); }
      const endpoint = u.split('/').pop()!;
      calls.push(endpoint);
      const body = init?.body ? JSON.parse(init.body) : {};
      if (endpoint === 'syncRecordValues') {
        return new Response(
          JSON.stringify({ recordMap: { block: { [uuid]: { value: { value: { id: uuid, type: 'page', alive: true, content: [] } } } } } }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      if (endpoint === 'getUploadFileUrl') {
        return new Response(
          JSON.stringify({ type: 'PUT', url: 'attachment:FID:imp.png', signedPutUrl: 'https://s3.example/put', putHeaders: [] }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      if (endpoint === 'saveTransactionsFanout') {
        const ops = body.transactions[0].operations;
        if (ops.some((o: any) => o.command === 'update' && o.args?.properties?.source)) patchOps = ops;
      }
      return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
    }) as typeof fetch;

    await appendMarkdownToPage({ token: 't', userId: 'u', spaceId: 's' }, uuid, `![](${tmp})`);
    fs.unlinkSync(tmp);

    expect(calls).not.toContain('submitTransaction'); // removed endpoint must never be used
    const firstCreate = calls.indexOf('saveTransactionsFanout');
    const upload = calls.indexOf('getUploadFileUrl');
    expect(firstCreate).toBeGreaterThanOrEqual(0);
    expect(upload).toBeGreaterThan(firstCreate); // the fix: upload AFTER create
    expect(calls.filter((c) => c === 'saveTransactionsFanout')).toHaveLength(2); // create + patch
    expect(calls).toContain('S3PUT');
    expect(patchOps).not.toBeNull();
    expect(patchOps!.some((o: any) => o.args.properties.source[0][0] === 'attachment:FID:imp.png')).toBe(true);
  });
});
