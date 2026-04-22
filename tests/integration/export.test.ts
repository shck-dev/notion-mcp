import { describe, test, expect, beforeAll } from 'bun:test';
import type { NotionConfig } from '../../src/types.js';
import { exportPageMarkdown } from '../../src/tools/export.js';
import { searchPages } from '../../src/tools/search.js';

// Load .env.test if it exists
try {
  const envFile = await Bun.file(new URL('../../.env.test', import.meta.url)).text();
  for (const line of envFile.split('\n')) {
    const [key, ...val] = line.split('=');
    if (key && val.length) process.env[key.trim()] = val.join('=').trim();
  }
} catch {}

const hasCredentials =
  process.env.NOTION_TOKEN &&
  process.env.NOTION_USER_ID &&
  process.env.NOTION_SPACE_ID;

const describeIntegration = hasCredentials ? describe : describe.skip;

describeIntegration('integration: Notion API', () => {
  let config: NotionConfig;

  beforeAll(() => {
    config = {
      token: process.env.NOTION_TOKEN!,
      userId: process.env.NOTION_USER_ID!,
      spaceId: process.env.NOTION_SPACE_ID!,
    };
  });

  test('searchPages returns results', async () => {
    const result = await searchPages(config, '', 3);
    expect(result).toContain('ID:');
    expect(result).toContain('URL:');
  });

  test('exportPageMarkdown returns markdown for "Getting Started"', async () => {
    const md = await exportPageMarkdown(config, '324c0895f1858056814ec775f9695cc6');
    expect(md.length).toBeGreaterThan(0);
    expect(md).toContain('Notion');
  });

  test('exportPageMarkdown handles to_do blocks', async () => {
    const md = await exportPageMarkdown(config, '324c0895f1858056814ec775f9695cc6');
    expect(md).toMatch(/- \[[ x]\]/); // checkbox syntax
  });

  test('exportPageMarkdown handles page with toggle', async () => {
    const md = await exportPageMarkdown(config, '324c0895f1858056814ec775f9695cc6');
    expect(md).toContain('toggle');
  });

  test('exportPageMarkdown with Notion URL format', async () => {
    const md = await exportPageMarkdown(
      config,
      'https://www.notion.so/Getting-Started-324c0895f1858056814ec775f9695cc6'
    );
    expect(md.length).toBeGreaterThan(0);
  });

  test('exportPageMarkdown with nonexistent page throws', async () => {
    await expect(
      exportPageMarkdown(config, '00000000000000000000000000000000')
    ).rejects.toThrow(/not found/);
  });

  test('export "Click me to see even more detail" page', async () => {
    const md = await exportPageMarkdown(config, '324c0895f18580598945de9ddcba1160');
    // This is a sub-page, just verify it doesn't crash
    expect(typeof md).toBe('string');
  });
});
