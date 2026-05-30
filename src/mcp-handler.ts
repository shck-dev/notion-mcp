/**
 * MCP protocol handler for the Notion server: tool registry + JSON-RPC message routing.
 * Kept separate from the stdio entry point (server.ts) so it can be unit-tested without
 * starting the transport.
 */
import { loadConfig } from './notion-client.js';
import type { NotionConfig } from './types.js';
import { searchPages } from './tools/search.js';
import { exportPageMarkdown } from './tools/export.js';
import {
  importMarkdownToPage,
  importMarkdownFromFile,
  appendMarkdownToPage,
  appendMarkdownFromFile,
} from './tools/import.js';
import { createPage, createPageFromFile } from './tools/create-page.js';
import { addImageToPage } from './tools/images.js';
import { listComments, addComment, replyComment } from './tools/comments.js';
import { notionInit } from './tools/init.js';
import { PROMPTS, getPrompt } from './prompts.js';
import { RESOURCES, readResource } from './resources.js';
import pkg from '../package.json';

// Resolve config lazily and memoize it. The credential-free methods (initialize,
// tools/list, prompts/list, resources/list) never call this, so the server boots and
// enumerates its capabilities with no env vars — which is what marketplace validators need.
let _config: NotionConfig | null = null;
function getConfig(): NotionConfig {
  return (_config ??= loadConfig());
}

