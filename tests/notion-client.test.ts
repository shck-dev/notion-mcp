import { describe, test, expect, afterEach } from 'bun:test';
import { parsePageId, notionPost } from '../src/notion-client.js';

describe('parsePageId', () => {
  test('32-char hex → UUID conversion', () => {
    expect(parsePageId('30fbd879c5f080f8a88ac150e349d076')).toBe(
      '30fbd879-c5f0-80f8-a88a-c150e349d076'
    );
  });

  test('UUID passthrough', () => {
    expect(parsePageId('30fbd879-c5f0-80f8-a88a-c150e349d076')).toBe(
      '30fbd879-c5f0-80f8-a88a-c150e349d076'
    );
  });

  test('hex embedded in Notion URL', () => {
    expect(
      parsePageId('https://www.notion.so/My-Page-30fbd879c5f080f8a88ac150e349d076')
    ).toBe('30fbd879-c5f0-80f8-a88a-c150e349d076');
  });

  test('hex embedded in Notion URL with query params', () => {
    expect(
      parsePageId('https://www.notion.so/workspace/30fbd879c5f080f8a88ac150e349d076?v=abc')
    ).toBe('30fbd879-c5f0-80f8-a88a-c150e349d076');
  });

  test('invalid input throws', () => {
    expect(() => parsePageId('not-a-page-id')).toThrow('Invalid page ID');
  });

  test('empty input throws', () => {
    expect(() => parsePageId('')).toThrow('Invalid page ID');
  });

  test('too short hex throws', () => {
    expect(() => parsePageId('30fbd879c5f0')).toThrow('Invalid page ID');
  });
});

describe('notionPost auth errors', () => {
  const realFetch = globalThis.fetch;
  const cfg = { token: 'x', userId: 'u', spaceId: 's' };

  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  test('HTTP 401 throws token_v2 refresh guidance', async () => {
    globalThis.fetch = (async () => new Response('nope', { status: 401 })) as typeof fetch;
    await expect(notionPost(cfg, 'syncRecordValues', {})).rejects.toThrow(/token_v2/);
  });

  test('200 UnauthorizedError envelope throws token_v2 refresh guidance', async () => {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ name: 'UnauthorizedError' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })) as typeof fetch;
    await expect(notionPost(cfg, 'syncRecordValues', {})).rejects.toThrow(/token_v2/);
  });
});
