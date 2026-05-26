import * as fs from 'fs';
import * as path from 'path';
import type { NotionConfig, NotionRawBlock, NotionBlock } from '../types.js';
import { notionPost, parsePageId, unwrapRecord } from '../notion-client.js';
import { markdownToNotionBlocks } from '../markdown/to-notion.js';

// Load a page block via syncRecordValues (non-cached, reliable) and guard
// against not-found / archived pages — writes to archived pages succeed but
// are silently invisible until the page is restored.
async function loadAlivePageBlock(config: NotionConfig, id: string): Promise<NotionRawBlock> {
  const syncData = await notionPost(config, 'syncRecordValues', {
    requests: [{ pointer: { table: 'block', id }, version: -1 }],
  });
  const pageBlock = unwrapRecord<NotionRawBlock>(syncData.recordMap?.block?.[id]);
  if (!pageBlock) throw new Error(`Page ${id} not found`);
  if ((pageBlock as any).alive === false) {
    throw new Error(
      `Page ${id} is archived/trashed. Restore it before writing — writes to archived pages are silently invisible.`,
    );
  }
  return pageBlock;
}

// Without a file context, relative local-image refs cannot be resolved.
function validateImageRefs(blocks: NotionBlock[], baseDir?: string): void {
  if (baseDir) return;
  for (const b of blocks) {
    if (b.imageUpload && !path.isAbsolute(b.imageUpload.localPath)) {
      throw new Error(
        `Markdown references a relative local image (${b.imageUpload.localPath}) but no file context is available. Use the *_from_file variant or pass an absolute path.`,
      );
    }
  }
}

// Upload any local images and patch the blocks in place with attachment URLs.
async function uploadLocalImages(config: NotionConfig, blocks: NotionBlock[]): Promise<void> {
  for (const block of blocks) {
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
}

// Build the submitTransaction operations that create `blocks` under `parentId`.
// Pure (no network) — shared by import (replace) and append. Handles one level
// of children (e.g. table_row blocks inside a table).
export function buildCreateOps(parentId: string, blocks: NotionBlock[], spaceId: string): any[] {
  const createOps: any[] = [];
  for (const block of blocks) {
    const blockArgs: Record<string, any> = {
      type: block.type,
      id: block.id,
      parent_id: parentId,
      parent_table: 'block',
      alive: true,
      properties: block.properties,
      space_id: spaceId,
    };
    if (block.format) {
      blockArgs.format = block.format;
    }
    createOps.push({ id: block.id, table: 'block', path: [], command: 'set', args: blockArgs });
    createOps.push({
      id: parentId,
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
            space_id: spaceId,
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
  return createOps;
}

async function submitOps(config: NotionConfig, operations: any[]): Promise<void> {
  await notionPost(config, 'submitTransaction', {
    requestId: crypto.randomUUID(),
    transactions: [{ id: crypto.randomUUID(), spaceId: config.spaceId, operations }],
  });
}

export async function importMarkdownToPage(
  config: NotionConfig,
  pageId: string,
  markdown: string,
  baseDir?: string,
): Promise<string> {
  const id = parsePageId(pageId);
  const pageBlock = await loadAlivePageBlock(config, id);
  const existingChildren: string[] = pageBlock.content ?? [];

  // Delete all existing children in a separate transaction.
  if (existingChildren.length > 0) {
    const deleteOps: any[] = [];
    for (const childId of existingChildren) {
      deleteOps.push({ id: childId, table: 'block', path: [], command: 'update', args: { alive: false } });
      deleteOps.push({ id, table: 'block', path: ['content'], command: 'listRemove', args: { id: childId } });
    }
    await submitOps(config, deleteOps);
    await new Promise((r) => setTimeout(r, 500)); // let Notion process the deletion
  }

  const newBlocks = markdownToNotionBlocks(markdown, id, baseDir);
  validateImageRefs(newBlocks, baseDir);
  await uploadLocalImages(config, newBlocks);
  await submitOps(config, buildCreateOps(id, newBlocks, config.spaceId));

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

export async function appendMarkdownToPage(
  config: NotionConfig,
  pageId: string,
  markdown: string,
  baseDir?: string,
): Promise<string> {
  const id = parsePageId(pageId);
  const pageBlock = await loadAlivePageBlock(config, id);
  const existingChildren: string[] = pageBlock.content ?? [];

  const newBlocks = markdownToNotionBlocks(markdown, id, baseDir);
  validateImageRefs(newBlocks, baseDir);
  await uploadLocalImages(config, newBlocks);

  // Position the first new block after the last existing child so content is
  // appended, not prepended — existing blocks are never touched.
  if (existingChildren.length > 0 && newBlocks.length > 0) {
    newBlocks[0].after = existingChildren[existingChildren.length - 1];
  }
  await submitOps(config, buildCreateOps(id, newBlocks, config.spaceId));

  return `Appended ${newBlocks.length} blocks after ${existingChildren.length} existing blocks.`;
}

export async function appendMarkdownFromFile(
  config: NotionConfig,
  pageId: string,
  filePath: string,
): Promise<string> {
  const md = fs.readFileSync(filePath, 'utf-8');
  return appendMarkdownToPage(config, pageId, md, path.dirname(filePath));
}
