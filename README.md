<div align="center">

[![MCP Badge](https://lobehub.com/badge/mcp/shck-dev-notion-mcp)](https://lobehub.com/mcp/shck-dev-notion-mcp)

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
- **Export** — download any page as clean markdown (headings, lists, code blocks, tables, links)
- **Import** — write markdown back to Notion pages, from a string or local file
- **Create** — spin up new child pages, optionally prefilled from a markdown string or file
- **Comments** — list open discussions, add new comments, reply to threads
- **Zero setup friction** — uses the same internal API as the Notion web app; if you can see it in your browser, this server can access it

## Tools

| Tool | Description |
|------|-------------|
| `notion_search` | Full-text search across all pages in your workspace |
| `notion_export_page` | Export any Notion page as markdown |
| `notion_import_page` | Write markdown content to a Notion page (replaces content) |
| `notion_import_page_from_file` | Write a local `.md` file to a Notion page |
| `notion_create_page` | Create a new sub-page, optionally prefilled with markdown |
| `notion_create_page_from_file` | Create a new sub-page from a local `.md` file |
| `notion_list_comments` | List open discussion threads on a page |
| `notion_add_comment` | Start a new discussion — inline (anchored to text) or block-level |
| `notion_reply_comment` | Reply to an existing discussion thread |

## Why not the official Notion API?

| | This MCP server | Official Notion API |
|---|----------|-------------------|
| **Setup** | Paste 3 values from DevTools | Create integration, get admin approval, share pages |
| **Page access** | Everything you can see | Only explicitly shared pages |
| **Markdown** | Bidirectional (export + import) | Read-only blocks API |
| **Auth** | Cookie (`token_v2`) | OAuth / integration token |

**Trade-off**: The internal API is undocumented and may change. Token expires periodically (re-grab from browser).

## Quick start

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
claude mcp add notion -- env NOTION_TOKEN=your_token NOTION_USER_ID=your_user_id NOTION_SPACE_ID=your_space_id bunx @shck-dev/notion-mcp
```

#### Claude Desktop / Cursor / any MCP client

Add to your MCP config (`claude_desktop_config.json`, `.cursor/mcp.json`, etc.):

```json
{
  "mcpServers": {
    "notion": {
      "command": "bunx",
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

- [Bun](https://bun.sh) runtime — `curl -fsSL https://bun.sh/install | bash`

## Limitations

- **Internal API** — undocumented, may break with Notion updates
- **Token expiry** — `token_v2` expires periodically; re-grab from browser when auth fails
- **Pages only** — no database queries (search, export, import work on pages)
- **Replace-only import** — import replaces all page content (no append/merge)
- **Lossy markdown** — some complex formatting may simplify during conversion

## License

MIT
