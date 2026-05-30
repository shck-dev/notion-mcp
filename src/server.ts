#!/usr/bin/env node
/**
 * Notion MCP server — stdio entry point.
 *
 * Protocol handling lives in mcp-handler.ts (kept separate so it can be unit-tested
 * without starting the transport). This file only wires the handler to stdio.
 */
import { handleMessage } from './mcp-handler.js';
import { startStdioTransport } from './transport.js';
import { runInit } from './cli-init.js';

// `notion-mcp init` runs the interactive setup wizard instead of the stdio server.
if (process.argv[2] === 'init') {
  await runInit();
  process.exit(0);
}

startStdioTransport(handleMessage);
