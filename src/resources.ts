/** MCP resources. notion://guide is static + credential-free; notion://recent is dynamic. */
import { notionPost, unwrapRecord } from './notion-client.js';
import type { NotionConfig, NotionRawBlock } from './types.js';
import { SETUP_GUIDE } from './guide.js';

export const RESOURCES = [
  {
    uri: 'notion://guide',
    name: 'Notion MCP setup & usage guide',
    mimeType: 'text/markdown',
    description: 'How to connect and use this server.',
  },
  {
    uri: 'notion://recent',
    name: 'Recent Notion pages',
    mimeType: 'text/markdown',
    description: 'Recently visited pages in your workspace (needs credentials).',
  },
];

async function recentPages(cfg: NotionConfig): Promise<string> {
  const data = await notionPost(cfg, 'getRecentPageVisits', { spaceId: cfg.spaceId, limit: 20 });
  const blocks = data?.recordMap?.block ?? {};
  const lines: string[] = [];
  for (const [bid, entry] of Object.entries<any>(blocks)) {
    const v = unwrapRecord<NotionRawBlock>(entry);
    if (!v || v.type !== 'page') continue;
    const title = (v.properties?.title?.[0]?.[0] as string) ?? '(untitled)';
    lines.push(`- [${title}](https://www.notion.so/${bid.replace(/-/g, '')})`);
  }
  return lines.length ? `# Recent pages\n\n${lines.join('\n')}\n` : 'No recent pages found.';
}

export async function readResource(
  uri: string,
  getConfig: () => NotionConfig
): Promise<{ contents: any[] }> {
  if (uri === 'notion://guide') {
    return { contents: [{ uri, mimeType: 'text/markdown', text: SETUP_GUIDE }] };
  }
  if (uri === 'notion://recent') {
    let text: string;
    try {
      text = await recentPages(getConfig());
    } catch {
      text = 'Could not load recent pages. Run `npx @shck-dev/notion-mcp init` (or set NOTION_* env vars), then re-read this resource.';
    }
    return { contents: [{ uri, mimeType: 'text/markdown', text }] };
  }
  throw new Error(`Unknown resource: ${uri}`);
}
