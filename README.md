# @shck-dev/notion-mcp

MCP server for Notion using the **internal API** (cookie auth). No workspace admin access or OAuth integration setup needed — just your browser cookie.

## What it does

| Tool | Description |
|------|-------------|
| `notion_search` | Full-text search across your workspace |
| `notion_export_page` | Export any page as markdown |
| `notion_import_page` | Replace page content from markdown string |
| `notion_import_page_from_file` | Replace page content from a local `.md` file |

## Why this exists

The official Notion API requires workspace admin to create an integration, then explicitly share each page/database with it. This server uses the same internal API that the Notion web app uses — if you can see it in your browser, this tool can access it.

| | This MCP | Official Notion API |
|---|----------|-------------------|
| Setup | Paste 3 values from DevTools | Create integration, get admin approval, share pages |
| Page access | Everything you can see | Only explicitly shared pages |
| Markdown sync | Bidirectional (export + import) | Read-only blocks API |
| Auth | Cookie (token_v2) | OAuth / integration token |

**Trade-off**: The internal API is undocumented and may change. Token expires periodically (re-grab from browser).

## Setup

### 1. Get credentials from your browser

1. Open [notion.so](https://notion.so) in Chrome
2. Press **F12** → **Application** → **Cookies** → `www.notion.so`
3. Copy the `token_v2` cookie value → this is your `NOTION_TOKEN`
4. Press **F12** → **Network** tab, do any action in Notion
5. Find a POST request to `api/v3/*`, click it
6. From **Request Headers**: copy `x-notion-active-user-header` → this is your `NOTION_USER_ID`
7. From **Request Body** (Payload): find `spaceId` → this is your `NOTION_SPACE_ID`

### 2. Configure your MCP client

#### Claude Code

```bash
claude mcp add notion -- env NOTION_TOKEN=your_token NOTION_USER_ID=your_user_id NOTION_SPACE_ID=your_space_id bunx @shck-dev/notion-mcp
```

Or in `.mcp.json`:

```json
{
  "mcpServers": {
    "notion": {
      "command": "bunx",
      "args": ["@shck/notion-mcp"],
      "env": {
        "NOTION_TOKEN": "your_token_v2_value",
        "NOTION_USER_ID": "your_user_id",
        "NOTION_SPACE_ID": "your_space_id"
      }
    }
  }
}
```

#### Claude Desktop

Add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "notion": {
      "command": "bunx",
      "args": ["@shck/notion-mcp"],
      "env": {
        "NOTION_TOKEN": "your_token_v2_value",
        "NOTION_USER_ID": "your_user_id",
        "NOTION_SPACE_ID": "your_space_id"
      }
    }
  }
}
```

#### Cursor

Add to `.cursor/mcp.json` in your project (same format as above).

## Requirements

- [Bun](https://bun.sh) runtime (`curl -fsSL https://bun.sh/install | bash`)

## Limitations

- **Internal API**: undocumented, may break with Notion updates
- **Token expiry**: `token_v2` expires periodically, re-grab from browser when auth fails
- **No database support**: only pages (search, export, import)
- **Lossy markdown**: tables render as text rows, nested lists flatten, some formatting may simplify
- **Replace-only import**: import replaces all page content (no append/merge)

## License

MIT
