import { describe, test, expect, afterEach } from 'bun:test';
import { TOOLS } from '../../src/mcp-handler.js';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { addImageToPage } from '../../src/tools/images.js';

const uuid = '30fbd879-c5f0-80f8-a88a-c150e349d076';

function mockPage(extra: (endpoint: string, body: any) => Response | null) {
  globalThis.fetch = (async (url: any, init: any) => {
    const u = String(url);
    if (u.endsWith('/put')) return new Response('', { status: 200 });
    const endpoint = u.split('/').pop()!;
    const body = init?.body ? JSON.parse(init.body) : {};
    if (endpoint === 'syncRecordValues') {
      return new Response(
        JSON.stringify({ recordMap: { block: { [uuid]: { value: { value: { id: uuid, type: 'page', alive: true, content: ['c1'] } } } } } }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }
    return extra(endpoint, body) ?? new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
}

describe('addImageToPage', () => {
  const realFetch = globalThis.fetch;
  afterEach(() => { globalThis.fetch = realFetch; });

  test('local file: create empty block, upload, patch source (2 transactions, no deletes)', async () => {
    const tmp = path.join(os.tmpdir(), `add-${crypto.randomUUID()}.png`);
    fs.writeFileSync(tmp, Buffer.from([1, 2, 3]));
    const ops: any[][] = [];
    mockPage((endpoint, body) => {
      if (endpoint === 'getUploadFileUrl') {
        return new Response(
          JSON.stringify({ type: 'PUT', url: 'attachment:F:add.png', signedPutUrl: 'https://s3.example/put', putHeaders: [] }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      if (endpoint === 'submitTransaction') ops.push(body.transactions[0].operations);
      return null;
    });

    const res = await addImageToPage({ token: 't', userId: 'u', spaceId: 's' }, uuid, tmp);
    fs.unlinkSync(tmp);

    expect(res).toContain('Uploaded image');
    expect(ops).toHaveLength(2);
    const flat = ops.flat();
    expect(flat.some((o) => o.command === 'listRemove')).toBe(false);
    expect(flat.some((o) => o.args && o.args.alive === false)).toBe(false);
    expect(ops[1].some((o: any) => o.args?.properties?.source?.[0]?.[0] === 'attachment:F:add.png')).toBe(true);
  });

  test('http url: single transaction, external reference, no upload', async () => {
    let uploadCalled = false;
    const ops: any[][] = [];
    mockPage((endpoint, body) => {
      if (endpoint === 'getUploadFileUrl') uploadCalled = true;
      if (endpoint === 'submitTransaction') ops.push(body.transactions[0].operations);
      return null;
    });

    const res = await addImageToPage({ token: 't', userId: 'u', spaceId: 's' }, uuid, 'https://example.com/x.png');

    expect(res).toContain('external image');
    expect(uploadCalled).toBe(false);
    expect(ops).toHaveLength(1);
    expect(ops[0].some((o: any) => o.args?.properties?.source?.[0]?.[0] === 'https://example.com/x.png')).toBe(true);
  });
});

describe('notion_add_image registration', () => {
  test('is listed with the expected schema', () => {
    const tool = TOOLS.find((t) => t.name === 'notion_add_image');
    expect(tool).toBeDefined();
    expect(tool!.inputSchema.required).toContain('page_id');
    expect(tool!.inputSchema.required).toContain('image_path');
    expect(Object.keys(tool!.inputSchema.properties)).toContain('caption');
  });
});
