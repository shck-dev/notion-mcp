import type { NotionConfig, BlockMap, NotionRawBlock } from './types.js';
import { readConfigFile } from './config-store.js';

const BASE = 'https://www.notion.so/api/v3';
const DEBUG = process.env.NOTION_DEBUG === '1' || process.env.NOTION_DEBUG === 'true';

const AUTH_HELP =
  'Notion authentication failed — your token_v2 session cookie is expired or invalid. ' +
  'Refresh it: open notion.so → DevTools (F12) → Application → Cookies → copy the token_v2 ' +
  'value into NOTION_TOKEN. (Notion rotates these session cookies periodically.)';

export function loadConfig(): NotionConfig {
  const file = readConfigFile() ?? {};
  const token = process.env.NOTION_TOKEN ?? file.token;
  const userId = process.env.NOTION_USER_ID ?? file.userId;
  const spaceId = process.env.NOTION_SPACE_ID ?? file.spaceId;

  const missing: string[] = [];
  if (!token) missing.push('NOTION_TOKEN');
  if (!userId) missing.push('NOTION_USER_ID');
  if (!spaceId) missing.push('NOTION_SPACE_ID');

  if (missing.length > 0) {
    throw new Error(
      `Missing Notion credentials: ${missing.join(', ')}.\n\n` +
      'Easiest fix — run the interactive setup:\n' +
      '  npx @shck-dev/notion-mcp init\n' +
      '(paste a "Copy as cURL" from your browser DevTools; it extracts everything)\n\n' +
      'Or set the env vars manually, or create ~/.notion-mcp/config.json. See the README.'
    );
  }

  return { token: token!, userId: userId!, spaceId: spaceId! };
}

// Thrown for non-2xx HTTP responses so callers can branch on the status code
// (e.g. fall back / give actionable guidance when a route is removed → 404).
export class NotionHttpError extends Error {
  constructor(message: string, public readonly status: number, public readonly endpoint: string) {
    super(message);
    this.name = 'NotionHttpError';
  }
}

export async function notionPost(config: NotionConfig, endpoint: string, body: unknown): Promise<any> {
  if (DEBUG) {
    process.stderr.write(`[notion-mcp] POST ${endpoint} ${JSON.stringify(body).slice(0, 500)}\n`);
  }
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'x-notion-active-user-header': config.userId,
    cookie: `token_v2=${config.token}; notion_user_id=${config.userId}`,
  };
  // The space-routed write endpoint (saveTransactionsFanout) expects this header;
  // it's harmless on reads. Omit it when spaceId is unknown (e.g. during init,
  // where loadUserContent runs before a workspace is chosen) to avoid a blank header.
  if (config.spaceId) headers['x-notion-space-id'] = config.spaceId;

  const res = await fetch(`${BASE}/${endpoint}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (DEBUG) {
    process.stderr.write(`[notion-mcp] ${endpoint} ${res.status} ${text.slice(0, 500)}\n`);
  }
  if (!res.ok) {
    if (res.status === 401) {
      throw new NotionHttpError(`${AUTH_HELP} (raw: ${res.status} ${text.slice(0, 200)})`, 401, endpoint);
    }
    throw new NotionHttpError(`Notion ${endpoint} ${res.status}: ${text.slice(0, 300)}`, res.status, endpoint);
  }
  let json: any;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`Notion ${endpoint} returned non-JSON: ${text.slice(0, 300)}`);
  }
  // Notion sometimes returns 200 with an error envelope
  if (json && json.name === 'UnauthorizedError') {
    throw new Error(`${AUTH_HELP} (raw: ${JSON.stringify(json).slice(0, 200)})`);
  }
  if (json && (json.errorId || json.name === 'ObjectNotFoundError')) {
    throw new Error(`Notion ${endpoint} error: ${JSON.stringify(json).slice(0, 300)}`);
  }
  return json;
}

// A write operation in the simple legacy shape every op-builder in this repo emits.
export interface TransactionOp {
  id: string;
  table: string;
  path: (string | number)[];
  command: string;
  args: unknown;
}

// Notion removed the legacy `submitTransaction` route (it now 404s server-side).
// The web client writes through `saveTransactionsFanout`, which expects each op to
// carry a `pointer { table, id, spaceId }` instead of a top-level id/table. We do
// that translation here, in one place, so a future endpoint/shape change is a
// single edit and every op-builder can keep producing the simpler legacy shape.
const TRANSACTION_ENDPOINT = 'saveTransactionsFanout';

export async function saveTransactions(config: NotionConfig, ops: TransactionOp[]): Promise<any> {
  const operations = ops.map(({ id, table, path, command, args }) => ({
    pointer: { table, id, spaceId: config.spaceId },
    path,
    command,
    args,
  }));
  const body = {
    requestId: crypto.randomUUID(),
    transactions: [
      { id: crypto.randomUUID(), spaceId: config.spaceId, debug: { userAction: 'notion-mcp' }, operations },
    ],
  };
  try {
    return await notionPost(config, TRANSACTION_ENDPOINT, body);
  } catch (err) {
    if (err instanceof NotionHttpError && err.status === 404) {
      throw new Error(
        `Notion rejected the write — the transaction endpoint "${TRANSACTION_ENDPOINT}" returned 404. ` +
        'Notion may have changed its internal write API again; the server needs updating. ' +
        `(raw: ${err.message})`,
      );
    }
    throw err;
  }
}

export function parsePageId(input: string): string {
  const match = input.match(/([a-f0-9]{32})/);
  if (match) {
    const raw = match[1];
    return `${raw.slice(0, 8)}-${raw.slice(8, 12)}-${raw.slice(12, 16)}-${raw.slice(16, 20)}-${raw.slice(20)}`;
  }
  if (/^[a-f0-9-]{36}$/.test(input)) return input;
  throw new Error(`Invalid page ID: ${input}`);
}

// Notion's recordMap entries are either { value: {...block...} } (legacy)
// or { spaceId, value: { value: {...block...}, role } } (current). Unwrap both.
export function unwrapRecord<T = any>(entry: any): T | undefined {
  if (!entry) return undefined;
  const inner = entry.value;
  if (!inner || typeof inner !== 'object') return undefined;
  if (inner.value && typeof inner.value === 'object' && 'id' in inner.value) {
    return inner.value as T;
  }
  if ('id' in inner) return inner as T;
  return undefined;
}

// Normalize a raw recordMap.block map to the legacy BlockMap shape
// that markdown/from-notion.ts expects: { [id]: { value: NotionRawBlock } }.
export function normalizeBlockMap(raw: Record<string, any> | undefined): BlockMap {
  const out: BlockMap = {};
  if (!raw) return out;
  for (const [id, entry] of Object.entries(raw)) {
    const value = unwrapRecord<NotionRawBlock>(entry);
    if (value) out[id] = { value };
  }
  return out;
}
