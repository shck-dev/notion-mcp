import { describe, test, expect, beforeAll } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { NotionConfig } from '../../src/types.js';
import { addImageToPage } from '../../src/tools/images.js';
import { exportPageMarkdown } from '../../src/tools/export.js';

try {
  const envFile = await Bun.file(new URL('../../.env.test', import.meta.url)).text();
  for (const line of envFile.split('\n')) {
    const [key, ...val] = line.split('=');
    if (key && val.length) process.env[key.trim()] = val.join('=').trim();
  }
} catch {}

const hasCreds = process.env.NOTION_TOKEN && process.env.NOTION_USER_ID && process.env.NOTION_SPACE_ID;
// Set NOTION_TEST_PAGE to a sandbox page id to run this (it appends an image to that page).
const canRun = hasCreds && process.env.NOTION_TEST_PAGE;
const d = canRun ? describe : describe.skip;

d('integration: image round-trip', () => {
  let config: NotionConfig;
  beforeAll(() => {
    config = { token: process.env.NOTION_TOKEN!, userId: process.env.NOTION_USER_ID!, spaceId: process.env.NOTION_SPACE_ID! };
  });

  test('upload an image, then export resolves it to a fetchable url', async () => {
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
    const tmp = path.join(os.tmpdir(), `it-${crypto.randomUUID()}.png`);
    fs.writeFileSync(tmp, png);

    const res = await addImageToPage(config, process.env.NOTION_TEST_PAGE!, tmp);
    fs.unlinkSync(tmp);
    expect(res).toContain('Uploaded image');

    const md = await exportPageMarkdown(config, process.env.NOTION_TEST_PAGE!);
    const m = md.match(/!\[[^\]]*\]\((https:\/\/img\.notionusercontent\.com\/[^)]+)\)/);
    expect(m).not.toBeNull();

    const got = await fetch(m![1]);
    expect(got.ok).toBe(true);
    expect(got.headers.get('content-type')).toContain('image');
  }, 30000);
});
