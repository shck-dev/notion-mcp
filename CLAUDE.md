# Notion MCP Server

MCP server for Notion using internal API (cookie auth, token_v2). No workspace admin or OAuth needed.

## Package

- **npm**: `@shck-dev/notion-mcp` (currently 0.1.4)
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
│   └── import.ts          # notion_import_page, notion_import_page_from_file
└── markdown/
    ├── to-notion.ts       # richText() + markdownToNotionBlocks()
    └── from-notion.ts     # richTextToMarkdown() + blocksToMarkdown()
```

## Auth

Three env vars: `NOTION_TOKEN`, `NOTION_USER_ID`, `NOTION_SPACE_ID` (from browser DevTools).

## Publishing

```bash
npm publish --access public --otp=<code>
```

## Do NOT commit
- `start.sh`, `node_modules/`
