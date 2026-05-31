# Notion MCP Server

MCP server for Notion using internal API (cookie auth, token_v2). No workspace admin or OAuth needed.

## Package

- **npm**: `@shck-dev/notion-mcp` (currently 0.5.1)
- **GitHub**: `shck-dev/notion-mcp`
- **Runtime**: ships a bundled, node-compatible `dist/server.js` (`#!/usr/bin/env node`), so `npx @shck-dev/notion-mcp` works without Bun. Built with `bun build` (`bun run build`); dev/test still use Bun.
- **License**: MIT

## Architecture

```
src/
├── server.ts              # Thin stdio entry; `init` argv → CLI wizard
├── mcp-handler.ts         # MCP protocol: TOOLS registry + JSON-RPC routing (testable, no transport)
├── notion-client.ts       # loadConfig() (env → file), notionPost(), parsePageId()
├── config-store.ts        # ~/.notion-mcp/config.json read/write (0600); NOTION_MCP_CONFIG_DIR override
├── cli-init.ts            # `notion-mcp init` interactive wizard (reads cURL from stdin)
├── guide.ts               # SETUP_GUIDE text (shared: CLI, prompt, resource)
├── prompts.ts             # notion_setup, notion_search_export
├── resources.ts           # notion://guide (static), notion://recent (dynamic)
├── transport.ts           # stdio JSON-RPC newline-delimited transport
├── notion-files.ts        # uploadImageFile(), uploadImagesForBlocks(), buildImagePatchOps(), resolveImages()
├── types.ts               # NotionConfig, NotionBlock interfaces
├── tools/
│   ├── init.ts            # parseCurl(), resolveSpaces(), notionInit() — the notion_init tool
│   ├── search.ts          # notion_search
│   ├── export.ts          # notion_export_page (resolves images; accepts image_dir for local download)
│   ├── import.ts          # notion_import_page(_from_file), notion_append_to_page(_from_file), buildCreateOps()
│   ├── create-page.ts     # notion_create_page, notion_create_page_from_file
│   ├── images.ts          # notion_add_image (local upload or external URL reference)
│   └── comments.ts        # notion_list_comments, notion_add_comment (anchor_text), notion_reply_comment
└── markdown/
    ├── to-notion.ts       # richText() + markdownToNotionBlocks()
    └── from-notion.ts     # richTextToMarkdown() + blocksToMarkdown() (child page → sub-page link)
```

## Auth

Credentials resolve **env → `~/.notion-mcp/config.json`** (env wins): `NOTION_TOKEN`, `NOTION_USER_ID`, `NOTION_SPACE_ID`. Easiest setup is `npx @shck-dev/notion-mcp init` (or the `notion_init` tool) — paste a browser "Copy as cURL" and it extracts + saves all three. `loadConfig()` is lazy, so the server still boots and lists tools/prompts/resources with **no credentials** (needed for marketplace validators); it only throws when a credentialed tool is actually called. `NOTION_MCP_CONFIG_DIR` overrides the config-file directory. On a 401 / `UnauthorizedError`, `notionPost` throws actionable guidance to re-grab the expired `token_v2` cookie.

## Tools

- `notion_search` — full-text search across the workspace.
- `notion_export_page` — page → markdown (live read via `loadPageChunk`); resolves notion-hosted images to public CDN URLs by default, or downloads them locally when `image_dir` is given.
- `notion_add_image` — append a single image to the end of a page. Local file → uploaded to Notion (create→upload→patch); http(s) URL → referenced as an external image.
- `notion_import_page` / `notion_import_page_from_file` — **replace** a page's blocks with parsed markdown (string or local `.md`). Destructive.
- `notion_append_to_page` / `notion_append_to_page_from_file` — append parsed markdown to the **end** of a page (string or local `.md`); existing blocks are left intact.
- `notion_create_page` / `notion_create_page_from_file` — create a sub-page under a parent, optionally populated from markdown (string or local `.md`); supports `icon`.
- `notion_list_comments` — list discussions + comments on a page (skips resolved unless `include_resolved`).
- `notion_add_comment` — start a discussion on a block. With `anchor_text`, anchors inline to that exact substring (yellow highlight in the UI); without it, attaches at block level.
- `notion_reply_comment` — append a reply to an existing discussion.
- `notion_init` — paste a browser "Copy as cURL" of any `/api/v3` request; extracts token/user/space and writes `~/.notion-mcp/config.json`. Runs credential-free; lists workspaces if there are several (pass `space_id` to pick).

