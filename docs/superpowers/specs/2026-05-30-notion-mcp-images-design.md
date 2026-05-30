# Notion MCP — Images Support — Design Spec

- **Date:** 2026-05-30
- **Status:** Draft (design) — pending user review, then implementation plan
- **Origin:** brainstorming session triggered by "we have to implement images support for the MCP
  server", with a full browser cURL capture of Notion's image-upload flow against a sandbox page.

## Context

`CLAUDE.md` claims local image upload "shipped in 0.2.0" (`src/tools/import.ts` →
`uploadLocalImages`). **It is broken against current Notion.** A live probe of `getUploadFileUrl`
(both the body our code sends *and* the body the browser sends) returns:

```
400 ValidationError — "Unsaved transactions: Invalid ancestor path" (incomplete_ancestor_path)
```

`getUploadFileUrl` now requires the **image block to already exist** (with a valid parent chain)
before it will issue an upload URL. Our code calls `uploadLocalImages()` at `import.ts:163` —
**before** `buildCreateOps()`/`submitTransaction` creates the block at `:164`. So *every* local-image
import 400s at the upload step today.

The captured browser flow does the opposite, and reveals a second divergence — the stored source
format:

```
1. saveTransactions  → create the image block (set + parent + listAfter)      [block now exists]
2. getUploadFileUrl  → {bucket:"secure", name, contentType,
                        record:{table:"block", id:<imageBlockId>, spaceId},
                        supportExtraHeaders:true, contentLength:<bytes>}
3. POST  https://prod-files-secure.s3.us-west-2.amazonaws.com/  (multipart S3 POST-policy:
         fields Policy / X-Amz-Signature / X-Amz-Credential / key=<spaceId>/<fileId>/<name> / file)
4. saveTransactions  → properties.source = [["attachment:<fileId>:<name>"]],
                        properties.size   = [["447.9 KiB"]],
                        format.display_source = "attachment:<fileId>:<name>"
```

Key facts extracted from the capture:
- The block id used by `getUploadFileUrl.record` is the **image block's own UUID**, not the page id.
- The **`fileId`** is the middle segment of the S3 `key` (`<spaceId>/<fileId>/<name>`) and the stored
  source is `attachment:<fileId>:<name>` — **not** a raw S3 URL (which is what our code stores today).
- `contentLength` and `supportExtraHeaders:true` are sent (our code sends neither).

On the **read** side, `from-notion.ts` renders an image block as `![](<source>)` verbatim. When the
source is `attachment:<fileId>:<name>` (or a `secure.notion-static.com` / `prod-files-secure` URL), the
emitted markdown points at a non-viewable internal ref. Viewing requires a signed URL
(`getSignedFileUrls`).

## Scope (four capabilities, confirmed)

1. **Fix local-image upload (write).** Reorder to create-then-upload, switch to the
   `attachment:<fileId>:<name>` source, send `contentLength`/`supportExtraHeaders`. Covers
   `notion_import_page[_from_file]` and `notion_append_to_page[_from_file]`.
2. **Viewable URLs on export (read).** Resolve attachment/secure sources to signed URLs so exported
   `![](…)` is actually viewable.
3. **`notion_add_image` tool.** Upload one image file directly to a page (append), no markdown round-trip.
4. **Download-on-export.** Optional `image_dir` param: download images locally and link to the files.

### Decisions (from brainstorming)

- **Upload mechanism:** branch on the `getUploadFileUrl` response — multipart **S3 POST-policy** if the
  response carries POST `fields`/`signedUploadPostUrl`; **signed `PUT`** if it carries `signedPutUrl`.
  Send the browser's body (`supportExtraHeaders:true` + `contentLength`) in both cases. Robust to
  whichever Notion returns; the actual shape is confirmed against the sandbox during implementation.
- **Export default:** emit a **signed URL** (viewable immediately, expires ~1h). Passing `image_dir`
  switches to **download + local link**.
- **Remote images** (`![](https://…)`, or an http URL given to `notion_add_image`): kept as an
  **external reference** (no upload, current behavior).
- **Tool name:** `notion_add_image`.

### Non-goals (deferred)

- Re-uploading remote URLs into Notion (kept external).
- Video / audio / generic file blocks — images only this pass (the helper is file-type-agnostic enough
  to extend later).
- Cover images / page icons that are images (page-level, separate from content blocks).
- Nested-list indentation (unrelated pre-existing gap).

## Architecture

One new infra module plus one new tool; everything else is wiring.

