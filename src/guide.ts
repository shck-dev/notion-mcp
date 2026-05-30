/** Setup guide text — shared by the CLI wizard, the notion_setup prompt, and the notion://guide resource. */
export const SETUP_GUIDE = `# Connect this server to Notion

1. Open Notion in **Chrome** and load any page.
2. Open DevTools (F12) → **Network** tab.
3. Click around so a request to \`notion.so/api/v3/...\` appears.
4. Right-click that request → **Copy** → **Copy as cURL**.
5. Run \`npx @shck-dev/notion-mcp init\` and paste it (or call the \`notion_init\` tool with it).

The server extracts your token_v2, user id, and workspace id and saves them to
\`~/.notion-mcp/config.json\` (file permissions 0600). Nothing is sent anywhere except Notion.`;
