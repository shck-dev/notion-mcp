import { describe, test, expect, afterEach } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { uploadImageFile } from '../src/notion-files.js';
import { uploadImagesForBlocks, buildImagePatchOps } from '../src/notion-files.js';
import { resolveImages } from '../src/notion-files.js';

describe('uploadImageFile', () => {
  const realFetch = globalThis.fetch;
  afterEach(() => { globalThis.fetch = realFetch; });

  test('requests upload URL with the right body, then PUTs with putHeaders', async () => {
    const tmp = path.join(os.tmpdir(), `img-${crypto.randomUUID()}.png`);
    fs.writeFileSync(tmp, Buffer.from([1, 2, 3, 4, 5]));
    let getBody: any = null;
    let putHeaders: any = null;
    let putLen = -1;

    globalThis.fetch = (async (url: any, init: any) => {
      const u = String(url);
      if (u.endsWith('/getUploadFileUrl')) {
        getBody = JSON.parse(init.body);
        return new Response(
          JSON.stringify({
            type: 'PUT',
            url: 'attachment:FID-1:img.png',
            signedPutUrl: 'https://prod-files-secure.s3.us-west-2.amazonaws.com/put?sig=1',
            putHeaders: [
              { name: 'Content-Length', value: '5' },
              { name: 'x-amz-tagging', value: 'source=UserUpload' },
            ],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      putHeaders = init.headers;
      putLen = init.body.length ?? init.body.byteLength;
      return new Response('', { status: 200 });
    }) as typeof fetch;

    const res = await uploadImageFile(
      { token: 't', userId: 'u', spaceId: 'sp' },
      { blockId: 'B1', localPath: tmp, name: 'img.png', contentType: 'image/png', bytes: 5 },
    );
    fs.unlinkSync(tmp);

    expect(res).toEqual({ source: 'attachment:FID-1:img.png', size: '5' });
    expect(getBody.record.id).toBe('B1');
    expect(getBody.record.spaceId).toBe('sp');
    expect(getBody.contentLength).toBe(5);
    expect(getBody.supportExtraHeaders).toBe(true);
    expect(putHeaders['x-amz-tagging']).toBe('source=UserUpload');
    expect(putLen).toBe(5);
  });

  test('throws a clear error when S3 rejects the PUT', async () => {
    const tmp = path.join(os.tmpdir(), `img-${crypto.randomUUID()}.png`);
    fs.writeFileSync(tmp, Buffer.from([9]));
    globalThis.fetch = (async (url: any) => {
      if (String(url).endsWith('/getUploadFileUrl')) {
        return new Response(
          JSON.stringify({ type: 'PUT', url: 'attachment:F:img.png', signedPutUrl: 'https://s3/put', putHeaders: [] }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      return new Response('AccessDenied', { status: 403 });
    }) as typeof fetch;

    await expect(
      uploadImageFile({ token: 't', userId: 'u', spaceId: 'sp' }, { blockId: 'B', localPath: tmp, name: 'img.png', contentType: 'image/png', bytes: 1 }),
    ).rejects.toThrow('S3 upload failed');
    fs.unlinkSync(tmp);
  });
});

describe('uploadImagesForBlocks + buildImagePatchOps', () => {
  const realFetch = globalThis.fetch;
  afterEach(() => { globalThis.fetch = realFetch; });

  test('uploads only imageUpload blocks, patches them in place, builds update ops', async () => {
    const tmp = path.join(os.tmpdir(), `b-${crypto.randomUUID()}.png`);
    fs.writeFileSync(tmp, Buffer.from([1, 2, 3]));
    globalThis.fetch = (async (url: any) => {
      if (String(url).endsWith('/getUploadFileUrl')) {
        return new Response(
          JSON.stringify({ type: 'PUT', url: 'attachment:F9:b.png', signedPutUrl: 'https://s3/put', putHeaders: [] }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      return new Response('', { status: 200 });
    }) as typeof fetch;

    const blocks: any[] = [
      { id: 'T1', type: 'text', properties: { title: [['hi']] } },
      { id: 'I1', type: 'image', properties: {}, imageUpload: { localPath: tmp, name: 'b.png', contentType: 'image/png', bytes: 3 } },
    ];
    const uploaded = await uploadImagesForBlocks({ token: 't', userId: 'u', spaceId: 'sp' }, blocks);
    fs.unlinkSync(tmp);

    expect(uploaded.map((b) => b.id)).toEqual(['I1']);
    expect(blocks[1].imageUpload).toBeUndefined();
    expect(blocks[1].properties.source).toEqual([['attachment:F9:b.png']]);
    expect(blocks[1].format.display_source).toBe('attachment:F9:b.png');

    const ops = buildImagePatchOps(uploaded);
    expect(ops).toHaveLength(1);
    expect(ops[0]).toMatchObject({ id: 'I1', table: 'block', command: 'update' });
    expect(ops[0].args.properties.source).toEqual([['attachment:F9:b.png']]);
    expect(ops[0].args.format.display_source).toBe('attachment:F9:b.png');
  });
});

describe('resolveImages — signed URL (CDN) mode', () => {
  const realFetch = globalThis.fetch;
  afterEach(() => { globalThis.fetch = realFetch; });

  test('rewrites an attachment source to the CDN url from the proxy 302', async () => {
    let requested = '';
    globalThis.fetch = (async (url: any) => {
      requested = String(url);
      return new Response(null, { status: 302, headers: { location: 'https://img.notionusercontent.com/s3/abc?sig=1' } });
    }) as typeof fetch;

    const blockMap: any = { B1: { value: { id: 'B1', type: 'image', properties: { source: [['attachment:FID:p.png']] } } } };
    const r = await resolveImages({ token: 't', userId: 'u', spaceId: 'SP' }, blockMap);

    expect(r).toEqual({ resolved: 1, failed: 0 });
    expect(blockMap.B1.value.properties.source).toEqual([['https://img.notionusercontent.com/s3/abc?sig=1']]);
    expect(requested).toContain('https://www.notion.so/image/');
    expect(requested).toContain('table=block&id=B1');
  });

  test('leaves external (non-notion) image sources untouched', async () => {
    let called = false;
    globalThis.fetch = (async () => { called = true; return new Response(null, { status: 302, headers: { location: 'x' } }); }) as typeof fetch;

    const blockMap: any = { B1: { value: { id: 'B1', type: 'image', properties: { source: [['https://example.com/a.png']] } } } };
    const r = await resolveImages({ token: 't', userId: 'u', spaceId: 'SP' }, blockMap);

    expect(called).toBe(false);
    expect(r).toEqual({ resolved: 0, failed: 0 });
    expect(blockMap.B1.value.properties.source).toEqual([['https://example.com/a.png']]);
  });
});