export const TOOLS = [
  {
    name: 'notion_search',
    description: 'Full-text search across all pages in your Notion workspace. Returns page titles, IDs, and last edited timestamps. Searches everything you can see in the browser — no need to explicitly share pages.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query (matches page titles and content)' },
        limit: { type: 'number', description: 'Maximum number of results to return (default: 10)' },
      },
      required: ['query'],
    },
  },
  {
    name: 'notion_export_page',
    description: 'Export a Notion page as clean markdown. Converts headings, lists, code blocks, tables, bold/italic, links, images, and nested content into standard markdown. Image links resolve to viewable URLs; pass image_dir to download images locally and link to the files instead.',
    inputSchema: {
      type: 'object',
      properties: {
        page_id: { type: 'string', description: 'Notion page ID (32-char hex) or full Notion URL' },
        image_dir: { type: 'string', description: 'Optional absolute directory: download images here and link to the local files (markdown should be saved beside this folder). Without it, image links are public CDN URLs.' },
      },
      required: ['page_id'],
    },
  },
  {
    name: 'notion_import_page',
    description: 'Write markdown content to a Notion page. DESTRUCTIVE: replaces ALL existing blocks on the page with content parsed from the markdown string. To add content without removing what is already there, use notion_append_to_page instead. Supports headings, lists, to-do checkboxes, code blocks, tables, and inline formatting (bold, italic, strikethrough, code, links).',
    inputSchema: {
      type: 'object',
      properties: {
        page_id: { type: 'string', description: 'Notion page ID (32-char hex) or full Notion URL' },
        markdown: { type: 'string', description: 'Markdown content to write to the page' },
      },
      required: ['page_id', 'markdown'],
    },
  },
  {
    name: 'notion_import_page_from_file',
    description: 'Write a local markdown file to a Notion page. DESTRUCTIVE: reads the file and replaces ALL existing page blocks with the parsed content. To add content without removing what is already there, use notion_append_to_page_from_file instead.',
    inputSchema: {
      type: 'object',
      properties: {
        page_id: { type: 'string', description: 'Notion page ID (32-char hex) or full Notion URL' },
        file_path: { type: 'string', description: 'Absolute path to a local .md file' },
      },
      required: ['page_id', 'file_path'],
    },
  },
  {
    name: 'notion_append_to_page',
    description: 'Append markdown content to the END of a Notion page, after the existing blocks. Non-destructive — existing content is left untouched. Supports headings, lists, to-do checkboxes, code blocks, tables, and inline formatting (bold, italic, strikethrough, code, links).',
    inputSchema: {
      type: 'object',
      properties: {
        page_id: { type: 'string', description: 'Notion page ID (32-char hex) or full Notion URL' },
        markdown: { type: 'string', description: 'Markdown content to append to the page' },
      },
      required: ['page_id', 'markdown'],
    },
  },
  {
    name: 'notion_append_to_page_from_file',
    description: 'Append a local markdown file to the END of a Notion page, after the existing blocks. Non-destructive — existing content is left untouched.',
    inputSchema: {
      type: 'object',
      properties: {
        page_id: { type: 'string', description: 'Notion page ID (32-char hex) or full Notion URL' },
        file_path: { type: 'string', description: 'Absolute path to a local .md file' },
      },
      required: ['page_id', 'file_path'],
    },
  },
  {
    name: 'notion_create_page',
    description: 'Create a new Notion page as a child of an existing page. Optionally populate it with markdown content. Returns the URL of the created page.',
    inputSchema: {
      type: 'object',
      properties: {
        parent_page_id: { type: 'string', description: 'Parent page ID (32-char hex) or full Notion URL' },
        title: { type: 'string', description: 'Title of the new page' },
        markdown: { type: 'string', description: 'Optional markdown content for the page body' },
        icon: { type: 'string', description: 'Optional page icon (emoji like "📄" or URL)' },
      },
      required: ['parent_page_id', 'title'],
    },
  },
  {
    name: 'notion_create_page_from_file',
    description: 'Create a new Notion page and populate it from a local markdown file. Returns the URL of the created page.',
    inputSchema: {
      type: 'object',
      properties: {
        parent_page_id: { type: 'string', description: 'Parent page ID (32-char hex) or full Notion URL' },
        title: { type: 'string', description: 'Title of the new page' },
        file_path: { type: 'string', description: 'Absolute path to a local .md file' },
        icon: { type: 'string', description: 'Optional page icon (emoji like "📄" or URL)' },
      },
      required: ['parent_page_id', 'title', 'file_path'],
    },
  },
  {
    name: 'notion_add_image',
    description: 'Add an image to the END of a Notion page. `image_path` is either an absolute path to a local image file (uploaded to Notion) or an http(s) URL (referenced as an external image). Non-destructive — appended after existing blocks.',
    inputSchema: {
      type: 'object',
      properties: {
        page_id: { type: 'string', description: 'Notion page ID (32-char hex) or full Notion URL' },
        image_path: { type: 'string', description: 'Absolute path to a local image file, or an http(s) image URL' },
        caption: { type: 'string', description: 'Optional caption (also used as markdown alt text on export)' },
      },
      required: ['page_id', 'image_path'],
    },
  },
  {
    name: 'notion_list_comments',
    description: 'List all open comment discussions on a page (and its child blocks). Returns discussion IDs, anchored text context, authors, timestamps, and comment bodies. Use this to read feedback/review threads on any page.',
    inputSchema: {
      type: 'object',
      properties: {
        page_id: { type: 'string', description: 'Notion page ID (32-char hex) or full Notion URL' },
        include_resolved: { type: 'boolean', description: 'Include resolved discussions (default: false)' },
      },
      required: ['page_id'],
    },
  },
  {
    name: 'notion_add_comment',
    description: 'Start a new comment discussion on a block. If `anchor_text` is provided, the comment is anchored inline to that exact substring of the block\'s text (the Notion UI highlights it yellow). Without `anchor_text`, the discussion attaches at the block level. Supports markdown **bold**, *italic*, `code`, and [links](url) in the comment body.',
    inputSchema: {
      type: 'object',
      properties: {
        block_id: { type: 'string', description: 'Notion block ID (32-char hex) — the block containing the text to comment on. A page ID also works (block-level only).' },
        text: { type: 'string', description: 'Comment body (supports markdown inline formatting)' },
        anchor_text: { type: 'string', description: 'Optional: substring of the block\'s text to anchor the comment to (inline comment). Must match exactly.' },
      },
      required: ['block_id', 'text'],
    },
  },
  {
    name: 'notion_reply_comment',
    description: 'Reply to an existing comment discussion thread. Use the discussion ID returned from notion_list_comments or notion_add_comment.',
    inputSchema: {
      type: 'object',
      properties: {
        discussion_id: { type: 'string', description: 'Discussion ID (32-char hex) from list_comments or add_comment' },
        text: { type: 'string', description: 'Reply body (supports markdown inline formatting)' },
      },
      required: ['discussion_id', 'text'],
    },
  },
  {
    name: 'notion_init',
    description: 'Set up Notion credentials by pasting a "Copy as cURL" of any notion.so/api/v3 request from your browser DevTools (Network tab → right-click a request → Copy as cURL). Extracts the token/user/workspace and saves them to ~/.notion-mcp/config.json. If you have multiple workspaces, it lists them — call again with space_id. Runs without existing credentials.',
    inputSchema: {
      type: 'object',
      properties: {
        curl: { type: 'string', description: 'The full "Copy as cURL" string from DevTools → Network → a /api/v3 request' },
        space_id: { type: 'string', description: 'Optional workspace id (when you have more than one)' },
      },
      required: ['curl'],
    },
  },
];

