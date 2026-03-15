import { describe, test, expect } from 'bun:test';
import { richText, markdownToNotionBlocks } from '../../src/markdown/to-notion.js';

describe('richText', () => {
  test('plain text', () => {
    expect(richText('hello world')).toEqual([['hello world']]);
  });

  test('bold', () => {
    expect(richText('**bold**')).toEqual([['bold', [['b']]]]);
  });

  test('italic', () => {
    expect(richText('*italic*')).toEqual([['italic', [['i']]]]);
  });

  test('inline code', () => {
    expect(richText('`code`')).toEqual([['code', [['c']]]]);
  });

  test('link', () => {
    expect(richText('[text](https://example.com)')).toEqual([
      ['text', [['a', 'https://example.com']]],
    ]);
  });

  test('mixed formatting', () => {
    expect(richText('hello **bold** world')).toEqual([
      ['hello '],
      ['bold', [['b']]],
      [' world'],
    ]);
  });

  test('empty string', () => {
    expect(richText('')).toEqual([]);
  });

  test('multiple formats in sequence', () => {
    expect(richText('**bold** and *italic*')).toEqual([
      ['bold', [['b']]],
      [' and '],
      ['italic', [['i']]],
    ]);
  });
});

describe('markdownToNotionBlocks', () => {
  const parentId = 'test-parent-id';

  test('headings', () => {
    const blocks = markdownToNotionBlocks('# H1\n## H2\n### H3', parentId);
    expect(blocks).toHaveLength(3);
    expect(blocks[0].type).toBe('header');
    expect(blocks[0].properties.title).toEqual([['H1']]);
    expect(blocks[1].type).toBe('sub_header');
    expect(blocks[1].properties.title).toEqual([['H2']]);
    expect(blocks[2].type).toBe('sub_sub_header');
    expect(blocks[2].properties.title).toEqual([['H3']]);
  });

  test('divider', () => {
    const blocks = markdownToNotionBlocks('---', parentId);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].type).toBe('divider');
  });

  test('blockquote', () => {
    const blocks = markdownToNotionBlocks('> quoted text', parentId);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].type).toBe('quote');
    expect(blocks[0].properties.title).toEqual([['quoted text']]);
  });

  test('multi-line blockquote', () => {
    const blocks = markdownToNotionBlocks('> line 1\n> line 2', parentId);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].type).toBe('quote');
    expect(blocks[0].properties.title).toEqual([['line 1\nline 2']]);
  });

  test('code block with language', () => {
    const blocks = markdownToNotionBlocks('```typescript\nconst x = 1;\n```', parentId);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].type).toBe('code');
    expect(blocks[0].properties.title).toEqual([['const x = 1;']]);
    expect(blocks[0].properties.language).toEqual([['typescript']]);
  });

  test('code block without language', () => {
    const blocks = markdownToNotionBlocks('```\ncode here\n```', parentId);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].type).toBe('code');
    expect(blocks[0].properties.title).toEqual([['code here']]);
    expect(blocks[0].properties.language).toBeUndefined();
  });

  test('bulleted list', () => {
    const blocks = markdownToNotionBlocks('- item 1\n- item 2', parentId);
    expect(blocks).toHaveLength(2);
    expect(blocks[0].type).toBe('bulleted_list');
    expect(blocks[0].properties.title).toEqual([['item 1']]);
    expect(blocks[1].type).toBe('bulleted_list');
    expect(blocks[1].properties.title).toEqual([['item 2']]);
  });

  test('numbered list', () => {
    const blocks = markdownToNotionBlocks('1. first\n2. second', parentId);
    expect(blocks).toHaveLength(2);
    expect(blocks[0].type).toBe('numbered_list');
    expect(blocks[0].properties.title).toEqual([['first']]);
    expect(blocks[1].type).toBe('numbered_list');
    expect(blocks[1].properties.title).toEqual([['second']]);
  });

  test('plain text paragraph', () => {
    const blocks = markdownToNotionBlocks('Hello world', parentId);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].type).toBe('text');
    expect(blocks[0].properties.title).toEqual([['Hello world']]);
  });

  test('after chaining', () => {
    const blocks = markdownToNotionBlocks('line 1\nline 2\nline 3', parentId);
    expect(blocks).toHaveLength(3);
    expect(blocks[0].after).toBeUndefined();
    expect(blocks[1].after).toBe(blocks[0].id);
    expect(blocks[2].after).toBe(blocks[1].id);
  });

  test('empty lines skipped', () => {
    const blocks = markdownToNotionBlocks('line 1\n\n\nline 2', parentId);
    expect(blocks).toHaveLength(2);
    expect(blocks[0].properties.title).toEqual([['line 1']]);
    expect(blocks[1].properties.title).toEqual([['line 2']]);
  });

  test('table rows become text blocks', () => {
    const md = '| A | B |\n| --- | --- |\n| 1 | 2 |';
    const blocks = markdownToNotionBlocks(md, parentId);
    expect(blocks).toHaveLength(2); // header row + data row, separator filtered
    expect(blocks[0].type).toBe('text');
    expect(blocks[1].type).toBe('text');
  });
});