```
src/
├── notion-files.ts        # NEW — upload, sign, download (sibling of notion-client.ts)
├── tools/
│   ├── images.ts          # NEW — notion_add_image tool
│   ├── import.ts          # CHANGED — reordered write flow, uses notion-files
│   └── export.ts          # CHANGED — resolve image sources before rendering
├── markdown/
│   └── from-notion.ts     # CHANGED — alt text from caption; (source already rendered)
└── mcp-handler.ts         # CHANGED — register notion_add_image; image_dir on export
```

`types.ts` needs no shape change: uploads use the existing `NotionBlock.imageUpload` field, and
captions ride in `properties.caption`.

**`notion-files.ts`** (pure-ish Notion file ops; takes `config`, does network):

- `uploadImageFile(config, { blockId, localPath, name, contentType, bytes }) → { source, size }`
  - `getUploadFileUrl` with `{ bucket:'secure', name, contentType, record:{table:'block', id:blockId,
    spaceId}, supportExtraHeaders:true, contentLength:bytes }`.
  - Upload the bytes: POST-policy or PUT, chosen from the response (see Decisions).
  - Derive `source = "attachment:<fileId>:<name>"` — `fileId` from the response `url`/`key` (parse the
    `<spaceId>/<fileId>/<name>` key; fall back to an explicit `fileId`/`url` field if present).
  - `size` = human string matching the UI (`"447.9 KiB"`); exact format confirmed on sandbox, with a
    byte-count fallback.
- `buildImagePatchOps(blocks, spaceId) → ops[]` — phase-3 `update` ops that set `properties.source`,
  `properties.size`, `format.display_source` (+ keep `block_width`/`block_preserve_scale`) on each
  uploaded image block. Pure (no network), unit-testable.
- `signImageSources(config, blockMap) → void` — collect image blocks whose source needs signing
  (attachment ref, `secure.notion-static.com`, `prod-files-secure`, `s3.*amazonaws`); batch
  `getSignedFileUrls` (`{ urls:[{ url, permissionRecord:{table:'block', id:blockId} }] }`); rewrite
  each block's `properties.source` in place to the signed URL. External `http(s)` sources are left
  untouched.
- `downloadImages(config, blockMap, dir) → void` — same collection + signing, then fetch each signed
  URL, write to `dir` (filename = sanitized name, deduped), and rewrite the source to
  `<basename(dir)>/<filename>` (the markdown is assumed saved as a sibling of `dir`; documented).

**`tools/images.ts`** — `addImageToPage(config, pageId, imagePath, caption?) → string`:
load alive page block, build **one** empty image block appended after the last child
(`buildCreateOps`), `submitTransaction`, then (local path) `uploadImageFile` + `buildImagePatchOps` +
`submitTransaction`; (http url) set source directly as external in the first transaction. Reuses the
`import.ts` helpers (`loadAlivePageBlock`, `buildCreateOps`, `submitOps` — exported as needed).

## Write flow (import / append / add-image)

The fix is ordering. For any markdown containing local images:

1. **Transaction 1 — create.** `buildCreateOps` creates all blocks. Image blocks are created **empty**
   (no source yet) but with their final UUIDs and parent chain. `submitTransaction`.
2. **Upload.** For each block carrying `imageUpload`, call `uploadImageFile(...)` (block now exists, so
   `getUploadFileUrl` succeeds). Collect `{source, size}` onto the block.
3. **Transaction 2 — patch.** `buildImagePatchOps` → `submitTransaction` sets source/size/format.

Text-only imports skip steps 2–3 entirely (no second transaction). `validateImageRefs` (relative path
without a file context) still runs **before** transaction 1, so we never create orphan empty image
blocks for an input we can't fulfill.

This replaces `uploadLocalImages` (which mutated blocks *before* creation). `to-notion.ts` already
tags local-image blocks with `imageUpload` and passes http/`attachment:` straight through — that part
is correct and unchanged.

## Read flow (export)

`exportPageMarkdown(config, pageId, { imageDir? })`:

1. Load chunks → `blockMap` (unchanged).
2. If `imageDir` → `downloadImages(config, blockMap, imageDir)`; else `signImageSources(config,
   blockMap)`. Either way the image blocks' sources are rewritten to something viewable **before**
   rendering, so `blocksToMarkdown` stays pure (no network).
3. `blocksToMarkdown` renders `![alt](source)` where `alt` = the block caption if present.

`from-notion.ts` change: read `properties.caption` (rich text) for the alt text; render `![alt](src)`.
Sources are already emitted from `properties.source[0][0]`.

## Error handling

