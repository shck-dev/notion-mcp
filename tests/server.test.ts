import { test, expect, beforeEach, afterEach } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { handleMessage } from '../src/mcp-handler.js';

// Force the "no credentials" state: point the config store at an empty temp dir (via
// NOTION_MCP_CONFIG_DIR, read fresh each call) and clear the env vars.
let n = 0;
let dir: string;
beforeEach(() => {
  dir = path.join(os.tmpdir(), `notion-mcp-nocfg-${process.pid}-${n++}`);
  fs.rmSync(dir, { recursive: true, force: true });
  process.env.NOTION_MCP_CONFIG_DIR = dir;
  delete process.env.NOTION_TOKEN;
  delete process.env.NOTION_USER_ID;
  delete process.env.NOTION_SPACE_ID;
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
  delete process.env.NOTION_MCP_CONFIG_DIR;
});

test('initialize and tools/list answer with no credentials', async () => {
  const init = await handleMessage({ jsonrpc: '2.0', id: 1, method: 'initialize' });
  expect(init.result.serverInfo.name).toBe('notion-mcp');
  const list = await handleMessage({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
  expect(list.result.tools.length).toBeGreaterThan(0);
});

test('tools/call without credentials returns a helpful isError, not a crash', async () => {
  const res = await handleMessage({
    jsonrpc: '2.0',
    id: 3,
    method: 'tools/call',
    params: { name: 'notion_search', arguments: { query: 'x' } },
  });
  expect(res.result.isError).toBe(true);
  expect(res.result.content[0].text).toContain('NOTION_TOKEN');
});

test('tools/call notion_init runs credential-free and saves config', async () => {
  const curl =
    "curl 'https://www.notion.so/api/v3/x' " +
    "-H 'cookie: token_v2=tok; notion_user_id=11111111-2222-3333-4444-555555555555' " +
    `--data-raw '{"spaceId":"99999999-8888-7777-6666-555555555555"}'`;
  const res = await handleMessage({
    jsonrpc: '2.0',
    id: 5,
    method: 'tools/call',
    params: { name: 'notion_init', arguments: { curl } },
  });
  expect(res.result.isError).toBeUndefined();
  expect(res.result.content[0].text).toContain('Saved Notion credentials');
  expect(fs.existsSync(path.join(dir, 'config.json'))).toBe(true);
});
