import { test, expect, beforeEach, afterEach } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { parseCurl, notionInit } from '../../src/tools/init.js';

let n = 0;
let dir: string;
beforeEach(() => {
  dir = path.join(os.tmpdir(), `notion-mcp-init-${process.pid}-${n++}`);
  process.env.NOTION_MCP_CONFIG_DIR = dir;
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
  delete process.env.NOTION_MCP_CONFIG_DIR;
});

const CHROME = `curl 'https://www.notion.so/api/v3/loadCachedPageChunkV2' \\
  -H 'accept: */*' \\
  -H 'content-type: application/json' \\
  -H 'cookie: device_id=abc; token_v2=v02%3Auser_token%3AAAAbbbCCC; notion_user_id=11111111-2222-3333-4444-555555555555' \\
  -H 'x-notion-active-user-header: 11111111-2222-3333-4444-555555555555' \\
  --data-raw '{"page":{"id":"66666666-7777-8888-9999-000000000000"},"spaceId":"99999999-8888-7777-6666-555555555555"}'`;

test('parses token (url-decoded), userId, and spaceId from a Chrome cURL', () => {
  const p = parseCurl(CHROME);
  expect(p.token).toBe('v02:user_token:AAAbbbCCC');
  expect(p.userId).toBe('11111111-2222-3333-4444-555555555555');
  expect(p.spaceId).toBe('99999999-8888-7777-6666-555555555555');
});

test('falls back to notion_user_id cookie when no active-user header, tolerates missing spaceId', () => {
  const c = `curl 'https://www.notion.so/api/v3/getSpaces' -H 'cookie: token_v2=plain; notion_user_id=aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee' --data-raw '{}'`;
  const p = parseCurl(c);
  expect(p.token).toBe('plain');
  expect(p.userId).toBe('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee');
  expect(p.spaceId).toBeUndefined();
});

test('throws a clear error when token_v2 is absent', () => {
  expect(() => parseCurl("curl 'https://www.notion.so/api/v3/getSpaces' -H 'accept: */*'")).toThrow(/token_v2/);
});

test('notionInit with a single workspace writes config and redacts the token', async () => {
  const fakePost = async () => ({
    recordMap: {
      notion_user: { 'user-id-123': { value: { id: 'user-id-123' } } },
      space: { 'space-id-456': { value: { id: 'space-id-456', name: 'My WS' } } },
    },
  });
  const out = await notionInit(
    "curl 'https://www.notion.so/api/v3/loadUserContent' -H 'cookie: token_v2=secrettoken' --data-raw '{}'",
    undefined,
    fakePost as any
  );
  expect(out).toContain('space-id-456');
  expect(out).not.toContain('secrettoken');
  const saved = JSON.parse(fs.readFileSync(path.join(dir, 'config.json'), 'utf-8'));
  expect(saved).toEqual({ token: 'secrettoken', userId: 'user-id-123', spaceId: 'space-id-456' });
});

test('notionInit returns a chooser (and writes nothing) when multiple workspaces exist', async () => {
  const fakePost = async () => ({
    recordMap: {
      notion_user: { u1: { value: { id: 'u1' } } },
      space: {
        s1: { value: { id: 's1', name: 'Alpha' } },
        s2: { value: { id: 's2', name: 'Beta' } },
      },
    },
  });
  const out = await notionInit(
    "curl 'https://www.notion.so/api/v3/loadUserContent' -H 'cookie: token_v2=tok'",
    undefined,
    fakePost as any
  );
  expect(out).toContain('Alpha');
  expect(out).toContain('Beta');
  expect(out).toContain('space_id');
  expect(fs.existsSync(path.join(dir, 'config.json'))).toBe(false);
});
