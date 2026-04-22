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

  return blocksToMarkdown(allBlocks, id);
}
