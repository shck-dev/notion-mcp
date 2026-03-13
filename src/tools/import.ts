import * as fs from 'fs';
import type { NotionConfig } from '../types.js';
import { notionPost, parsePageId } from '../notion-client.js';
import { markdownToNotionBlocks } from '../markdown/to-notion.js';

export async function importMarkdownToPage(
  config: NotionConfig,
  pageId: string,
  markdown: string,
): Promise<string> {
  const id = parsePageId(pageId);

  // 1. Get full page record using syncRecordValues (non-cached, reliable)
  const syncData = await notionPost(config, 'syncRecordValues', {
    requests: [{ pointer: { table: 'block', id }, version: -1 }],
  });

  const pageBlock = syncData.recordMap?.block?.[id]?.value;
  if (!pageBlock) throw new Error(`Page ${id} not found`);

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
  const newBlocks = markdownToNotionBlocks(markdown, id);

  // 4. Create new blocks in a separate transaction
  const createOps: any[] = [];
  for (const block of newBlocks) {
    createOps.push({
      id: block.id,
      table: 'block',
      path: [],
      command: 'set',
      args: {
        type: block.type,
        id: block.id,
        parent_id: id,
        parent_table: 'block',
        alive: true,
        properties: block.properties,
        space_id: config.spaceId,
      },
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
  return importMarkdownToPage(config, pageId, md);
}
