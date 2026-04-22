import type { NotionConfig, NotionRawBlock } from '../types.js';
import { notionPost, unwrapRecord } from '../notion-client.js';

export async function searchPages(config: NotionConfig, query: string, limit = 10): Promise<string> {
  const data = await notionPost(config, 'search', {
    type: 'BlocksInSpace',
    query,
    spaceId: config.spaceId,
    limit,
    filters: {
      isDeletedOnly: false,
      navigableBlockContentOnly: true,
      requireEditPermissions: false,
      ancestors: [],
      createdBy: [],
      editedBy: [],
      lastEditedTime: {},
      createdTime: {},
      inTeams: [],
    },
    sort: { field: 'relevance' },
    source: 'quick_find',
  });

  const results: string[] = [];
  const blocks = data.recordMap?.block ?? {};
  for (const [bid, entry] of Object.entries(blocks)) {
    const v = unwrapRecord<NotionRawBlock>(entry);
    if (!v || v.type !== 'page') continue;
    const title = v.properties?.title?.[0]?.[0] ?? '(untitled)';
    const id = bid.replace(/-/g, '');
    results.push(`${title}\n  ID: ${id}\n  URL: https://www.notion.so/${id}`);
  }

  if (results.length === 0) return 'No pages found.';
  return results.join('\n\n');
}
