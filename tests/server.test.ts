import { test, expect, beforeEach, afterEach } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { handleMessage } from '../src/mcp-handler.js';

// Force the "no credentials" state: point the config store at an empty temp dir (via
// NOTION_MCP_CONFIG_DIR, read fresh each call) and clear the env vars.
let n = 0;
beforeEach(() => {
  const dir = path.join(os.tmpdir(), `notion-mcp-nocfg-${process.pid}-${n++}`);
  fs.rmSync(dir, { recursive: true, force: true });
  process.env.NOTION_MCP_CONFIG_DIR = dir;
  delete process.env.NOTION_TOKEN;
  delete process.env.NOTION_USER_ID;
  delete process.env.NOTION_SPACE_ID;
});
afterEach(() => {
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
