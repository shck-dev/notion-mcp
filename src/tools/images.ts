import * as fs from 'fs';
import * as path from 'path';
import type { NotionConfig, NotionBlock } from '../types.js';
import { parsePageId } from '../notion-client.js';
import { richText, inferImageContentType } from '../markdown/to-notion.js';
import { loadAlivePageBlock, submitOps, buildCreateOps } from './import.js';
import { uploadImageFile, buildImagePatchOps } from '../notion-files.js';

// Append a single image to the end of a page. Local file → upload; http(s) URL → external ref.
export async function addImageToPage(
  config: NotionConfig,
  pageId: string,
  imagePath: string,
  caption?: string,
): Promise<string> {
  const id = parsePageId(pageId);
  const pageBlock = await loadAlivePageBlock(config, id);
  const existing: string[] = pageBlock.content ?? [];
  const after = existing.length ? existing[existing.length - 1] : undefined;
  const blockId = crypto.randomUUID();
  const captionProp = caption ? { caption: richText(caption) } : {};

  if (/^https?:\/\//i.test(imagePath)) {
    const block: NotionBlock = {
      id: blockId,
      type: 'image',
      after,
      properties: { source: [[imagePath]], ...captionProp },
      format: { display_source: imagePath, block_width: 900, block_preserve_scale: true },
    };
    await submitOps(config, buildCreateOps(id, [block], config.spaceId));
    return `Added external image to page ${id}.`;
  }

  const stat = fs.statSync(imagePath); // throws ENOENT for a missing file
  const name = path.basename(imagePath);
  const contentType = inferImageContentType(imagePath);

  // Create the empty image block first so getUploadFileUrl has a valid ancestor path.
  const empty: NotionBlock = { id: blockId, type: 'image', after, properties: { ...captionProp } };
  await submitOps(config, buildCreateOps(id, [empty], config.spaceId));

  const { source, size } = await uploadImageFile(config, { blockId, localPath: imagePath, name, contentType, bytes: stat.size });
  const patched: NotionBlock = {
    id: blockId,
    type: 'image',
    properties: { source: [[source]], size: [[size]], ...captionProp },
    format: { display_source: source, block_width: 900, block_preserve_scale: true },
  };
  await submitOps(config, buildImagePatchOps([patched]));
  return `Uploaded image "${name}" (${stat.size} bytes) to page ${id}.`;
}
