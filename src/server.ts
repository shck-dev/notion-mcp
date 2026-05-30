#!/usr/bin/env node
/**
 * Notion MCP server — stdio entry point.
 *
 * Protocol handling lives in mcp-handler.ts (kept separate so it can be unit-tested
 * without starting the transport). This file only wires the handler to stdio.
 */
import { handleMessage } from './mcp-handler.js';
import { startStdioTransport } from './transport.js';

startStdioTransport(handleMessage);
