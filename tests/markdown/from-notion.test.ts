import { describe, test, expect } from 'bun:test';
import { richTextToMarkdown, blocksToMarkdown } from '../../src/markdown/from-notion.js';
import {
  simplePageBlocks,
  formattedTextBlocks,
  headingBlocks,
  listBlocks,
  codeBlocks,
  miscBlocks,
  toggleBlocks,
  tableBlocks,
  nestedListBlocks,
  complexPageBlocks,
} from '../fixtures/notion-blocks.js';
import { richText, markdownToNotionBlocks } from '../../src/markdown/to-notion.js';
import type { BlockMap } from '../../src/types.js';

describe('richTextToMarkdown', () => {
  test('plain text', () => {
    expect(richTextToMarkdown([['hello']])).toBe('hello');
  });

  test('bold', () => {
    expect(richTextToMarkdown([['bold', [['b']]]])).toBe('**bold**');
  });

  test('italic', () => {
    expect(richTextToMarkdown([['italic', [['i']]]])).toBe('*italic*');
  });

  test('inline code', () => {
    expect(richTextToMarkdown([['code', [['c']]]])).toBe('`code`');
  });

  test('link', () => {
    expect(richTextToMarkdown([['text', [['a', 'https://example.com']]]])).toBe(
      '[text](https://example.com)'
    );
  });

  test('bold + italic combined', () => {
    expect(richTextToMarkdown([['text', [['b'], ['i']]]])).toBe('***text***');
  });

  test('mixed segments', () => {
    expect(
      richTextToMarkdown([
        ['hello '],
        ['bold', [['b']]],
        [' world'],
      ])
    ).toBe('hello **bold** world');
  });

  test('empty array', () => {
    expect(richTextToMarkdown([])).toBe('');
  });

  test('undefined input', () => {
    expect(richTextToMarkdown(undefined as any)).toBe('');
  });
});

describe('blocksToMarkdown', () => {
  test('simple page with text', () => {
    const md = blocksToMarkdown(simplePageBlocks, 'page-1');
    expect(md).toContain('Hello world');
    expect(md).toContain('Second paragraph');
  });

  test('formatted text', () => {
    const md = blocksToMarkdown(formattedTextBlocks, 'page-fmt');
    expect(md).toContain('**bold**');
    expect(md).toContain('*italic*');
    expect(md).toContain('`code`');
    expect(md).toContain('[a link](https://example.com)');
  });

  test('headings', () => {
    const md = blocksToMarkdown(headingBlocks, 'page-h');
    expect(md).toContain('# Heading 1');
    expect(md).toContain('## Heading 2');
    expect(md).toContain('### Heading 3');
  });

  test('bulleted list', () => {
    const md = blocksToMarkdown(listBlocks, 'page-list');
    expect(md).toContain('- Bullet one');
    expect(md).toContain('- Bullet two');
  });

  test('numbered list', () => {
    const md = blocksToMarkdown(listBlocks, 'page-list');
    expect(md).toContain('1. Number one');
    expect(md).toContain('2. Number two');
  });

  test('code block with language', () => {
    const md = blocksToMarkdown(codeBlocks, 'page-code');
    expect(md).toContain('```TypeScript');
    expect(md).toContain('const x = 42;');
    expect(md).toContain('```');
  });

  test('divider', () => {
    const md = blocksToMarkdown(miscBlocks, 'page-misc');
    expect(md).toContain('---');
  });

  test('quote', () => {
    const md = blocksToMarkdown(miscBlocks, 'page-misc');
    expect(md).toContain('> A wise quote');
  });

  test('to_do checked', () => {
    const md = blocksToMarkdown(miscBlocks, 'page-misc');
    expect(md).toContain('- [x] Done task');
  });

  test('to_do unchecked', () => {
    const md = blocksToMarkdown(miscBlocks, 'page-misc');
    expect(md).toContain('- [ ] Pending task');
  });

  test('image', () => {
    const md = blocksToMarkdown(miscBlocks, 'page-misc');
    expect(md).toContain('![](https://example.com/img.png)');
  });

  test('callout with icon', () => {
    const md = blocksToMarkdown(miscBlocks, 'page-misc');
    expect(md).toContain('> 💡 Important note');
  });

  test('toggle renders title and children', () => {
    const md = blocksToMarkdown(toggleBlocks, 'page-toggle');
    expect(md).toContain('Click to expand');
    expect(md).toContain('Hidden content');
  });

  test('table renders as markdown table', () => {
    const md = blocksToMarkdown(tableBlocks, 'page-table');
    expect(md).toContain('Name');
    expect(md).toContain('Age');
    expect(md).toContain('City');
    expect(md).toContain('Alice');
    expect(md).toContain('|');
    expect(md).toContain('---');
  });

  test('nested lists with indentation', () => {
    const md = blocksToMarkdown(nestedListBlocks, 'page-nested');
    expect(md).toContain('- Parent item');
    expect(md).toContain('  - Child one');
    expect(md).toContain('  - Child two');
    expect(md).toContain('    - Grandchild');
  });

  test('complex page with multiple types', () => {
    const md = blocksToMarkdown(complexPageBlocks, 'page-complex');
    expect(md).toContain('# Introduction');
    expect(md).toContain('**complex**');
    expect(md).toContain('*formatting*');
    expect(md).toContain('- First point');
    expect(md).toContain('---');
    expect(md).toContain('```JavaScript');
    expect(md).toContain('> Final thought');
  });

  test('missing block in blockMap is skipped gracefully', () => {
    const blocks: BlockMap = Object.fromEntries([
      ['page-x', { value: { id: 'page-x', type: 'page', content: ['missing-id'], properties: { title: [['Test']] } } }],
    ]);
    const md = blocksToMarkdown(blocks, 'page-x');
    expect(md.trim()).toBe('');
  });

  test('page title excluded from output', () => {
    const md = blocksToMarkdown(simplePageBlocks, 'page-1');
    // "My Page" is the page title, should not appear
    expect(md).not.toContain('My Page');
  });
});

