import { describe, test, expect } from 'bun:test';
import { parsePageId } from '../src/notion-client.js';

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
