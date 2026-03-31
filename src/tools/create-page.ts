import * as fs from 'fs';
import type { NotionConfig } from '../types.js';
import { notionPost, parsePageId } from '../notion-client.js';
import { importMarkdownToPage } from './import.js';

/**
 * Create a new sub-page under a parent page.
 * Optionally populate it with markdown content.
 */
export async function createPage(
  config: NotionConfig,
  parentPageId: string,
  title: string,
  markdown?: string,
  icon?: string,
): Promise<string> {
  const parentId = parsePageId(parentPageId);
  const pageId = crypto.randomUUID();

  const properties: Record<string, any> = {
    title: [[title]],
  };

  const format: Record<string, any> = {};
  if (icon) {
    format.page_icon = icon;
  }

  const ops: any[] = [
    // Create the page block
    {
      id: pageId,
      table: 'block',
      path: [],
      command: 'set',
      args: {
        type: 'page',
        id: pageId,
        parent_id: parentId,
        parent_table: 'block',
        alive: true,
        properties,
        ...(Object.keys(format).length > 0 ? { format } : {}),
        space_id: config.spaceId,
      },
    },
    // Add to parent's content list
    {
      id: parentId,
      table: 'block',
      path: ['content'],
      command: 'listAfter',
      args: { id: pageId },
    },
    // Set timestamps
    {
      id: pageId,
      table: 'block',
      path: [],
      command: 'update',
      args: { created_time: Date.now(), last_edited_time: Date.now() },
    },
  ];

  await notionPost(config, 'submitTransaction', {
    requestId: crypto.randomUUID(),
    transactions: [{ id: crypto.randomUUID(), spaceId: config.spaceId, operations: ops }],
  });

  // If markdown content provided, import it into the new page
  if (markdown) {
    await importMarkdownToPage(config, pageId, markdown);
  }

  const rawId = pageId.replace(/-/g, '');
  return `Created page "${title}" — https://www.notion.so/${rawId}`;
}

/**
 * Create a new page and populate it from a local markdown file.
 */
export async function createPageFromFile(
  config: NotionConfig,
  parentPageId: string,
  title: string,
  filePath: string,
  icon?: string,
): Promise<string> {
  const md = fs.readFileSync(filePath, 'utf-8');
  return createPage(config, parentPageId, title, md, icon);
}
