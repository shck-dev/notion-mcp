import { describe, test, expect, afterEach } from 'bun:test';
import { blocksToMarkdown } from '../../src/markdown/from-notion.js';
import { exportPageMarkdown } from '../../src/tools/export.js';

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

describe('export resolves image sources to viewable urls', () => {
  const realFetch = globalThis.fetch;
  afterEach(() => { globalThis.fetch = realFetch; });

  test('attachment image source becomes the CDN url in the output markdown', async () => {
    const pageUuid = '370bd879-c5f0-8090-8729-e456e8ee6305';
    const imgId = '370bd879-c5f0-80bb-b26e-dd3ddfe36194';
    globalThis.fetch = (async (url: any) => {
      const u = String(url);
      if (u.includes('/api/v3/loadPageChunk')) {
        return new Response(
          JSON.stringify({
            recordMap: {
              block: {
                [pageUuid]: { value: { value: { id: pageUuid, type: 'page', content: [imgId], properties: { title: [['P']] } } } },
                [imgId]: { value: { value: { id: imgId, type: 'image', properties: { source: [[`attachment:FID:p.png`]] } } } },
              },
            },
            cursor: { stack: [] },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      // the www.notion.so/image proxy
      return new Response(null, { status: 302, headers: { location: 'https://img.notionusercontent.com/s3/zzz?sig=2' } });
    }) as typeof fetch;

    const md = await exportPageMarkdown({ token: 't', userId: 'u', spaceId: 's' }, pageUuid);
    expect(md).toContain('![](https://img.notionusercontent.com/s3/zzz?sig=2)');
  });
});
