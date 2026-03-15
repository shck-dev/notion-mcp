import type { BlockMap, NotionRawBlock } from '../../src/types.js';

/** Helper to create a block entry for a BlockMap */
function block(id: string, type: string, opts: Partial<NotionRawBlock> = {}): [string, { value: NotionRawBlock }] {
  return [id, { value: { id, type, ...opts } }];
}

/** Simple page with text children */
export const simplePageBlocks: BlockMap = Object.fromEntries([
  block('page-1', 'page', {
    content: ['text-1', 'text-2'],
    properties: { title: [['My Page']] },
  }),
  block('text-1', 'text', {
    properties: { title: [['Hello world']] },
  }),
  block('text-2', 'text', {
    properties: { title: [['Second paragraph']] },
  }),
]);

/** Formatted text (bold, italic, code, links) */
export const formattedTextBlocks: BlockMap = Object.fromEntries([
  block('page-fmt', 'page', {
    content: ['fmt-1'],
    properties: { title: [['Formatted']] },
  }),
  block('fmt-1', 'text', {
    properties: {
      title: [
        ['This is '],
        ['bold', [['b']]],
        [', '],
        ['italic', [['i']]],
        [', '],
        ['code', [['c']]],
        [', and '],
        ['a link', [['a', 'https://example.com']]],
      ],
    },
  }),
]);

/** Headings (h1, h2, h3) */
export const headingBlocks: BlockMap = Object.fromEntries([
  block('page-h', 'page', {
    content: ['h1', 'h2', 'h3'],
    properties: { title: [['Headings']] },
  }),
  block('h1', 'header', {
    properties: { title: [['Heading 1']] },
  }),
  block('h2', 'sub_header', {
    properties: { title: [['Heading 2']] },
  }),
  block('h3', 'sub_sub_header', {
    properties: { title: [['Heading 3']] },
  }),
]);

/** Lists (bulleted, numbered) */
export const listBlocks: BlockMap = Object.fromEntries([
  block('page-list', 'page', {
    content: ['b1', 'b2', 'n1', 'n2'],
    properties: { title: [['Lists']] },
  }),
  block('b1', 'bulleted_list', {
    properties: { title: [['Bullet one']] },
  }),
  block('b2', 'bulleted_list', {
    properties: { title: [['Bullet two']] },
  }),
  block('n1', 'numbered_list', {
    properties: { title: [['Number one']] },
  }),
  block('n2', 'numbered_list', {
    properties: { title: [['Number two']] },
  }),
]);

/** Code block with language */
export const codeBlocks: BlockMap = Object.fromEntries([
  block('page-code', 'page', {
    content: ['code-1'],
    properties: { title: [['Code']] },
  }),
  block('code-1', 'code', {
    properties: {
      title: [['const x = 42;']],
      language: [['TypeScript']],
    },
  }),
]);

/** Divider, quote, to_do, image, callout */
export const miscBlocks: BlockMap = Object.fromEntries([
  block('page-misc', 'page', {
    content: ['div-1', 'quote-1', 'todo-1', 'todo-2', 'img-1', 'callout-1'],
    properties: { title: [['Misc']] },
  }),
  block('div-1', 'divider', {}),
  block('quote-1', 'quote', {
    properties: { title: [['A wise quote']] },
  }),
  block('todo-1', 'to_do', {
    properties: { title: [['Done task']], checked: [['Yes']] },
  }),
  block('todo-2', 'to_do', {
    properties: { title: [['Pending task']], checked: [['No']] },
  }),
  block('img-1', 'image', {
    properties: { source: [['https://example.com/img.png']] },
  }),
  block('callout-1', 'callout', {
    properties: { title: [['Important note']] },
    format: { page_icon: '💡' },
  }),
]);

/** Toggle block with children */
export const toggleBlocks: BlockMap = Object.fromEntries([
  block('page-toggle', 'page', {
    content: ['toggle-1'],
    properties: { title: [['Toggle']] },
  }),
  block('toggle-1', 'toggle', {
    properties: { title: [['Click to expand']] },
    content: ['toggle-child-1'],
  }),
  block('toggle-child-1', 'text', {
    properties: { title: [['Hidden content']] },
  }),
]);

/** Table + table_row */
export const tableBlocks: BlockMap = Object.fromEntries([
  block('page-table', 'page', {
    content: ['table-1'],
    properties: { title: [['Table']] },
  }),
  block('table-1', 'table', {
    content: ['row-1', 'row-2', 'row-3'],
    format: { table_block_column_order: ['col-a', 'col-b', 'col-c'] },
  }),
  block('row-1', 'table_row', {
    properties: {
      'col-a': [['Name']],
      'col-b': [['Age']],
      'col-c': [['City']],
    },
  }),
  block('row-2', 'table_row', {
    properties: {
      'col-a': [['Alice']],
      'col-b': [['30']],
      'col-c': [['NYC']],
    },
  }),
  block('row-3', 'table_row', {
    properties: {
      'col-a': [['Bob']],
      'col-b': [['25']],
      'col-c': [['LA']],
    },
  }),
]);

/** Nested lists (children of list items) */
export const nestedListBlocks: BlockMap = Object.fromEntries([
  block('page-nested', 'page', {
    content: ['parent-1'],
    properties: { title: [['Nested']] },
  }),
  block('parent-1', 'bulleted_list', {
    properties: { title: [['Parent item']] },
    content: ['child-1', 'child-2'],
  }),
  block('child-1', 'bulleted_list', {
    properties: { title: [['Child one']] },
  }),
  block('child-2', 'bulleted_list', {
    properties: { title: [['Child two']] },
    content: ['grandchild-1'],
  }),
  block('grandchild-1', 'bulleted_list', {
    properties: { title: [['Grandchild']] },
  }),
]);

/** Complex page combining multiple block types */
export const complexPageBlocks: BlockMap = Object.fromEntries([
  block('page-complex', 'page', {
    content: ['cx-h1', 'cx-text', 'cx-list1', 'cx-list2', 'cx-div', 'cx-code', 'cx-quote'],
    properties: { title: [['Complex Page']] },
  }),
  block('cx-h1', 'header', {
    properties: { title: [['Introduction']] },
  }),
  block('cx-text', 'text', {
    properties: {
      title: [
        ['This is a '],
        ['complex', [['b']]],
        [' document with '],
        ['formatting', [['i']]],
      ],
    },
  }),
  block('cx-list1', 'bulleted_list', {
    properties: { title: [['First point']] },
  }),
  block('cx-list2', 'bulleted_list', {
    properties: { title: [['Second point']] },
  }),
  block('cx-div', 'divider', {}),
  block('cx-code', 'code', {
    properties: {
      title: [['console.log("hello")']],
      language: [['JavaScript']],
    },
  }),
  block('cx-quote', 'quote', {
    properties: { title: [['Final thought']] },
  }),
]);
