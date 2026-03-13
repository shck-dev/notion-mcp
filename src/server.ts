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

const config = loadConfig();

const TOOLS = [
  {
    name: 'notion_search',
    description: 'Search for pages in the Notion workspace',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query' },
        limit: { type: 'number', description: 'Max results (default 10)' },
      },
      required: ['query'],
    },
  },
  {
    name: 'notion_export_page',
    description: 'Export a Notion page as markdown. Returns the markdown content.',
    inputSchema: {
      type: 'object',
      properties: {
        page_id: { type: 'string', description: 'Page ID or URL (e.g. 30fbd879c5f080f8a88ac150e349d076)' },
      },
      required: ['page_id'],
    },
  },
  {
    name: 'notion_import_page',
    description: 'Replace a Notion page content with markdown. Deletes existing blocks and creates new ones.',
    inputSchema: {
      type: 'object',
      properties: {
        page_id: { type: 'string', description: 'Page ID or URL to update' },
        markdown: { type: 'string', description: 'Markdown content to import' },
      },
      required: ['page_id', 'markdown'],
    },
  },
  {
    name: 'notion_import_page_from_file',
    description: 'Replace a Notion page content with markdown read from a local file.',
    inputSchema: {
      type: 'object',
      properties: {
        page_id: { type: 'string', description: 'Page ID or URL to update' },
        file_path: { type: 'string', description: 'Absolute path to a markdown file' },
      },
      required: ['page_id', 'file_path'],
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
        protocolVersion: '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: 'notion-mcp', version: '0.1.0' },
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