- Missing/unreadable local file, unsupported extension → clear error before any transaction.
- Archived/trashed page → existing `loadAlivePageBlock` preflight (writes would be silently invisible).
- `getUploadFileUrl` non-200 → surface Notion's message (post-fix the ancestor-path 400 shouldn't recur).
- S3 upload non-2xx → error with status + first 300 chars (existing pattern).
- `getSignedFileUrls` failure on export → fall back to leaving the raw source and emit a one-line note
  rather than failing the whole export.
- Expired `token_v2` (401) → existing actionable auth-help message.

## Testing

All new logic is unit-tested with mocked `fetch` (offline), mirroring `tests/tools/import.test.ts`:

- **Ordering (the core bug):** assert `getUploadFileUrl` is called **after** the create
  `submitTransaction`, never before. Assert the request body carries `contentLength` +
  `supportExtraHeaders` and `record.id` = the image block's UUID.
- **Source derivation:** given a mocked response, assert `source === "attachment:<fileId>:<name>"`
  parsed from the `key`, and that `buildImagePatchOps` emits an `update` writing that source + format.
- **Upload branch:** POST-policy response → multipart POST; `signedPutUrl` response → PUT.
- **`signImageSources` / `downloadImages`:** attachment/secure sources get signed; external `http(s)`
  left alone; download writes files and rewrites to `<basename(dir)>/<file>`.
- **`from-notion`:** image block with a caption renders `![caption](src)`.
- **`notion_add_image`:** appends one image block (no `listRemove`/`alive:false`), two transactions.
- **Integration (credential-gated, sandbox):** round-trip — `notion_add_image` a real PNG, then
  `notion_export_page` and assert a signed, fetchable URL; this is also where the live wire shapes
  (POST vs PUT, `getSignedFileUrls` request/response, `size` string) are confirmed.

**Gate:** `bun test` green + `bun run typecheck` clean.

## Sequencing

Ordered, isolated commits on a `feat/images` branch:

- **WS1** — `notion-files.ts` `uploadImageFile` + `buildImagePatchOps` (+ unit tests).
- **WS2** — reorder `import.ts` write flow to use them; remove `uploadLocalImages`.
- **WS3** — `notion_add_image` (`tools/images.ts`) + register in `mcp-handler.ts`.
- **WS4** — export read path: `signImageSources` / `downloadImages`, `image_dir` param, caption alt.
- **WS5** — docs (`README.md`, `CLAUDE.md` — block-type table, tool list, known-gaps), version bump,
  `server.json` sync.

WS1+WS2 alone restore working uploads; WS3/WS4 add the new surface.

## Verified (sandbox round-trip — all spec unknowns resolved)

Confirmed live against the sandbox with self-cleaning test blocks:

- **Write transport:** `submitTransaction` returns 200 — keep it (no `saveTransactionsFanout` needed).
- **`getUploadFileUrl`** body `{ bucket:'secure', name, contentType, record:{table:'block',
  id:<imageBlockId>, spaceId}, supportExtraHeaders:true, contentLength }` →
  `{ type:'PUT', url:'attachment:<fileId>:<name>', signedPutUrl, signedGetUrl,
  putHeaders:[{name,value}], signedToken }`. **`url` is the ready-to-store source** — no key parsing.
- **Upload = `PUT signedPutUrl`** sending **exactly** the returned `putHeaders` (`Content-Length`,
  `x-amz-tagging`). Omitting them → `403 SignatureDoesNotMatch`. With them → 200. (So the spec's
  "branch on POST/PUT" is settled: it's PUT-with-headers.)
- **`size`** accepts a plain byte-count string (`"70"`) — no `"447.9 KiB"` formatting needed.
- **Read-back** persists `properties.source = attachment:<fileId>:<name>`, `format.display_source` same.
- **Viewing/resolution:** `getSignedFileUrls` → `file.notion.so` URLs **always 403** — a dead end.
  The working path is the **image proxy**:
  `https://www.notion.so/image/<encodeURIComponent(s3Url)>?table=block&id=<blockId>&cache=v2`
  (with `token_v2` cookie + a browser User-Agent) → **302** to `https://img.notionusercontent.com/s3/…`,
  which **serves the bytes and is publicly fetchable with no cookie**. Here
  `s3Url = https://prod-files-secure.s3.us-west-2.amazonaws.com/<spaceId>/<fileId>/<name>`.
  - **signed-URL export** = the resolved `img.notionusercontent.com` CDN URL (renders anywhere; time-limited).
  - **download export** = fetch the proxy (cookie + UA, follow redirects) → bytes. Notion re-encodes,
    so the downloaded size differs from the source — tests assert `content-type`, not exact bytes.

## Remaining minor decision

- **Downloaded-image link convention** — default `<basename(image_dir)>/<file>` assumes the markdown is
  saved beside `image_dir`; revisit if a different layout is wanted.
