import { test, expect } from 'bun:test';
import { parseCurl } from '../../src/tools/init.js';

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
