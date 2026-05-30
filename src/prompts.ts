/** MCP prompts exposed by the server. Listable without credentials. */
import { SETUP_GUIDE } from './guide.js';

export const PROMPTS = [
  {
    name: 'notion_setup',
    description: 'Connect this server to your Notion account by pasting a browser "Copy as cURL".',
    arguments: [],
  },
  {
    name: 'notion_search_export',
    description: 'Search your workspace and export the best-matching page as markdown.',
    arguments: [{ name: 'query', description: 'What to search for', required: true }],
  },
];

export function getPrompt(name: string, args: Record<string, string> = {}) {
  if (name === 'notion_setup') {
    return { messages: [{ role: 'user', content: { type: 'text', text: SETUP_GUIDE } }] };
  }
  if (name === 'notion_search_export') {
    const q = args.query ?? '';
    return {
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: `Use notion_search to find "${q}", then notion_export_page on the best match and show me the markdown.`,
          },
        },
      ],
    };
  }
  throw new Error(`Unknown prompt: ${name}`);
}
