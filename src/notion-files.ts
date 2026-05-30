import * as fs from 'fs';
import type { NotionConfig, NotionBlock, BlockMap } from './types.js';
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

const BROWSER_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36';

// Notion-hosted file hosts whose sources must be proxy-resolved to be viewable.
const NOTION_FILE_HOST_RE = /(prod-files-secure|secure\.notion-static\.com|s3\.[a-z0-9-]+\.amazonaws\.com|file\.notion\.so)/i;

function cookieFor(config: NotionConfig): string {
  return `token_v2=${config.token}; notion_user_id=${config.userId}`;
}

// The inner S3 URL behind an image source, for the www.notion.so/image proxy.
// Returns null for external/non-notion sources (which are already viewable).
function innerS3Url(source: string, spaceId: string): string | null {
  if (source.startsWith('attachment:')) {
    const rest = source.slice('attachment:'.length);
    const sep = rest.indexOf(':');
    if (sep === -1) return null;
    const fileId = rest.slice(0, sep);
    const fname = rest.slice(sep + 1);
    return `https://prod-files-secure.s3.us-west-2.amazonaws.com/${spaceId}/${fileId}/${fname}`;
  }
  if (/^https?:\/\//i.test(source) && NOTION_FILE_HOST_RE.test(source)) return source;
  return null;
}

function proxyUrl(inner: string, blockId: string): string {
  return `https://www.notion.so/image/${encodeURIComponent(inner)}?table=block&id=${blockId}&cache=v2`;
}

// Resolve a notion-hosted source to a publicly-fetchable CDN url (or null).
async function resolveToCdnUrl(config: NotionConfig, source: string, blockId: string): Promise<string | null> {
  const inner = innerS3Url(source, config.spaceId);
  if (!inner) return null;
  const res = await fetch(proxyUrl(inner, blockId), {
    headers: { 'user-agent': BROWSER_UA, cookie: cookieFor(config), accept: 'image/*,*/*' },
    redirect: 'manual',
  });
  return res.headers.get('location');
}

// Rewrite image-block sources in the blockMap so they render in markdown.
// (Download mode is added in the next task.)
export async function resolveImages(
  config: NotionConfig,
  blockMap: BlockMap,
  _opts: { imageDir?: string } = {},
): Promise<{ resolved: number; failed: number }> {
  let resolved = 0;
  let failed = 0;
  for (const [blockId, entry] of Object.entries(blockMap)) {
    if (entry.value.type !== 'image') continue;
    const src = entry.value.properties?.source?.[0]?.[0];
    if (!src) continue;
    if (/^https?:\/\//i.test(src) && !NOTION_FILE_HOST_RE.test(src)) continue; // external → leave
    try {
      const cdn = await resolveToCdnUrl(config, src, blockId);
      if (!cdn) { failed++; continue; }
      entry.value.properties = { ...entry.value.properties, source: [[cdn]] };
      resolved++;
    } catch {
      failed++;
    }
  }
  return { resolved, failed };
}