describe('roundtrip: markdown → notion → markdown', () => {
  function roundtrip(input: string): string {
    const parentId = 'roundtrip-page';
    const notionBlocks = markdownToNotionBlocks(input, parentId);

    // Build a BlockMap from the NotionBlock[] output
    const blockMap: BlockMap = {};
    const contentIds: string[] = [];

    for (const nb of notionBlocks) {
      contentIds.push(nb.id);
      blockMap[nb.id] = {
        value: {
          id: nb.id,
          type: nb.type,
          properties: nb.properties,
        },
      };
    }

    blockMap[parentId] = {
      value: {
        id: parentId,
        type: 'page',
        content: contentIds,
        properties: { title: [['Test']] },
      },
    };

    return blocksToMarkdown(blockMap, parentId);
  }

  test('paragraph roundtrip', () => {
    const md = roundtrip('Hello world');
    expect(md.trim()).toBe('Hello world');
  });

  test('heading roundtrip', () => {
    const md = roundtrip('# My Heading');
    expect(md.trim()).toBe('# My Heading');
  });

  test('bold text roundtrip', () => {
    const md = roundtrip('Some **bold** text');
    expect(md.trim()).toBe('Some **bold** text');
  });

  test('bulleted list roundtrip', () => {
    const md = roundtrip('- item one\n- item two');
    expect(md).toContain('- item one');
    expect(md).toContain('- item two');
  });

  test('code block roundtrip', () => {
    const input = '```typescript\nconst x = 1;\n```';
    const md = roundtrip(input);
    expect(md).toContain('```typescript');
    expect(md).toContain('const x = 1;');
    expect(md.trim().endsWith('```')).toBe(true);
  });

  test('divider roundtrip', () => {
    const md = roundtrip('---');
    expect(md.trim()).toBe('---');
  });

  test('quote roundtrip', () => {
    const md = roundtrip('> some quote');
    expect(md.trim()).toBe('> some quote');
  });

  test('mixed content roundtrip', () => {
    const input = '# Title\n\nSome text\n\n- bullet 1\n- bullet 2\n\n---\n\n> quote';
    const md = roundtrip(input);
    expect(md).toContain('# Title');
    expect(md).toContain('Some text');
    expect(md).toContain('- bullet 1');
    expect(md).toContain('- bullet 2');
    expect(md).toContain('---');
    expect(md).toContain('> quote');
  });
});
