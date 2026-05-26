import { describe, test, expect, afterEach } from 'bun:test';
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
    // Must NOT wipe existing content.
    expect(submittedOps!.some((o) => o.command === 'listRemove')).toBe(false);
    expect(submittedOps!.some((o) => o.args && o.args.alive === false)).toBe(false);
    // First new block is positioned after the last existing child.
    const firstListAfter = submittedOps!.find((o) => o.command === 'listAfter');
    expect(firstListAfter.args.after).toBe('child-b');
  });
});
