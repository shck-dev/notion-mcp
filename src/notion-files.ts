import * as fs from 'fs';
import type { NotionConfig, NotionBlock } from './types.js';
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

// Upload every block carrying an imageUpload, patching it in place with its attachment
// source + display format, and clearing imageUpload. Returns the patched image blocks.
export async function uploadImagesForBlocks(
  config: NotionConfig,
  blocks: NotionBlock[],
): Promise<NotionBlock[]> {
  const uploaded: NotionBlock[] = [];
  for (const b of blocks) {
    if (!b.imageUpload) continue;
    const { localPath, name, contentType, bytes } = b.imageUpload;
    const { source, size } = await uploadImageFile(config, { blockId: b.id, localPath, name, contentType, bytes });
    b.properties = { ...b.properties, source: [[source]], size: [[size]] };
    b.format = { ...(b.format ?? {}), display_source: source, block_width: 900, block_preserve_scale: true };
    delete b.imageUpload;
    uploaded.push(b);
  }
  return uploaded;
}

// Build submitTransaction `update` ops that write each already-uploaded image block's
// source/size/format. Runs as a second transaction, after the create transaction.
export function buildImagePatchOps(blocks: NotionBlock[]): any[] {
  return blocks.map((b) => ({
    id: b.id,
    table: 'block',
    path: [],
    command: 'update',
    args: { properties: b.properties, ...(b.format ? { format: b.format } : {}) },
  }));
}
