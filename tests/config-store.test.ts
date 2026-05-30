import { test, expect, beforeEach, afterEach } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

// Bun caches os.homedir(), so $HOME can't isolate these tests. Point config-store at a unique
// temp dir via NOTION_MCP_CONFIG_DIR, which is read fresh from process.env on every call.
let n = 0;
let dir: string;
beforeEach(() => {
  dir = path.join(os.tmpdir(), `notion-mcp-cs-${process.pid}-${n++}`);
  process.env.NOTION_MCP_CONFIG_DIR = dir;
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
  delete process.env.NOTION_MCP_CONFIG_DIR;
});

test('writeConfigFile then readConfigFile round-trips and the file is 0600', async () => {
  const { writeConfigFile, readConfigFile, configPath } = await import('../src/config-store.js');
  writeConfigFile({ token: 'tok', userId: 'uid', spaceId: 'sid' });
  expect(readConfigFile()).toEqual({ token: 'tok', userId: 'uid', spaceId: 'sid' });
  expect(fs.statSync(configPath()).mode & 0o777).toBe(0o600);
});

test('readConfigFile returns null when no config file exists', async () => {
  const { readConfigFile } = await import('../src/config-store.js');
  expect(readConfigFile()).toBeNull();
});
