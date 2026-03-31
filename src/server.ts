#!/usr/bin/env bun
/**
 * MCP server for Notion using internal API (cookie auth).
 * Tools: search, export page as markdown, import markdown to page.
 */
import { loadConfig } from './notion-client.js';
import { startStdioTransport } from './transport.js';
import { searchPages } from './tools/search.js';
import { exportPageMarkdown } from './tools/export.js';
import { importMarkdownToPage, importMarkdownFromFile } from './tools/import.js';
import { createPage, createPageFromFile } from './tools/create-page.js';

const config = loadConfig();

const TOOLS = [
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
    description: 'Export a Notion page as clean markdown. Converts headings, lists, code blocks, tables, bold/italic, links, and nested content into standard markdown format.',
    inputSchema: {
      type: 'object',
      properties: {
        page_id: { type: 'string', description: 'Notion page ID (32-char hex) or full Notion URL' },
      },
      required: ['page_id'],
    },
  },
  {
    name: 'notion_import_page',
    description: 'Write markdown content to a Notion page. Replaces all existing blocks with new content parsed from the provided markdown string. Supports headings, lists, code blocks, tables, and inline formatting.',
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
    description: 'Write a local markdown file to a Notion page. Reads the file and replaces all existing page blocks with the parsed content. Useful for syncing documentation from your local filesystem to Notion.',
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
];

async function handleMessage(msg: any): Promise<any> {
  const { method, id, params } = msg;

  if (method === 'initialize') {
    return {
      jsonrpc: '2.0',
      id,
      result: {
        protocolVersion: '2025-11-25',
        capabilities: { tools: {} },
        serverInfo: {
          name: 'notion-mcp',
          version: '0.1.8',
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
      switch (name) {
        case 'notion_search':
          text = await searchPages(config, args.query, args.limit ?? 10);
          break;
        case 'notion_export_page':
          text = await exportPageMarkdown(config, args.page_id);
          break;
        case 'notion_import_page':
          text = await importMarkdownToPage(config, args.page_id, args.markdown);
          break;
        case 'notion_import_page_from_file':
          text = await importMarkdownFromFile(config, args.page_id, args.file_path);
          break;
        case 'notion_create_page':
          text = await createPage(config, args.parent_page_id, args.title, args.markdown, args.icon);
          break;
        case 'notion_create_page_from_file':
          text = await createPageFromFile(config, args.parent_page_id, args.title, args.file_path, args.icon);
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

  return { jsonrpc: '2.0', id, error: { code: -32601, message: `Unknown method: ${method}` } };
}

startStdioTransport(handleMessage);
