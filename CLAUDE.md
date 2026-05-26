# Notion MCP Server

MCP server for Notion using internal API (cookie auth, token_v2). No workspace admin or OAuth needed.

## Package

- **npm**: `@shck-dev/notion-mcp` (currently 0.3.0)
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
│   ├── import.ts          # notion_import_page(_from_file), notion_append_to_page(_from_file), buildCreateOps()
│   ├── create-page.ts     # notion_create_page, notion_create_page_from_file
│   └── comments.ts        # notion_list_comments, notion_add_comment (anchor_text), notion_reply_comment
└── markdown/
    ├── to-notion.ts       # richText() + markdownToNotionBlocks()
    └── from-notion.ts     # richTextToMarkdown() + blocksToMarkdown()
```

## Auth

Three env vars: `NOTION_TOKEN`, `NOTION_USER_ID`, `NOTION_SPACE_ID` (from browser DevTools). On a 401 / `UnauthorizedError`, `notionPost` throws actionable guidance to re-grab the expired `token_v2` cookie.

## Tools

- `notion_search` — full-text search across the workspace.
- `notion_export_page` — page → markdown (live read via `loadPageChunk`).
- `notion_import_page` / `notion_import_page_from_file` — **replace** a page's blocks with parsed markdown (string or local `.md`). Destructive.
- `notion_append_to_page` / `notion_append_to_page_from_file` — append parsed markdown to the **end** of a page (string or local `.md`); existing blocks are left intact.
- `notion_create_page` / `notion_create_page_from_file` — create a sub-page under a parent, optionally populated from markdown (string or local `.md`); supports `icon`.
- `notion_list_comments` — list discussions + comments on a page (skips resolved unless `include_resolved`).
- `notion_add_comment` — start a discussion on a block. With `anchor_text`, anchors inline to that exact substring (yellow highlight in the UI); without it, attaches at block level.
- `notion_reply_comment` — append a reply to an existing discussion.

## Publishing

```bash
npm publish --access public --otp=<code>
```

Version lives in `package.json` and is read from there by `server.ts`; keep `server.json` in sync. Bump all when releasing.

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
| `![](path)`               | `image` (local files auto-uploaded) |

Inline decorations: `**bold**` → `b`, `*italic*` → `i`, `~~strike~~` → `s`, `` `code` `` → `c`, `[text](url)` → `a`.

## Known gaps

- **Forward nested-list indentation flattens** to top-level blocks. The reverse converter already renders nesting; importing it back requires an indent-aware parser plus a recursive `buildCreateOps`. Deferred — see `docs/superpowers/specs/2026-05-26-notion-mcp-0.3.0-design.md`.
- Toggles/callouts have no markdown-source mapping (reverse rendering only).

## Resolved

- Local image upload + archived-page preflight: shipped in 0.2.0 (`src/tools/import.ts`).
- To-do checkboxes, strikethrough, non-destructive append, and actionable auth-expiry errors: shipped in 0.3.0.
- Cache-lagged reads: `notion_export_page` and the comments tool both call `loadPageChunk` (live) — there is no `loadCachedPageChunk` usage and no internal verify-after-write logic to fix.
