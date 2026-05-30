# Notion MCP Image Support — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Notion image upload actually work (it currently 400s), resolve images to viewable URLs on export, add a `notion_add_image` tool, and support downloading images on export.

**Architecture:** New infra module `src/notion-files.ts` owns upload (`getUploadFileUrl` → `PUT signedPutUrl` with `putHeaders` → store `attachment:<fileId>:<name>`) and export-side resolution (the `www.notion.so/image` proxy → public CDN URL, or download). The write flow is reordered to **create block → upload → patch source** (the bug: today we upload before the block exists). A thin `src/tools/images.ts` adds `notion_add_image`.

**Tech Stack:** TypeScript (ESM, `.js` import specifiers), Bun for dev/test (`bun test`), `node`-targeted build. Tests mock `globalThis.fetch`.

**All wire formats below are verified live** (see the spec's "Verified" section): `submitTransaction` works; `getUploadFileUrl` returns `{ type:'PUT', url:'attachment:<fileId>:<name>', signedPutUrl, putHeaders:[{name,value}], ... }`; PUT must send exactly `putHeaders`; viewing requires the `www.notion.so/image` proxy (cookie + browser UA) which 302s to a public `img.notionusercontent.com` URL.

**Branch:** `feat/images` (already created; spec committed there).

---

### Task 1: `uploadImageFile` — the upload primitive

**Files:**
- Create: `src/notion-files.ts`
- Test: `tests/notion-files.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/notion-files.test.ts`:

```ts
import { describe, test, expect, afterEach } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { uploadImageFile } from '../src/notion-files.js';

describe('uploadImageFile', () => {
  const realFetch = globalThis.fetch;
  afterEach(() => { globalThis.fetch = realFetch; });

  test('requests upload URL with the right body, then PUTs with putHeaders', async () => {
    const tmp = path.join(os.tmpdir(), `img-${crypto.randomUUID()}.png`);
    fs.writeFileSync(tmp, Buffer.from([1, 2, 3, 4, 5]));
    let getBody: any = null;
    let putHeaders: any = null;
    let putLen = -1;

    globalThis.fetch = (async (url: any, init: any) => {
      const u = String(url);
      if (u.endsWith('/getUploadFileUrl')) {
        getBody = JSON.parse(init.body);
        return new Response(
          JSON.stringify({
            type: 'PUT',
            url: 'attachment:FID-1:img.png',
            signedPutUrl: 'https://prod-files-secure.s3.us-west-2.amazonaws.com/put?sig=1',
            putHeaders: [
              { name: 'Content-Length', value: '5' },
              { name: 'x-amz-tagging', value: 'source=UserUpload' },
            ],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      putHeaders = init.headers;
      putLen = init.body.length ?? init.body.byteLength;
      return new Response('', { status: 200 });
    }) as typeof fetch;

    const res = await uploadImageFile(
      { token: 't', userId: 'u', spaceId: 'sp' },
      { blockId: 'B1', localPath: tmp, name: 'img.png', contentType: 'image/png', bytes: 5 },
    );
    fs.unlinkSync(tmp);

    expect(res).toEqual({ source: 'attachment:FID-1:img.png', size: '5' });
    expect(getBody.record.id).toBe('B1');
    expect(getBody.record.spaceId).toBe('sp');
    expect(getBody.contentLength).toBe(5);
    expect(getBody.supportExtraHeaders).toBe(true);
    expect(putHeaders['x-amz-tagging']).toBe('source=UserUpload');
    expect(putLen).toBe(5);
  });

  test('throws a clear error when S3 rejects the PUT', async () => {
    const tmp = path.join(os.tmpdir(), `img-${crypto.randomUUID()}.png`);
    fs.writeFileSync(tmp, Buffer.from([9]));
    globalThis.fetch = (async (url: any) => {
      if (String(url).endsWith('/getUploadFileUrl')) {
        return new Response(
          JSON.stringify({ type: 'PUT', url: 'attachment:F:img.png', signedPutUrl: 'https://s3/put', putHeaders: [] }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      return new Response('AccessDenied', { status: 403 });
    }) as typeof fetch;

    await expect(
      uploadImageFile({ token: 't', userId: 'u', spaceId: 'sp' }, { blockId: 'B', localPath: tmp, name: 'img.png', contentType: 'image/png', bytes: 1 }),
    ).rejects.toThrow('S3 upload failed');
    fs.unlinkSync(tmp);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/notion-files.test.ts`
Expected: FAIL — `Cannot find module '../src/notion-files.js'`.

- [ ] **Step 3: Write minimal implementation**

Create `src/notion-files.ts`:

```ts
import * as fs from 'fs';
import type { NotionConfig } from './types.js';
import { notionPost } from './notion-client.js';

// Upload one local image to Notion. The image block MUST already exist — getUploadFileUrl
// validates the block's ancestor path (a missing/uncreated block → 400 incomplete_ancestor_path),
// so callers create the block first, then call this.
export async function uploadImageFile(
  config: NotionConfig,
  args: { blockId: string; localPath: string; name: string; contentType: string; bytes: number },
): Promise<{ source: string; size: string }> {
  const { blockId, localPath, name, contentType, bytes } = args;
  const up = await notionPost(config, 'getUploadFileUrl', {
    bucket: 'secure',
    name,
    contentType,
    record: { table: 'block', id: blockId, spaceId: config.spaceId },
    supportExtraHeaders: true,
    contentLength: bytes,
  });
  if (!up.signedPutUrl || !up.url) {
    throw new Error(`getUploadFileUrl returned no upload target for ${name}`);
  }
  // PUT must send exactly the headers Notion signed (Content-Length, x-amz-tagging);
  // omitting them yields 403 SignatureDoesNotMatch.
  const headers: Record<string, string> = {};
  for (const h of up.putHeaders ?? []) headers[h.name] = h.value;
  const fileBytes = fs.readFileSync(localPath);
  const res = await fetch(up.signedPutUrl, { method: 'PUT', headers, body: fileBytes });
  if (!res.ok) {
    throw new Error(`S3 upload failed for ${name} (${res.status}): ${(await res.text()).slice(0, 300)}`);
  }
  // up.url is already "attachment:<fileId>:<name>" — store it verbatim as the block source.
  return { source: up.url, size: String(bytes) };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/notion-files.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/notion-files.ts tests/notion-files.test.ts
git commit -m "feat(images): uploadImageFile — getUploadFileUrl + PUT with putHeaders"
```

---

### Task 2: `uploadImagesForBlocks` + `buildImagePatchOps`

**Files:**
- Modify: `src/notion-files.ts`
- Test: `tests/notion-files.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `tests/notion-files.test.ts`:

```ts
import { uploadImagesForBlocks, buildImagePatchOps } from '../src/notion-files.js';

describe('uploadImagesForBlocks + buildImagePatchOps', () => {
  const realFetch = globalThis.fetch;
  afterEach(() => { globalThis.fetch = realFetch; });

  test('uploads only imageUpload blocks, patches them in place, builds update ops', async () => {
    const tmp = path.join(os.tmpdir(), `b-${crypto.randomUUID()}.png`);
    fs.writeFileSync(tmp, Buffer.from([1, 2, 3]));
    globalThis.fetch = (async (url: any) => {
      if (String(url).endsWith('/getUploadFileUrl')) {
        return new Response(
          JSON.stringify({ type: 'PUT', url: 'attachment:F9:b.png', signedPutUrl: 'https://s3/put', putHeaders: [] }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      return new Response('', { status: 200 });
    }) as typeof fetch;

    const blocks: any[] = [
      { id: 'T1', type: 'text', properties: { title: [['hi']] } },
      { id: 'I1', type: 'image', properties: {}, imageUpload: { localPath: tmp, name: 'b.png', contentType: 'image/png', bytes: 3 } },
    ];
    const uploaded = await uploadImagesForBlocks({ token: 't', userId: 'u', spaceId: 'sp' }, blocks);
    fs.unlinkSync(tmp);

    expect(uploaded.map((b) => b.id)).toEqual(['I1']);
    expect(blocks[1].imageUpload).toBeUndefined();
    expect(blocks[1].properties.source).toEqual([['attachment:F9:b.png']]);
    expect(blocks[1].format.display_source).toBe('attachment:F9:b.png');

    const ops = buildImagePatchOps(uploaded);
    expect(ops).toHaveLength(1);
    expect(ops[0]).toMatchObject({ id: 'I1', table: 'block', command: 'update' });
    expect(ops[0].args.properties.source).toEqual([['attachment:F9:b.png']]);
    expect(ops[0].args.format.display_source).toBe('attachment:F9:b.png');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/notion-files.test.ts`
Expected: FAIL — `uploadImagesForBlocks` / `buildImagePatchOps` are not exported.

- [ ] **Step 3: Write minimal implementation**

Add to `src/notion-files.ts` (new import of `NotionBlock`, and two functions):

```ts
// at top, extend the existing type import:
import type { NotionConfig, NotionBlock } from './types.js';
```

```ts
// Upload every block carrying an imageUpload, patching it in place with its attachment
// source + display format, and clearing imageUpload. Returns the patched image blocks.
export async function uploadImagesForBlocks(
  config: NotionConfig,
  blocks: NotionBlock[],
): Promise<NotionBlock[]> {
  const uploaded: NotionBlock[] = [];
  for (const b of blocks) {
    if (!b.imageUpload) continue;
    const { localPath, name, contentType, bytes } = b.imageUpload;
    const { source, size } = await uploadImageFile(config, { blockId: b.id, localPath, name, contentType, bytes });
    b.properties = { ...b.properties, source: [[source]], size: [[size]] };
    b.format = { ...(b.format ?? {}), display_source: source, block_width: 900, block_preserve_scale: true };
    delete b.imageUpload;
    uploaded.push(b);
  }
  return uploaded;
}

// Build submitTransaction `update` ops that write each already-uploaded image block's
// source/size/format. Runs as a second transaction, after the create transaction.
export function buildImagePatchOps(blocks: NotionBlock[]): any[] {
  return blocks.map((b) => ({
    id: b.id,
    table: 'block',
    path: [],
    command: 'update',
    args: { properties: b.properties, ...(b.format ? { format: b.format } : {}) },
  }));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/notion-files.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/notion-files.ts tests/notion-files.test.ts
git commit -m "feat(images): uploadImagesForBlocks + buildImagePatchOps"
```

---

### Task 3: Reorder the write flow in `import.ts` (the bug fix)

**Files:**
- Modify: `src/tools/import.ts`
- Test: `tests/tools/import.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `tests/tools/import.test.ts` (it already imports `appendMarkdownToPage`; add the node imports):

```ts
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

describe('image write ordering (regression: upload must follow create)', () => {
  const realFetch = globalThis.fetch;
  afterEach(() => { globalThis.fetch = realFetch; });

  test('getUploadFileUrl is called AFTER the create transaction; source is patched', async () => {
    const tmp = path.join(os.tmpdir(), `imp-${crypto.randomUUID()}.png`);
    fs.writeFileSync(tmp, Buffer.from([1, 2, 3, 4]));
    const uuid = '30fbd879-c5f0-80f8-a88a-c150e349d076';
    const calls: string[] = [];
    let patchOps: any[] | null = null;

    globalThis.fetch = (async (url: any, init: any) => {
      const u = String(url);
      if (u.endsWith('/put')) { calls.push('S3PUT'); return new Response('', { status: 200 }); }
      const endpoint = u.split('/').pop()!;
      calls.push(endpoint);
      const body = init?.body ? JSON.parse(init.body) : {};
      if (endpoint === 'syncRecordValues') {
        return new Response(
          JSON.stringify({ recordMap: { block: { [uuid]: { value: { value: { id: uuid, type: 'page', alive: true, content: [] } } } } } }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      if (endpoint === 'getUploadFileUrl') {
        return new Response(
          JSON.stringify({ type: 'PUT', url: 'attachment:FID:imp.png', signedPutUrl: 'https://s3.example/put', putHeaders: [] }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      if (endpoint === 'submitTransaction') {
        const ops = body.transactions[0].operations;
        if (ops.some((o: any) => o.command === 'update' && o.args?.properties?.source)) patchOps = ops;
      }
      return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
    }) as typeof fetch;

    await appendMarkdownToPage({ token: 't', userId: 'u', spaceId: 's' }, uuid, `![](${tmp})`);
    fs.unlinkSync(tmp);

    const firstCreate = calls.indexOf('submitTransaction');
    const upload = calls.indexOf('getUploadFileUrl');
    expect(firstCreate).toBeGreaterThanOrEqual(0);
    expect(upload).toBeGreaterThan(firstCreate); // the fix: upload AFTER create
    expect(calls.filter((c) => c === 'submitTransaction')).toHaveLength(2); // create + patch
    expect(calls).toContain('S3PUT');
    expect(patchOps).not.toBeNull();
    expect(patchOps!.some((o: any) => o.args.properties.source[0][0] === 'attachment:FID:imp.png')).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/tools/import.test.ts`
Expected: FAIL — current code calls `getUploadFileUrl` before create (order wrong) and the old `uploadLocalImages` PUTs differently; assertions on ordering / 2 transactions fail.

- [ ] **Step 3: Write the implementation**

In `src/tools/import.ts`:

1. Replace the markdown import line at the top:

```ts
import { markdownToNotionBlocks } from '../markdown/to-notion.js';
import { uploadImagesForBlocks, buildImagePatchOps } from '../notion-files.js';
```

2. Add `export` to `loadAlivePageBlock` and `submitOps` (needed by Task 4):

```ts
export async function loadAlivePageBlock(config: NotionConfig, id: string): Promise<NotionRawBlock> {
```

```ts
export async function submitOps(config: NotionConfig, operations: any[]): Promise<void> {
```

3. **Delete** the entire `uploadLocalImages` function (the old `getUploadFileUrl` → PUT → raw-URL block).

4. Replace the body of `importMarkdownToPage` (from the `markdownToNotionBlocks` line to the `return`) with:

```ts
  const newBlocks = markdownToNotionBlocks(markdown, id, baseDir);
  validateImageRefs(newBlocks, baseDir);
  // Create blocks first (image blocks are created empty). getUploadFileUrl requires the
  // block to already exist, so upload + patch the source in a second pass.
  await submitOps(config, buildCreateOps(id, newBlocks, config.spaceId));
  const uploaded = await uploadImagesForBlocks(config, newBlocks);
  if (uploaded.length > 0) await submitOps(config, buildImagePatchOps(uploaded));

  return `Updated page with ${newBlocks.length} blocks. Removed ${existingChildren.length} old blocks.`;
```

5. Replace the body of `appendMarkdownToPage` (from the `markdownToNotionBlocks` line to the `return`) with:

```ts
  const newBlocks = markdownToNotionBlocks(markdown, id, baseDir);
  validateImageRefs(newBlocks, baseDir);

  if (existingChildren.length > 0 && newBlocks.length > 0) {
    newBlocks[0].after = existingChildren[existingChildren.length - 1];
  }
  await submitOps(config, buildCreateOps(id, newBlocks, config.spaceId));
  const uploaded = await uploadImagesForBlocks(config, newBlocks);
  if (uploaded.length > 0) await submitOps(config, buildImagePatchOps(uploaded));

  return `Appended ${newBlocks.length} blocks after ${existingChildren.length} existing blocks.`;
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test tests/tools/import.test.ts`
Expected: PASS (existing `buildCreateOps`/`appendMarkdownToPage` tests + the new ordering test).

- [ ] **Step 5: Commit**

```bash
git add src/tools/import.ts tests/tools/import.test.ts
git commit -m "fix(images): create blocks before upload; patch attachment source (was 400)"
```

---

### Task 4: `notion_add_image` tool

**Files:**
- Create: `src/tools/images.ts`
- Modify: `src/markdown/to-notion.ts` (export `inferImageContentType`)
- Test: `tests/tools/images.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/tools/images.test.ts`:

```ts
import { describe, test, expect, afterEach } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { addImageToPage } from '../../src/tools/images.js';

const uuid = '30fbd879-c5f0-80f8-a88a-c150e349d076';

function mockPage(extra: (endpoint: string, body: any) => Response | null) {
  globalThis.fetch = (async (url: any, init: any) => {
    const u = String(url);
    if (u.endsWith('/put')) return new Response('', { status: 200 });
    const endpoint = u.split('/').pop()!;
    const body = init?.body ? JSON.parse(init.body) : {};
    if (endpoint === 'syncRecordValues') {
      return new Response(
        JSON.stringify({ recordMap: { block: { [uuid]: { value: { value: { id: uuid, type: 'page', alive: true, content: ['c1'] } } } } } }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }
    return extra(endpoint, body) ?? new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
}

describe('addImageToPage', () => {
  const realFetch = globalThis.fetch;
  afterEach(() => { globalThis.fetch = realFetch; });

  test('local file: create empty block, upload, patch source (2 transactions, no deletes)', async () => {
    const tmp = path.join(os.tmpdir(), `add-${crypto.randomUUID()}.png`);
    fs.writeFileSync(tmp, Buffer.from([1, 2, 3]));
    const ops: any[][] = [];
    mockPage((endpoint, body) => {
      if (endpoint === 'getUploadFileUrl') {
        return new Response(
          JSON.stringify({ type: 'PUT', url: 'attachment:F:add.png', signedPutUrl: 'https://s3.example/put', putHeaders: [] }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      if (endpoint === 'submitTransaction') ops.push(body.transactions[0].operations);
      return null;
    });

    const res = await addImageToPage({ token: 't', userId: 'u', spaceId: 's' }, uuid, tmp);
    fs.unlinkSync(tmp);

    expect(res).toContain('Uploaded image');
    expect(ops).toHaveLength(2);
    const flat = ops.flat();
    expect(flat.some((o) => o.command === 'listRemove')).toBe(false);
    expect(flat.some((o) => o.args && o.args.alive === false)).toBe(false);
    expect(ops[1].some((o: any) => o.args?.properties?.source?.[0]?.[0] === 'attachment:F:add.png')).toBe(true);
  });

  test('http url: single transaction, external reference, no upload', async () => {
    let uploadCalled = false;
    const ops: any[][] = [];
    mockPage((endpoint, body) => {
      if (endpoint === 'getUploadFileUrl') uploadCalled = true;
      if (endpoint === 'submitTransaction') ops.push(body.transactions[0].operations);
      return null;
    });

    const res = await addImageToPage({ token: 't', userId: 'u', spaceId: 's' }, uuid, 'https://example.com/x.png');

    expect(res).toContain('external image');
    expect(uploadCalled).toBe(false);
    expect(ops).toHaveLength(1);
    expect(ops[0].some((o: any) => o.args?.properties?.source?.[0]?.[0] === 'https://example.com/x.png')).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/tools/images.test.ts`
Expected: FAIL — `Cannot find module '../../src/tools/images.js'`.

- [ ] **Step 3: Write the implementation**

In `src/markdown/to-notion.ts`, change `function inferImageContentType` to `export function inferImageContentType` (keep the body identical).

Create `src/tools/images.ts`:

```ts
import * as fs from 'fs';
import * as path from 'path';
import type { NotionConfig, NotionBlock } from '../types.js';
import { parsePageId } from '../notion-client.js';
import { richText, inferImageContentType } from '../markdown/to-notion.js';
import { loadAlivePageBlock, submitOps, buildCreateOps } from './import.js';
import { uploadImageFile, buildImagePatchOps } from '../notion-files.js';

// Append a single image to the end of a page. Local file → upload; http(s) URL → external ref.
export async function addImageToPage(
  config: NotionConfig,
  pageId: string,
  imagePath: string,
  caption?: string,
): Promise<string> {
  const id = parsePageId(pageId);
  const pageBlock = await loadAlivePageBlock(config, id);
  const existing: string[] = pageBlock.content ?? [];
  const after = existing.length ? existing[existing.length - 1] : undefined;
  const blockId = crypto.randomUUID();
  const captionProp = caption ? { caption: richText(caption) } : {};

  if (/^https?:\/\//i.test(imagePath)) {
    const block: NotionBlock = {
      id: blockId,
      type: 'image',
      after,
      properties: { source: [[imagePath]], ...captionProp },
      format: { display_source: imagePath, block_width: 900, block_preserve_scale: true },
    };
    await submitOps(config, buildCreateOps(id, [block], config.spaceId));
    return `Added external image to page ${id}.`;
  }

  const stat = fs.statSync(imagePath); // throws ENOENT for a missing file
  const name = path.basename(imagePath);
  const contentType = inferImageContentType(imagePath);

  // Create the empty image block first so getUploadFileUrl has a valid ancestor path.
  const empty: NotionBlock = { id: blockId, type: 'image', after, properties: { ...captionProp } };
  await submitOps(config, buildCreateOps(id, [empty], config.spaceId));

  const { source, size } = await uploadImageFile(config, { blockId, localPath: imagePath, name, contentType, bytes: stat.size });
  const patched: NotionBlock = {
    id: blockId,
    type: 'image',
    properties: { source: [[source]], size: [[size]], ...captionProp },
    format: { display_source: source, block_width: 900, block_preserve_scale: true },
  };
  await submitOps(config, buildImagePatchOps([patched]));
  return `Uploaded image "${name}" (${stat.size} bytes) to page ${id}.`;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test tests/tools/images.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/tools/images.ts src/markdown/to-notion.ts tests/tools/images.test.ts
git commit -m "feat(images): notion_add_image tool (upload local / reference remote)"
```

---

### Task 5: Register `notion_add_image` in the MCP handler

**Files:**
- Modify: `src/mcp-handler.ts`
- Test: `tests/tools/images.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `tests/tools/images.test.ts`:

```ts
import { TOOLS } from '../../src/mcp-handler.js';

describe('notion_add_image registration', () => {
  test('is listed with the expected schema', () => {
    const tool = TOOLS.find((t) => t.name === 'notion_add_image');
    expect(tool).toBeDefined();
    expect(tool!.inputSchema.required).toContain('page_id');
    expect(tool!.inputSchema.required).toContain('image_path');
    expect(Object.keys(tool!.inputSchema.properties)).toContain('caption');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/tools/images.test.ts`
Expected: FAIL — `notion_add_image` not found in `TOOLS`.

- [ ] **Step 3: Write the implementation**

In `src/mcp-handler.ts`:

1. Add the import (next to the other tool imports):

```ts
import { addImageToPage } from './tools/images.js';
```

2. Add this entry to the `TOOLS` array (after the `notion_create_page_from_file` entry):

```ts
  {
    name: 'notion_add_image',
    description: 'Add an image to the END of a Notion page. `image_path` is either an absolute path to a local image file (uploaded to Notion) or an http(s) URL (referenced as an external image). Non-destructive — appended after existing blocks.',
    inputSchema: {
      type: 'object',
      properties: {
        page_id: { type: 'string', description: 'Notion page ID (32-char hex) or full Notion URL' },
        image_path: { type: 'string', description: 'Absolute path to a local image file, or an http(s) image URL' },
        caption: { type: 'string', description: 'Optional caption (also used as markdown alt text on export)' },
      },
      required: ['page_id', 'image_path'],
    },
  },
```

3. Add this `case` inside the `switch (name)` block (after `notion_create_page_from_file`):

```ts
        case 'notion_add_image':
          text = await addImageToPage(config, args.page_id, args.image_path, args.caption);
          break;
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test tests/tools/images.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/mcp-handler.ts tests/tools/images.test.ts
git commit -m "feat(images): register notion_add_image in MCP handler"
```

---

### Task 6: Export resolution — signed-URL (CDN) mode

**Files:**
- Modify: `src/notion-files.ts`
- Test: `tests/notion-files.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `tests/notion-files.test.ts`:

```ts
import { resolveImages } from '../src/notion-files.js';

describe('resolveImages — signed URL (CDN) mode', () => {
  const realFetch = globalThis.fetch;
  afterEach(() => { globalThis.fetch = realFetch; });

  test('rewrites an attachment source to the CDN url from the proxy 302', async () => {
    let requested = '';
    globalThis.fetch = (async (url: any) => {
      requested = String(url);
      return new Response(null, { status: 302, headers: { location: 'https://img.notionusercontent.com/s3/abc?sig=1' } });
    }) as typeof fetch;

    const blockMap: any = { B1: { value: { id: 'B1', type: 'image', properties: { source: [['attachment:FID:p.png']] } } } };
    const r = await resolveImages({ token: 't', userId: 'u', spaceId: 'SP' }, blockMap);

    expect(r).toEqual({ resolved: 1, failed: 0 });
    expect(blockMap.B1.value.properties.source).toEqual([['https://img.notionusercontent.com/s3/abc?sig=1']]);
    expect(requested).toContain('https://www.notion.so/image/');
    expect(requested).toContain('table=block&id=B1');
  });

  test('leaves external (non-notion) image sources untouched', async () => {
    let called = false;
    globalThis.fetch = (async () => { called = true; return new Response(null, { status: 302, headers: { location: 'x' } }); }) as typeof fetch;

    const blockMap: any = { B1: { value: { id: 'B1', type: 'image', properties: { source: [['https://example.com/a.png']] } } } };
    const r = await resolveImages({ token: 't', userId: 'u', spaceId: 'SP' }, blockMap);

    expect(called).toBe(false);
    expect(r).toEqual({ resolved: 0, failed: 0 });
    expect(blockMap.B1.value.properties.source).toEqual([['https://example.com/a.png']]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/notion-files.test.ts`
Expected: FAIL — `resolveImages` not exported.

- [ ] **Step 3: Write the implementation**

Add to `src/notion-files.ts` (extend the type import with `BlockMap`):

```ts
// extend the existing type import:
import type { NotionConfig, NotionBlock, BlockMap } from './types.js';
```

```ts
const BROWSER_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36';

// Notion-hosted file hosts whose sources must be proxy-resolved to be viewable.
const NOTION_FILE_HOST_RE = /(prod-files-secure|secure\.notion-static\.com|s3\.[a-z0-9-]+\.amazonaws\.com|file\.notion\.so)/i;

function cookieFor(config: NotionConfig): string {
  return `token_v2=${config.token}; notion_user_id=${config.userId}`;
}

// The inner S3 URL behind an image source, for the www.notion.so/image proxy.
// Returns null for external/non-notion sources (which are already viewable).
function innerS3Url(source: string, spaceId: string): string | null {
  if (source.startsWith('attachment:')) {
    const rest = source.slice('attachment:'.length);
    const sep = rest.indexOf(':');
    if (sep === -1) return null;
    const fileId = rest.slice(0, sep);
    const fname = rest.slice(sep + 1);
    return `https://prod-files-secure.s3.us-west-2.amazonaws.com/${spaceId}/${fileId}/${fname}`;
  }
  if (/^https?:\/\//i.test(source) && NOTION_FILE_HOST_RE.test(source)) return source;
  return null;
}

function proxyUrl(inner: string, blockId: string): string {
  return `https://www.notion.so/image/${encodeURIComponent(inner)}?table=block&id=${blockId}&cache=v2`;
}

// Resolve a notion-hosted source to a publicly-fetchable CDN url (or null).
async function resolveToCdnUrl(config: NotionConfig, source: string, blockId: string): Promise<string | null> {
  const inner = innerS3Url(source, config.spaceId);
  if (!inner) return null;
  const res = await fetch(proxyUrl(inner, blockId), {
    headers: { 'user-agent': BROWSER_UA, cookie: cookieFor(config), accept: 'image/*,*/*' },
    redirect: 'manual',
  });
  return res.headers.get('location');
}

// Rewrite image-block sources in the blockMap so they render in markdown.
// (Download mode is added in the next task.)
export async function resolveImages(
  config: NotionConfig,
  blockMap: BlockMap,
  _opts: { imageDir?: string } = {},
): Promise<{ resolved: number; failed: number }> {
  let resolved = 0;
  let failed = 0;
  for (const [blockId, entry] of Object.entries(blockMap)) {
    if (entry.value.type !== 'image') continue;
    const src = entry.value.properties?.source?.[0]?.[0];
    if (!src) continue;
    if (/^https?:\/\//i.test(src) && !NOTION_FILE_HOST_RE.test(src)) continue; // external → leave
    try {
      const cdn = await resolveToCdnUrl(config, src, blockId);
      if (!cdn) { failed++; continue; }
      entry.value.properties = { ...entry.value.properties, source: [[cdn]] };
      resolved++;
    } catch {
      failed++;
    }
  }
  return { resolved, failed };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test tests/notion-files.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/notion-files.ts tests/notion-files.test.ts
git commit -m "feat(images): resolveImages — proxy 302 -> public CDN url (signed-url mode)"
```

---

### Task 7: Export resolution — download mode

**Files:**
- Modify: `src/notion-files.ts`
- Test: `tests/notion-files.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `tests/notion-files.test.ts`:

```ts
describe('resolveImages — download mode', () => {
  const realFetch = globalThis.fetch;
  afterEach(() => { globalThis.fetch = realFetch; });

  test('downloads bytes and rewrites source to a local path', async () => {
    const dir = path.join(os.tmpdir(), `imgs-${crypto.randomUUID()}`);
    globalThis.fetch = (async () =>
      new Response(Buffer.from([8, 8, 8]), { status: 200, headers: { 'content-type': 'image/png' } })) as typeof fetch;

    const blockMap: any = { Bxyz1234abcd: { value: { id: 'Bxyz1234abcd', type: 'image', properties: { source: [['attachment:FID:pic.png']] } } } };
    const r = await resolveImages({ token: 't', userId: 'u', spaceId: 'SP' }, blockMap, { imageDir: dir });

    expect(r).toEqual({ resolved: 1, failed: 0 });
    const link = blockMap.Bxyz1234abcd.value.properties.source[0][0];
    expect(link.startsWith(`${path.basename(dir)}/`)).toBe(true);
    const onDisk = path.join(dir, path.basename(link));
    expect(fs.existsSync(onDisk)).toBe(true);
    expect(fs.readFileSync(onDisk)).toEqual(Buffer.from([8, 8, 8]));
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/notion-files.test.ts`
Expected: FAIL — `imageDir` is ignored (`_opts`), so the source isn't rewritten to a local path.

- [ ] **Step 3: Write the implementation**

In `src/notion-files.ts`, add `import * as path from 'path';` at the top (alongside `import * as fs from 'fs';`). Then add the byte-fetch + filename helpers and rewrite `resolveImages`:

```ts
async function fetchImageBytes(
  config: NotionConfig,
  source: string,
  blockId: string,
): Promise<{ buffer: Buffer; contentType: string } | null> {
  const inner = innerS3Url(source, config.spaceId);
  if (!inner) return null;
  const res = await fetch(proxyUrl(inner, blockId), {
    headers: { 'user-agent': BROWSER_UA, cookie: cookieFor(config), accept: 'image/*,*/*' },
  });
  if (!res.ok) return null;
  return { buffer: Buffer.from(await res.arrayBuffer()), contentType: res.headers.get('content-type') ?? 'application/octet-stream' };
}

const EXT_BY_TYPE: Record<string, string> = {
  'image/png': '.png', 'image/jpeg': '.jpg', 'image/gif': '.gif', 'image/webp': '.webp', 'image/svg+xml': '.svg',
};

function fileNameFor(source: string, blockId: string, contentType: string): string {
  let base = '';
  if (source.startsWith('attachment:')) {
    const rest = source.slice('attachment:'.length);
    base = rest.slice(rest.indexOf(':') + 1);
  } else {
    try { base = decodeURIComponent(new URL(source).pathname.split('/').pop() ?? ''); } catch { base = ''; }
  }
  if (!base) base = 'image';
  if (!path.extname(base) && EXT_BY_TYPE[contentType]) base += EXT_BY_TYPE[contentType];
  return `${blockId.slice(0, 8)}-${base.replace(/[^A-Za-z0-9._-]/g, '_')}`;
}
```

Replace the `resolveImages` function with the version that branches on `imageDir`:

```ts
export async function resolveImages(
  config: NotionConfig,
  blockMap: BlockMap,
  opts: { imageDir?: string } = {},
): Promise<{ resolved: number; failed: number }> {
  const { imageDir } = opts;
  if (imageDir) fs.mkdirSync(imageDir, { recursive: true });
  let resolved = 0;
  let failed = 0;
  for (const [blockId, entry] of Object.entries(blockMap)) {
    if (entry.value.type !== 'image') continue;
    const src = entry.value.properties?.source?.[0]?.[0];
    if (!src) continue;
    if (/^https?:\/\//i.test(src) && !NOTION_FILE_HOST_RE.test(src)) continue; // external → leave
    try {
      if (imageDir) {
        const got = await fetchImageBytes(config, src, blockId);
        if (!got) { failed++; continue; }
        const fname = fileNameFor(src, blockId, got.contentType);
        fs.writeFileSync(path.join(imageDir, fname), got.buffer);
        entry.value.properties = { ...entry.value.properties, source: [[`${path.basename(imageDir)}/${fname}`]] };
        resolved++;
      } else {
        const cdn = await resolveToCdnUrl(config, src, blockId);
        if (!cdn) { failed++; continue; }
        entry.value.properties = { ...entry.value.properties, source: [[cdn]] };
        resolved++;
      }
    } catch {
      failed++;
    }
  }
  return { resolved, failed };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test tests/notion-files.test.ts`
Expected: PASS (6 tests — signed-url tests still green, download test passes).

- [ ] **Step 5: Commit**

```bash
git add src/notion-files.ts tests/notion-files.test.ts
git commit -m "feat(images): resolveImages download mode (save locally + local link)"
```

---

### Task 8: Wire export — caption alt text, `image_dir` param, resolution call

**Files:**
- Modify: `src/markdown/from-notion.ts`
- Modify: `src/tools/export.ts`
- Modify: `src/mcp-handler.ts`
- Test: `tests/markdown/from-notion.test.ts`, `tests/markdown/export.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `tests/markdown/from-notion.test.ts`:

```ts
test('image block renders its caption as markdown alt text', () => {
  const blockMap: any = {
    root: { value: { id: 'root', type: 'page', content: ['img1'], properties: { title: [['t']] } } },
    img1: { value: { id: 'img1', type: 'image', properties: { source: [['https://cdn/x.png']], caption: [['A cat']] } } },
  };
  expect(blocksToMarkdown(blockMap, 'root')).toContain('![A cat](https://cdn/x.png)');
});

test('image block with no caption renders empty alt', () => {
  const blockMap: any = {
    root: { value: { id: 'root', type: 'page', content: ['i'], properties: { title: [['t']] } } },
    i: { value: { id: 'i', type: 'image', properties: { source: [['u']] } } },
  };
  expect(blocksToMarkdown(blockMap, 'root')).toContain('![](u)');
});
```

Append to `tests/markdown/export.test.ts` (it should already import `exportPageMarkdown`; add `afterEach`/`describe` as needed):

```ts
import { describe, test, expect, afterEach } from 'bun:test';
import { exportPageMarkdown } from '../../src/tools/export.js';

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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test tests/markdown/from-notion.test.ts tests/markdown/export.test.ts`
Expected: FAIL — image renders `![](attachment:FID:p.png)` (no caption alt, no resolution).

- [ ] **Step 3: Write the implementation**

1. In `src/markdown/from-notion.ts`, replace the `case 'image'` block with:

```ts
      case 'image': {
        const src = block.properties?.source?.[0]?.[0] ?? '';
        const alt = richTextToMarkdown(block.properties?.caption as RichTextSegment[] | undefined);
        lines.push(`![${alt}](${src})`);
        lines.push('');
        break;
      }
```

2. In `src/tools/export.ts`, add the import and resolve before rendering. Change the import line:

```ts
import { notionPost, parsePageId, normalizeBlockMap } from '../notion-client.js';
import { blocksToMarkdown } from '../markdown/from-notion.js';
import { resolveImages } from '../notion-files.js';
```

Change the signature and add the resolution call right before `blocksToMarkdown`:

```ts
export async function exportPageMarkdown(
  config: NotionConfig,
  pageId: string,
  opts: { imageDir?: string } = {},
): Promise<string> {
```

```ts
  if (!allBlocks[id]) {
    throw new Error(`Page ${id} not found in response (check credentials or page access)`);
  }

  // Rewrite image sources to viewable urls (CDN link) or local files (when imageDir is set).
  await resolveImages(config, allBlocks, { imageDir: opts.imageDir });

  const md = blocksToMarkdown(allBlocks, id);
```

3. In `src/mcp-handler.ts`, add `image_dir` to the `notion_export_page` schema:

```ts
    name: 'notion_export_page',
    description: 'Export a Notion page as clean markdown. Converts headings, lists, code blocks, tables, bold/italic, links, images, and nested content into standard markdown. Image links resolve to viewable URLs; pass image_dir to download images locally and link to the files instead.',
    inputSchema: {
      type: 'object',
      properties: {
        page_id: { type: 'string', description: 'Notion page ID (32-char hex) or full Notion URL' },
        image_dir: { type: 'string', description: 'Optional absolute directory: download images here and link to the local files (markdown should be saved beside this folder). Without it, image links are public CDN URLs.' },
      },
      required: ['page_id'],
    },
```

And update the export case:

```ts
        case 'notion_export_page':
          text = await exportPageMarkdown(config, args.page_id, { imageDir: args.image_dir });
          break;
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test tests/markdown/from-notion.test.ts tests/markdown/export.test.ts`
Expected: PASS (existing export/from-notion tests + the 3 new ones).

- [ ] **Step 5: Run the full suite + typecheck**

Run: `bun test && bun run typecheck`
Expected: all green, no type errors.

- [ ] **Step 6: Commit**

```bash
git add src/markdown/from-notion.ts src/tools/export.ts src/mcp-handler.ts tests/markdown/from-notion.test.ts tests/markdown/export.test.ts
git commit -m "feat(images): export resolves images (CDN url / download); caption alt; image_dir param"
```

---

### Task 9: Docs + version bump

**Files:**
- Modify: `README.md`, `CLAUDE.md`, `package.json`, `server.json`

- [ ] **Step 1: Bump the version**

In `package.json` change `"version": "0.4.0"` → `"version": "0.5.0"`.
In `server.json` change the top-level `version` and each `packages[].version` from `0.4.0` → `0.5.0` (keep them in sync — grep first: `grep -n '0.4.0' server.json`).

- [ ] **Step 2: Update `CLAUDE.md`**

- Header: `(currently 0.4.0)` → `(currently 0.5.0)`.
- Architecture tree: add `src/notion-files.ts` (upload + export image resolution) and `src/tools/images.ts` (notion_add_image).
- Tools list: add `notion_add_image`; note `notion_export_page` now resolves images and accepts `image_dir`.
- Block-type table: the `![](path)` row already exists — update its note to "local files auto-uploaded (create→upload→patch); export resolves to a viewable CDN URL or downloads with image_dir".
- Move the image item out of "Resolved/Known gaps" framing: replace the 0.2.0 "local image upload shipped" line and the import-time wording with a "0.5.0: image upload fixed (was 400 — uploaded before block creation), export image resolution, notion_add_image, download-on-export" entry under Resolved.

- [ ] **Step 3: Update `README.md`**

- Add `notion_add_image` to the tools list with a one-line description.
- Note that `notion_export_page` resolves images to viewable URLs and supports `image_dir` for local download.
- Under any limitations/notes: external image URLs are referenced as-is (not re-uploaded).

- [ ] **Step 4: Verify build + suite**

Run: `bun run build && node dist/server.js <<< '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}'`
Expected: a JSON response whose `result.serverInfo.version` is `0.5.0`.

Run: `bun test && bun run typecheck`
Expected: green.

- [ ] **Step 5: Commit**

```bash
git add README.md CLAUDE.md package.json server.json
git commit -m "docs: image support + bump 0.5.0"
```

---

### Task 10: Integration test (credential-gated) — live round-trip

**Files:**
- Create: `tests/integration/images.test.ts`

This task confirms the whole feature end-to-end against a real workspace and is skipped automatically when credentials are absent (matching `tests/integration/export.test.ts`).

- [ ] **Step 1: Write the test**

Create `tests/integration/images.test.ts`:

```ts
import { describe, test, expect, beforeAll } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { NotionConfig } from '../../src/types.js';
import { addImageToPage } from '../../src/tools/images.js';
import { exportPageMarkdown } from '../../src/tools/export.js';

try {
  const envFile = await Bun.file(new URL('../../.env.test', import.meta.url)).text();
  for (const line of envFile.split('\n')) {
    const [key, ...val] = line.split('=');
    if (key && val.length) process.env[key.trim()] = val.join('=').trim();
  }
} catch {}

const hasCreds = process.env.NOTION_TOKEN && process.env.NOTION_USER_ID && process.env.NOTION_SPACE_ID;
// Set NOTION_TEST_PAGE to a sandbox page id to run this (it appends an image to that page).
const canRun = hasCreds && process.env.NOTION_TEST_PAGE;
const d = canRun ? describe : describe.skip;

d('integration: image round-trip', () => {
  let config: NotionConfig;
  beforeAll(() => {
    config = { token: process.env.NOTION_TOKEN!, userId: process.env.NOTION_USER_ID!, spaceId: process.env.NOTION_SPACE_ID! };
  });

  test('upload an image, then export resolves it to a fetchable url', async () => {
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
    const tmp = path.join(os.tmpdir(), `it-${crypto.randomUUID()}.png`);
    fs.writeFileSync(tmp, png);

    const res = await addImageToPage(config, process.env.NOTION_TEST_PAGE!, tmp);
    fs.unlinkSync(tmp);
    expect(res).toContain('Uploaded image');

    const md = await exportPageMarkdown(config, process.env.NOTION_TEST_PAGE!);
    const m = md.match(/!\[[^\]]*\]\((https:\/\/img\.notionusercontent\.com\/[^)]+)\)/);
    expect(m).not.toBeNull();

    const got = await fetch(m![1]);
    expect(got.ok).toBe(true);
    expect(got.headers.get('content-type')).toContain('image');
  }, 30000);
});
```

- [ ] **Step 2: Run it (gated)**

Run: `bun test tests/integration/images.test.ts`
Expected (no creds / no `NOTION_TEST_PAGE`): the suite is **skipped** (0 fail).
Expected (with `.env.test` creds + `NOTION_TEST_PAGE` set to the sandbox): PASS — uploads, exports, fetches the CDN image (200, content-type image/*).

- [ ] **Step 3: Commit**

```bash
git add tests/integration/images.test.ts
git commit -m "test(images): credential-gated live round-trip"
```

---

## Self-Review

**1. Spec coverage:**
- Fix local-image upload (write) → Tasks 1–3 (upload primitive, batch helpers, reorder). ✓
- Viewable URLs on export (read) → Task 6 (+ wiring Task 8). ✓
- `notion_add_image` tool → Tasks 4–5. ✓
- Download-on-export → Task 7 (+ `image_dir` wiring Task 8). ✓
- Caption → alt → Task 8. ✓
- Remote images kept external → Task 4 (http branch), Task 6/7 (external sources skipped). ✓
- Docs/version → Task 9. Integration → Task 10. ✓

**2. Placeholder scan:** No TBD/TODO; every code step shows full code; commands have expected output. ✓

**3. Type consistency:**
- `uploadImageFile(config, {blockId, localPath, name, contentType, bytes}) → {source, size}` — used identically in Tasks 1, 2, 4. ✓
- `uploadImagesForBlocks`, `buildImagePatchOps`, `resolveImages(config, blockMap, {imageDir?})` — signatures stable across Tasks 2, 3, 6, 7, 8. ✓
- `addImageToPage(config, pageId, imagePath, caption?)` — Tasks 4, 5, 10. ✓
- `exportPageMarkdown(config, pageId, {imageDir?})` — new optional 3rd arg is backward compatible with the existing 2-arg call sites. ✓
- Exports added to `import.ts` (`loadAlivePageBlock`, `submitOps`) consumed by `images.ts`. ✓
- `inferImageContentType` exported from `to-notion.ts`, consumed by `images.ts`. ✓

**Notes for the implementer:**
- Run `bun test && bun run typecheck` after each task; both must stay green.
- `tools/images.ts` imports from `tools/import.ts` — intentional reuse of the page-write helpers; do not duplicate them.
- The downloaded-image link convention is `<basename(image_dir)>/<file>` (assumes the markdown is saved next to the folder).
