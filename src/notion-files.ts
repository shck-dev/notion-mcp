import * as fs from 'fs';
import type { NotionConfig } from './types.js';
import { notionPost } from './notion-client.js';

// Upload one local image to Notion. The image block MUST already exist — getUploadFileUrl
// validates the block's ancestor path (a missing/uncreated block → 400 incomplete_ancestor_path),
// so callers create the block first, then call this.
export async function uploadImageFile(
  config: NotionConfig,
  args: { blockId: string; localPath: string; name: string; contentType: string; bytes: number },
): Promise<{ source: string; size: string }> {
  const { blockId, localPath, name, contentType, bytes } = args;
  const up = await notionPost(config, 'getUploadFileUrl', {
    bucket: 'secure',
    name,
    contentType,
    record: { table: 'block', id: blockId, spaceId: config.spaceId },
    supportExtraHeaders: true,
    contentLength: bytes,
  });
  if (!up.signedPutUrl || !up.url) {
    throw new Error(`getUploadFileUrl returned no upload target for ${name}`);
  }
  // PUT must send exactly the headers Notion signed (Content-Length, x-amz-tagging);
  // omitting them yields 403 SignatureDoesNotMatch.
  const headers: Record<string, string> = {};
  for (const h of up.putHeaders ?? []) headers[h.name] = h.value;
  const fileBytes = fs.readFileSync(localPath);
  const res = await fetch(up.signedPutUrl, { method: 'PUT', headers, body: fileBytes });
  if (!res.ok) {
    throw new Error(`S3 upload failed for ${name} (${res.status}): ${(await res.text()).slice(0, 300)}`);
  }
  // up.url is already "attachment:<fileId>:<name>" — store it verbatim as the block source.
  return { source: up.url, size: String(bytes) };
}