export async function handleMessage(msg: any): Promise<any> {
  const { method, id, params } = msg;

  if (method === 'initialize') {
    return {
      jsonrpc: '2.0',
      id,
      result: {
        protocolVersion: '2025-11-25',
        capabilities: { tools: {}, prompts: {}, resources: {} },
        serverInfo: {
          name: 'notion-mcp',
          version: pkg.version,
          title: 'Notion MCP Server',
          description: 'Search, export, and import Notion pages as markdown — no workspace admin or OAuth needed',
          websiteUrl: 'https://shck.dev/blog/notion-mcp',
        },
      },
    };
  }

  if (method === 'notifications/initialized') {
    return null;
  }

  if (method === 'tools/list') {
    return { jsonrpc: '2.0', id, result: { tools: TOOLS } };
  }

  if (method === 'tools/call') {
    const { name, arguments: args } = params;
    try {
      let text: string;
      // notion_init configures credentials, so it must run before getConfig().
      if (name === 'notion_init') {
        text = await notionInit(args.curl, args.space_id);
        return { jsonrpc: '2.0', id, result: { content: [{ type: 'text', text }] } };
      }
      const config = getConfig();
      switch (name) {
        case 'notion_search':
          text = await searchPages(config, args.query, args.limit ?? 10);
          break;
        case 'notion_export_page':
          text = await exportPageMarkdown(config, args.page_id, { imageDir: args.image_dir });
          break;
        case 'notion_import_page':
          text = await importMarkdownToPage(config, args.page_id, args.markdown);
          break;
        case 'notion_import_page_from_file':
          text = await importMarkdownFromFile(config, args.page_id, args.file_path);
          break;
        case 'notion_append_to_page':
          text = await appendMarkdownToPage(config, args.page_id, args.markdown);
          break;
        case 'notion_append_to_page_from_file':
          text = await appendMarkdownFromFile(config, args.page_id, args.file_path);
          break;
        case 'notion_create_page':
          text = await createPage(config, args.parent_page_id, args.title, args.markdown, args.icon);
          break;
        case 'notion_create_page_from_file':
          text = await createPageFromFile(config, args.parent_page_id, args.title, args.file_path, args.icon);
          break;
        case 'notion_add_image':
          text = await addImageToPage(config, args.page_id, args.image_path, args.caption);
          break;
        case 'notion_list_comments':
          text = await listComments(config, args.page_id, args.include_resolved ?? false);
          break;
        case 'notion_add_comment':
          text = await addComment(config, args.block_id, args.text, args.anchor_text);
          break;
        case 'notion_reply_comment':
          text = await replyComment(config, args.discussion_id, args.text);
          break;
        default:
          throw new Error(`Unknown tool: ${name}`);
      }
      return { jsonrpc: '2.0', id, result: { content: [{ type: 'text', text }] } };
    } catch (err: any) {
      return {
        jsonrpc: '2.0',
        id,
        result: { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true },
      };
    }
  }

  if (method === 'prompts/list') {
    return { jsonrpc: '2.0', id, result: { prompts: PROMPTS } };
  }

  if (method === 'prompts/get') {
    try {
      return { jsonrpc: '2.0', id, result: getPrompt(params.name, params.arguments ?? {}) };
    } catch (err: any) {
      return { jsonrpc: '2.0', id, error: { code: -32602, message: err.message } };
    }
  }

  if (method === 'resources/list') {
    return { jsonrpc: '2.0', id, result: { resources: RESOURCES } };
  }

  if (method === 'resources/read') {
    try {
      return { jsonrpc: '2.0', id, result: await readResource(params.uri, getConfig) };
    } catch (err: any) {
      return { jsonrpc: '2.0', id, error: { code: -32602, message: err.message } };
    }
  }

  return { jsonrpc: '2.0', id, error: { code: -32601, message: `Unknown method: ${method}` } };
}
