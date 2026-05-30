import type { NotionConfig, BlockMap } from '../types.js';
import { notionPost, parsePageId, normalizeBlockMap } from '../notion-client.js';
import { blocksToMarkdown } from '../markdown/from-notion.js';

export async function exportPageMarkdown(config: NotionConfig, pageId: string): Promise<string> {
  const id = parsePageId(pageId);
  const allBlocks: BlockMap = {};
  let cursor = { stack: [] as any[] };
  let chunkNumber = 0;

  while (true) {
    const data = await notionPost(config, 'loadPageChunk', {
      page: { id },
      limit: 100,
      cursor,
      chunkNumber,
      verticalColumns: false,
    });

    Object.assign(allBlocks, normalizeBlockMap(data.recordMap?.block));

    if (data.cursor?.stack?.length > 0) {
      cursor = data.cursor;
      chunkNumber++;
    } else {
      break;
    }
  }

  if (!allBlocks[id]) {
    throw new Error(`Page ${id} not found in response (check credentials or page access)`);
  }

  const md = blocksToMarkdown(allBlocks, id);
  if (md.trim()) return md;

  // No renderable text — explain why instead of returning an empty string.
  const childIds = allBlocks[id]?.value?.content ?? [];
  const types = new Map<string, number>();
  for (const cid of childIds) {
    const t = allBlocks[cid]?.value?.type ?? 'unresolved (database/collection or embed)';
    types.set(t, (types.get(t) ?? 0) + 1);
  }
  const breakdown = [...types.entries()].map(([t, n]) => `${t} ×${n}`).join(', ') || 'none';
  return (
    '_This page has no exportable text. It may be a database (collection view) or contain only embeds/sub-pages._\n\n' +
    `Child block types: ${breakdown}\n`
  );
}
