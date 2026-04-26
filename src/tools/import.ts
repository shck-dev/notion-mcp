import * as fs from 'fs';
import * as path from 'path';
import type { NotionConfig, NotionRawBlock } from '../types.js';
import { notionPost, parsePageId, unwrapRecord } from '../notion-client.js';
import { markdownToNotionBlocks } from '../markdown/to-notion.js';

export async function importMarkdownToPage(
  config: NotionConfig,
  pageId: string,
  markdown: string,
  baseDir?: string,
): Promise<string> {
  const id = parsePageId(pageId);

  // 1. Get full page record using syncRecordValues (non-cached, reliable)
  const syncData = await notionPost(config, 'syncRecordValues', {
    requests: [{ pointer: { table: 'block', id }, version: -1 }],
  });

  const pageBlock = unwrapRecord<NotionRawBlock>(syncData.recordMap?.block?.[id]);
  if (!pageBlock) throw new Error(`Page ${id} not found`);
  if ((pageBlock as any).alive === false) {
    throw new Error(`Page ${id} is archived/trashed. Restore it before importing — writes to archived pages are silently invisible.`);
  }

  const existingChildren: string[] = pageBlock.content ?? [];

  // 2. Delete all existing children in a separate transaction
  if (existingChildren.length > 0) {
    const deleteOps: any[] = [];
    for (const childId of existingChildren) {
      deleteOps.push({
        id: childId,
        table: 'block',
        path: [],
        command: 'update',
        args: { alive: false },
      });
      deleteOps.push({
        id,
        table: 'block',
        path: ['content'],
        command: 'listRemove',
        args: { id: childId },
      });
    }

    await notionPost(config, 'submitTransaction', {
      requestId: crypto.randomUUID(),
      transactions: [{ id: crypto.randomUUID(), spaceId: config.spaceId, operations: deleteOps }],
    });

    // Let Notion process the deletion
    await new Promise((r) => setTimeout(r, 500));
  }

  // 3. Convert markdown to Notion blocks
  const newBlocks = markdownToNotionBlocks(markdown, id, baseDir);

  if (!baseDir) {
    for (const b of newBlocks) {
      if (b.imageUpload && !path.isAbsolute(b.imageUpload.localPath)) {
        throw new Error(
          `Markdown references a relative local image (${b.imageUpload.localPath}) but no file context is available. Use notion_import_page_from_file or pass an absolute path.`,
        );
      }
    }
  }

  // 3b. Upload any local images and patch the blocks with attachment URLs.
  for (const block of newBlocks) {
    if (!block.imageUpload) continue;
    const { localPath, name, contentType, bytes } = block.imageUpload;
    // record.id MUST be the image block's own UUID, not the page id — otherwise
    // Notion later returns 400 "user doesn't have access" when rendering.
    const uploadResp = await notionPost(config, 'getUploadFileUrl', {
      bucket: 'secure',
      name,
      contentType,
      record: { table: 'block', id: block.id, spaceId: config.spaceId },
    });
    const url: string = uploadResp.url;
    const signedPutUrl: string = uploadResp.signedPutUrl;

    const fileBytes = fs.readFileSync(localPath);
    const putRes = await fetch(signedPutUrl, {
      method: 'PUT',
      headers: { 'Content-Type': contentType },
      body: fileBytes,
    });
    if (!putRes.ok) {
      const text = await putRes.text();
      throw new Error(`S3 upload failed for ${name} (${putRes.status}): ${text.slice(0, 300)}`);
    }

    block.properties = { source: [[url]], size: [[String(bytes)]] };
    block.format = { display_source: url, block_width: 900, block_preserve_scale: true };
    delete block.imageUpload;
  }

  // 4. Create new blocks in a separate transaction
  const createOps: any[] = [];
  for (const block of newBlocks) {
    const blockArgs: Record<string, any> = {
      type: block.type,
      id: block.id,
      parent_id: id,
      parent_table: 'block',
      alive: true,
      properties: block.properties,
      space_id: config.spaceId,
    };
    if (block.format) {
      blockArgs.format = block.format;
    }
    createOps.push({
      id: block.id,
      table: 'block',
      path: [],
      command: 'set',
      args: blockArgs,
    });
    createOps.push({
      id,
      table: 'block',
      path: ['content'],
      command: 'listAfter',
      args: { id: block.id, ...(block.after ? { after: block.after } : {}) },
    });
    createOps.push({
      id: block.id,
      table: 'block',
      path: [],
      command: 'update',
      args: { created_time: Date.now(), last_edited_time: Date.now() },
    });

    // Handle children (e.g. table_row blocks inside table)
    if (block.children) {
      for (const child of block.children) {
        createOps.push({
          id: child.id,
          table: 'block',
          path: [],
          command: 'set',
          args: {
            type: child.type,
            id: child.id,
            parent_id: block.id,
            parent_table: 'block',
            alive: true,
            properties: child.properties,
            space_id: config.spaceId,
          },
        });
        createOps.push({
          id: block.id,
          table: 'block',
          path: ['content'],
          command: 'listAfter',
          args: { id: child.id, ...(child.after ? { after: child.after } : {}) },
        });
      }
    }
  }

  await notionPost(config, 'submitTransaction', {
    requestId: crypto.randomUUID(),
    transactions: [{ id: crypto.randomUUID(), spaceId: config.spaceId, operations: createOps }],
  });

  return `Updated page with ${newBlocks.length} blocks. Removed ${existingChildren.length} old blocks.`;
}

export async function importMarkdownFromFile(
  config: NotionConfig,
  pageId: string,
  filePath: string,
): Promise<string> {
  const md = fs.readFileSync(filePath, 'utf-8');
  return importMarkdownToPage(config, pageId, md, path.dirname(filePath));
}
