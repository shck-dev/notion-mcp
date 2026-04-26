# Notion MCP Server

MCP server for Notion using internal API (cookie auth, token_v2). No workspace admin or OAuth needed.

## Package

- **npm**: `@shck-dev/notion-mcp` (currently 0.2.0)
- **GitHub**: `shck-dev/notion-mcp`
- **Runtime**: Bun (shebang `#!/usr/bin/env bun`), but also works via npx (npx triggers bun via shebang)
- **License**: MIT

## Architecture

```
src/
├── server.ts              # Entry point, MCP protocol, tool routing
├── notion-client.ts       # Config from env vars, notionPost(), parsePageId()
├── transport.ts           # stdio JSON-RPC newline-delimited transport
├── types.ts               # NotionConfig, NotionBlock interfaces
├── tools/
│   ├── search.ts          # notion_search
│   ├── export.ts          # notion_export_page
│   ├── import.ts          # notion_import_page, notion_import_page_from_file
│   ├── create-page.ts     # notion_create_page, notion_create_page_from_file
│   └── comments.ts        # notion_list_comments, notion_add_comment (anchor_text), notion_reply_comment
└── markdown/
    ├── to-notion.ts       # richText() + markdownToNotionBlocks()
    └── from-notion.ts     # richTextToMarkdown() + blocksToMarkdown()
```

## Auth

Three env vars: `NOTION_TOKEN`, `NOTION_USER_ID`, `NOTION_SPACE_ID` (from browser DevTools).

## Tools

- `notion_search` — full-text search across the workspace.
- `notion_export_page` — page → markdown (live read via `loadPageChunk`).
- `notion_import_page` / `notion_import_page_from_file` — replace a page's blocks with parsed markdown (string or local `.md`).
- `notion_create_page` / `notion_create_page_from_file` — create a sub-page under a parent, optionally populated from markdown (string or local `.md`); supports `icon`.
- `notion_list_comments` — list discussions + comments on a page (skips resolved unless `include_resolved`).
- `notion_add_comment` — start a discussion on a block. With `anchor_text`, anchors inline to that exact substring (yellow highlight in the UI); without it, attaches at block level.
- `notion_reply_comment` — append a reply to an existing discussion.

## Publishing

```bash
npm publish --access public --otp=<code>
```

## Do NOT commit
- `start.sh`, `node_modules/`

## Known gaps — next patch

Discovered while importing a markdown doc with local screenshots into Notion (Apr 2026, RJF project).

### 1. Markdown image import doesn't work

`![](./path/x.png)` in `notion_import_page_from_file` ends up as a broken reference — the server does not upload the local file. `![](attachment:UUID:name)` also doesn't produce an image block; it imports as a paragraph/link.

Required flow to actually render an image:

```
1. POST /api/v3/getUploadFileUrl
     body: { bucket: "secure", name, contentType, record: { table: "block", id: <imageBlockId>, spaceId } }
     → { url: "attachment:UUID:name", signedPutUrl }
2. PUT bytes to signedPutUrl with matching content-type header
3. Inside saveTransactionsFanout create an image block:
     type: "image", properties: { source: [[url]], size: [[String(bytes)]] },
     format: { display_source: url, block_width: 900, block_preserve_scale: true },
     parent_id, parent_table: "block", alive: true, space_id, created_*, last_edited_*
   …then listAfter it into the parent's content array.
```

**Critical**: `record.id` in step 1 MUST be the block that will render the file (i.e. the image block's own id — generate a UUID up-front and use it for both the upload scope and the block `set`). If `record.id` is the parent page id, Notion later returns 400 "user doesn't have access" when the client tries to fetch the file. Symptom in UI: the broken-image placeholder with that exact error.

Suggested patch:
- In `src/markdown/to-notion.ts`, detect `![alt](path)` where `path` is a local file ref.
- In the image block construction, pre-generate the block UUID, run the 2-step upload scoped to that UUID, then emit the image block with the returned `attachment:` URL.
- Keep the `listAfter` path for ordering.

Implementation in progress — see plan.

### 2. Imports silently write into archived pages

If the target page is in trash, `notion_import_page_from_file` still returns success ("Updated page with N blocks") but the blocks are invisible until the page is un-archived. Worth a preflight check: read the page block and warn/refuse if `alive: false`.

Implementation in progress — see plan.

### 3. Block type mapping reference

For anyone extending `to-notion.ts`:

| Markdown                  | Notion `type`    |
| ------------------------- | ---------------- |
| `# H1`                    | `header`         |
| `## H2`                   | `sub_header`     |
| `### H3`                  | `sub_sub_header` |
| paragraph                 | `text`           |
| `- item` / `* item`       | `bulleted_list`  |
| `1. item`                 | `numbered_list`  |
| `> quote`                 | `quote`          |
| ` ```lang `               | `code`           |
| `---`                     | `divider`        |
| `\| a \| b \|` table      | `table` (+ `table_row` children) |
| `![](path)`               | `image` (local upload — see gap #1) |

## Resolved

- Cache-lagged reads: `notion_export_page` and the comments tool both call `loadPageChunk` (live) — there is no `loadCachedPageChunk` usage and no internal verify-after-write logic to fix.