## Prompts & Resources

- Prompts: `notion_setup` (init guide), `notion_search_export` (search → export the top hit). Listable without credentials.
- Resources: `notion://guide` (static setup/usage guide, credential-free), `notion://recent` (recent pages when credentials resolve).

## Publishing

```bash
npm publish --access public --otp=<code>
```

`prepublishOnly` runs `bun run build` → bundled `dist/server.js` (the published `bin`). Version lives in `package.json` (inlined into the bundle at build time); keep `server.json` and this file in sync. Bump all when releasing.

## Do NOT commit
- `start.sh`, `node_modules/`

## Block type mapping

For anyone extending `to-notion.ts` / `from-notion.ts`:

| Markdown                  | Notion `type`    |
| ------------------------- | ---------------- |
| `# H1`                    | `header`         |
| `## H2`                   | `sub_header`     |
| `### H3`                  | `sub_sub_header` |
| paragraph                 | `text`           |
| `- item` / `* item`       | `bulleted_list`  |
| `- [ ]` / `- [x]`         | `to_do`          |
| `1. item`                 | `numbered_list`  |
| `> quote`                 | `quote`          |
| ` ```lang `               | `code`           |
| `---`                     | `divider`        |
| `\| a \| b \|` table      | `table` (+ `table_row` children) |
| `![alt](path)`            | `image` (local files: create block → upload → patch source; export: resolves notion-hosted sources to CDN URL or downloads with `image_dir`; caption mapped to/from alt text) |

Inline decorations: `**bold**` → `b`, `*italic*` → `i`, `~~strike~~` → `s`, `` `code` `` → `c`, `[text](url)` → `a`.

## Known gaps

- **Forward nested-list indentation flattens** to top-level blocks. The reverse converter already renders nesting; importing it back requires an indent-aware parser plus a recursive `buildCreateOps`. Deferred — see `docs/superpowers/specs/2026-05-26-notion-mcp-0.3.0-design.md`.
- Toggles/callouts have no markdown-source mapping (reverse rendering only).
- **Databases/collection pages don't export rows.** `loadPageChunk` returns the `collection_view` block, not the rows (`queryCollection` needed). Such pages — and sub-page-only hubs — now render sub-page links + an explanatory note instead of silently empty; full database rendering is deferred (see the 0.4.0 spec).

## Resolved

- Archived-page preflight: shipped in 0.2.0 (`src/tools/import.ts`).
- To-do checkboxes, strikethrough, non-destructive append, and actionable auth-expiry errors: shipped in 0.3.0.
- Cache-lagged reads: `notion_export_page` and the comments tool both call `loadPageChunk` (live) — there is no `loadCachedPageChunk` usage and no internal verify-after-write logic to fix.
- 0.4.0: credential-free startup (lazy config), node-compatible `dist/` build (npx works without Bun), interactive cURL-based init (`notion-mcp init` CLI + `notion_init` tool), MCP prompts + resources, and sub-page-link / empty-export notes. LobeHub validation unblocked.
- 0.5.0: image upload fixed (the 400 was caused by calling `getUploadFileUrl` before the block existed; reordered to create→upload→patch); export now resolves notion-hosted image sources via the `www.notion.so/image` proxy to public `img.notionusercontent.com` CDN URLs (or downloads locally with `image_dir`); `notion_add_image` tool added; caption round-trips as markdown alt text.
