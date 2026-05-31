<div align="center">

[![MCP Badge](https://lobehub.com/badge/mcp/shck-dev-notion-mcp?style=plastic)](https://lobehub.com/mcp/shck-dev-notion-mcp)

# @shck-dev/notion-mcp

**Notion MCP Server — search, export, and import pages as markdown**

[![npm version](https://img.shields.io/npm/v/@shck-dev/notion-mcp)](https://www.npmjs.com/package/@shck-dev/notion-mcp)
[![npm downloads](https://img.shields.io/npm/dm/@shck-dev/notion-mcp)](https://www.npmjs.com/package/@shck-dev/notion-mcp)
[![license](https://img.shields.io/npm/l/@shck-dev/notion-mcp)](https://github.com/shck-dev/notion-mcp/blob/main/LICENSE)

No workspace admin. No OAuth. No page sharing.\
Just paste 3 values from your browser and go.

[Blog Post](https://shck.dev/blog/notion-mcp) | [GitHub](https://github.com/shck-dev/notion-mcp) | [npm](https://www.npmjs.com/package/@shck-dev/notion-mcp)

</div>

---

## Features

- **Search** — full-text search across your entire workspace
- **Export** — download any page as clean markdown (headings, lists, to-do, code blocks, tables, links, images with viewable URLs)
- **Import** — write markdown back to Notion pages (replaces content), from a string or local file
- **Append** — add markdown to the end of a page without touching existing content
- **Create** — spin up new child pages, optionally prefilled from a markdown string or file
- **Images** — upload a local image to a page, or reference an external URL
- **Comments** — list open discussions, add new comments, reply to threads
- **One-command setup** — `npx @shck-dev/notion-mcp init`: paste a browser "Copy as cURL" and it extracts + saves your credentials
- **Prompts & resources** — a `notion_setup` prompt and a `notion://guide` resource for in-client onboarding
- **Zero setup friction** — uses the same internal API as the Notion web app; if you can see it in your browser, this server can access it

## Tools

| Tool | Description |
|------|-------------|
| `notion_search` | Full-text search across all pages in your workspace |
| `notion_export_page` | Export any Notion page as markdown; image links resolve to viewable CDN URLs (pass `image_dir` to download images locally instead) |
| `notion_import_page` | Write markdown to a Notion page — **replaces** all existing content |
| `notion_import_page_from_file` | Write a local `.md` file to a page — **replaces** all content |
| `notion_append_to_page` | Append markdown to the **end** of a page (non-destructive) |
| `notion_append_to_page_from_file` | Append a local `.md` file to the end of a page (non-destructive) |
| `notion_create_page` | Create a new sub-page, optionally prefilled with markdown |
| `notion_create_page_from_file` | Create a new sub-page from a local `.md` file |
| `notion_add_image` | Append an image to the end of a page — local file is uploaded to Notion, http(s) URL is referenced as-is |
| `notion_list_comments` | List open discussion threads on a page |
| `notion_add_comment` | Start a new discussion — inline (anchored to text) or block-level |
| `notion_reply_comment` | Reply to an existing discussion thread |
| `notion_init` | Paste a browser "Copy as cURL" to extract & save credentials |

## Why not the official Notion API?

| | This MCP server | Official Notion API |
|---|----------|-------------------|
| **Setup** | Paste 3 values from DevTools | Create integration, get admin approval, share pages |
| **Page access** | Everything you can see | Only explicitly shared pages |
| **Markdown** | Bidirectional (export + import) | Read-only blocks API |
| **Auth** | Cookie (`token_v2`) | OAuth / integration token |

**Trade-off**: The internal API is undocumented and may change. Token expires periodically (re-grab from browser).

## Quick start

### Easiest: interactive setup

```bash
npx @shck-dev/notion-mcp init
```

Open Notion in Chrome → DevTools (F12) → **Network** → click any request to `notion.so/api/v3/…` → right-click → **Copy as cURL**, then paste it and press Ctrl-D. Your token, user id, and workspace id are extracted and saved to `~/.notion-mcp/config.json`. Then register the server — no `env` block needed:

```bash
claude mcp add notion -- npx @shck-dev/notion-mcp
```

Prefer to set the three values by hand? Steps below.

### 1. Get credentials from your browser

1. Open [notion.so](https://notion.so) in Chrome
2. Press **F12** → **Application** → **Cookies** → `www.notion.so`
3. Copy the `token_v2` cookie value → `NOTION_TOKEN`
4. Press **F12** → **Network** tab, do any action in Notion
5. Find a POST request to `api/v3/*`, click it
6. From **Request Headers**: copy `x-notion-active-user-header` → `NOTION_USER_ID`
7. From **Request Body** (Payload): find `spaceId` → `NOTION_SPACE_ID`

### 2. Configure your MCP client

#### Claude Code

```bash
claude mcp add notion -- env NOTION_TOKEN=your_token NOTION_USER_ID=your_user_id NOTION_SPACE_ID=your_space_id npx @shck-dev/notion-mcp
```

#### Claude Desktop / Cursor / any MCP client

Add to your MCP config (`claude_desktop_config.json`, `.cursor/mcp.json`, etc.):

```json
{
  "mcpServers": {
    "notion": {
      "command": "npx",
      "args": ["@shck-dev/notion-mcp"],
      "env": {
        "NOTION_TOKEN": "your_token_v2_value",
        "NOTION_USER_ID": "your_user_id",
        "NOTION_SPACE_ID": "your_space_id"
      }
    }
  }
}
```

## Requirements

- **Node.js ≥ 18** (for `npx`) — or [Bun](https://bun.sh). The published server is compiled to node-compatible JS, so Bun is no longer required to run it.

## Limitations

- **Internal API** — undocumented, may break with Notion updates
- **Token expiry** — `token_v2` expires periodically; re-grab from browser when auth fails
- **Databases** — database/collection pages don't export rows yet; sub-pages render as links and such pages return an explanatory note instead of empty output
- **Block granularity** — import replaces all content, append adds to the end (no in-place editing of individual blocks)
- **Lossy markdown** — some complex formatting may simplify during conversion (e.g. nested lists flatten on import)
- **External images** — http(s) image URLs added via `notion_add_image` (or embedded in markdown) are referenced as-is and not re-uploaded to Notion

## License

MIT
