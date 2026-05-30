import { test, expect, beforeEach } from 'bun:test';
import * as os from 'os';
import * as path from 'path';
import { handleMessage } from '../src/mcp-handler.js';

beforeEach(() => {
  // Isolate HOME so a real ~/.notion-mcp/config.json can't leak into these tests,
  // and clear env so "no credentials" paths are exercised.
  process.env.HOME = path.join(os.tmpdir(), 'notion-mcp-nohome-' + process.pid);
  delete process.env.NOTION_TOKEN;
  delete process.env.NOTION_USER_ID;
  delete process.env.NOTION_SPACE_ID;
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
