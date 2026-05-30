import { test, expect } from 'bun:test';
import { blocksToMarkdown } from '../../src/markdown/from-notion.js';

test('child sub-page blocks render as markdown links', () => {
  const map: any = {
    root: { value: { id: 'root', type: 'page', content: ['sub'] } },
    sub: { value: { id: 'sub', type: 'page', properties: { title: [['My Sub Page']] } } },
  };
  const md = blocksToMarkdown(map, 'root');
  expect(md).toContain('- [My Sub Page](https://www.notion.so/sub)');
});

test('a page whose only child has no renderable text yields empty markdown', () => {
  const map: any = {
    root: { value: { id: 'root', type: 'page', content: ['cv'] } },
    cv: { value: { id: 'cv', type: 'collection_view' } }, // database view: no title
  };
  expect(blocksToMarkdown(map, 'root').trim()).toBe('');
});
