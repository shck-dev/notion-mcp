import { describe, test, expect, afterEach } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { uploadImageFile } from '../src/notion-files.js';

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
