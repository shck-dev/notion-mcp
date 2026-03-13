import type { NotionConfig } from './types.js';

const BASE = 'https://www.notion.so/api/v3';

export function loadConfig(): NotionConfig {
  const token = process.env.NOTION_TOKEN;
  const userId = process.env.NOTION_USER_ID;
  const spaceId = process.env.NOTION_SPACE_ID;

  const missing: string[] = [];
  if (!token) missing.push('NOTION_TOKEN');
  if (!userId) missing.push('NOTION_USER_ID');
  if (!spaceId) missing.push('NOTION_SPACE_ID');

  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missing.join(', ')}\n\n` +
      'Get these from your browser:\n' +
      '1. Open Notion in Chrome, press F12 → Application → Cookies\n' +
      '2. NOTION_TOKEN = token_v2 cookie value\n' +
      '3. Open F12 → Network, do any action, find a POST to /api/v3/*\n' +
      '4. NOTION_USER_ID = x-notion-active-user-header from request headers\n' +
      '5. NOTION_SPACE_ID = spaceId from any request body'
    );
  }

  return { token: token!, userId: userId!, spaceId: spaceId! };
}

export async function notionPost(config: NotionConfig, endpoint: string, body: unknown): Promise<any> {
  const res = await fetch(`${BASE}/${endpoint}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-notion-active-user-header': config.userId,
      cookie: `token_v2=${config.token}; notion_user_id=${config.userId}`,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Notion ${endpoint} ${res.status}: ${text.slice(0, 300)}`);
  }
  return res.json();
}

export function parsePageId(input: string): string {
  const match = input.match(/([a-f0-9]{32})/);
  if (match) {
    const raw = match[1];
    return `${raw.slice(0, 8)}-${raw.slice(8, 12)}-${raw.slice(12, 16)}-${raw.slice(16, 20)}-${raw.slice(20)}`;
  }
  if (/^[a-f0-9-]{36}$/.test(input)) return input;
  throw new Error(`Invalid page ID: ${input}`);
}
