/**
 * Interactive setup: turn a browser "Copy as cURL" of any notion.so/api/v3 request into
 * stored credentials. parseCurl() is the shared core; resolveSpaces()/notionInit() (Task 5)
 * build on it for the tool + CLI front-ends.
 */
import type { NotionConfig } from '../types.js';
import { notionPost } from '../notion-client.js';
import { writeConfigFile, configPath } from '../config-store.js';

export interface ParsedCurl {
  token: string;
  userId?: string;
  spaceId?: string;
}

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';

/** Collect `-H 'name: value'` / `--header "name: value"` pairs into a lowercased map. */
function collectHeaders(curl: string): Record<string, string> {
  const out: Record<string, string> = {};
  const re = /(?:-H|--header)\s+(['"])((?:\\.|(?!\1).)*)\1/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(curl))) {
    const raw = m[2];
    const i = raw.indexOf(':');
    if (i > 0) out[raw.slice(0, i).trim().toLowerCase()] = raw.slice(i + 1).trim();
  }
  return out;
}

/** Pull the quoted value following one of `flags` (handles `$'...'`, single, and double quotes). */
function extractFlagValue(curl: string, flags: string[]): string | undefined {
  for (const f of flags) {
    const esc = f.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
    const m = curl.match(new RegExp(`${esc}\\s+\\$?(['"])((?:\\\\.|(?!\\1).)*)\\1`));
    if (m) return m[2];
  }
  return undefined;
}

export function parseCurl(curl: string): ParsedCurl {
  const headers = collectHeaders(curl);
  const cookie = headers['cookie'] ?? extractFlagValue(curl, ['-b', '--cookie']) ?? '';

  const tokenRaw = /token_v2=([^;\s'"]+)/.exec(cookie)?.[1] ?? /token_v2=([^;\s'"]+)/.exec(curl)?.[1];
  if (!tokenRaw) {
    throw new Error(
      'No token_v2 found in the cURL. Copy a request to notion.so/api/v3 via DevTools → Network → right-click → Copy as cURL.'
    );
  }
  const token = decodeURIComponent(tokenRaw);

  const userId =
    headers['x-notion-active-user-header'] ??
    new RegExp(`notion_user_id=(${UUID})`, 'i').exec(cookie)?.[1];

  const body = extractFlagValue(curl, ['--data-raw', '--data-binary', '--data', '-d']);
  const spaceId = body
    ? new RegExp(`"space_?id"\\s*:\\s*"(${UUID})"`, 'i').exec(body)?.[1]
    : undefined;

  return { token, userId, spaceId };
}

/**
 * Use the token alone to discover the user id and the list of workspaces
 * (loadUserContent returns both). `post` is injectable for tests.
 */
export async function resolveSpaces(
  token: string,
  post: typeof notionPost = notionPost
): Promise<{ userId: string; spaces: { id: string; name: string }[] }> {
  const cfg = { token, userId: '', spaceId: '' } as NotionConfig;
  const data = await post(cfg, 'loadUserContent', {});
  const rm = data?.recordMap ?? {};
  const userId = Object.keys(rm.notion_user ?? {})[0] ?? '';
  const spaces = Object.entries<any>(rm.space ?? {}).map(([id, e]) => ({
    id,
    name: e?.value?.value?.name ?? e?.value?.name ?? '(unnamed)',
  }));
  return { userId, spaces };
}

function redact(token: string): string {
  return `${token.slice(0, 6)}…(${token.length} chars, hidden)`;
}

/**
 * Parse a cURL, fill in any missing user/workspace id via the API, and persist the
 * credentials. Returns a human-readable result (token redacted). Credential-free.
 */
export async function notionInit(
  curl: string,
  spaceIdArg?: string,
  post: typeof notionPost = notionPost
): Promise<string> {
  const parsed = parseCurl(curl);
  const token = parsed.token;
  let userId = parsed.userId;
  let spaceId = spaceIdArg ?? parsed.spaceId;

  if (!userId || !spaceId) {
    const resolved = await resolveSpaces(token, post);
    userId = userId || resolved.userId;
    if (!spaceId) {
      if (resolved.spaces.length === 1) {
        spaceId = resolved.spaces[0].id;
      } else if (resolved.spaces.length > 1) {
        const list = resolved.spaces.map((s) => `  • ${s.name} — space_id: ${s.id}`).join('\n');
        return `Found ${resolved.spaces.length} workspaces. Re-run notion_init with space_id set to one of:\n${list}`;
      }
    }
  }

  if (!userId || !spaceId) {
    throw new Error('Could not resolve your user/workspace id — the token may be expired, or pass space_id explicitly.');
  }

  writeConfigFile({ token, userId, spaceId });
  return (
    `✅ Saved Notion credentials to ${configPath()}\n` +
    `  user:  ${userId}\n` +
    `  space: ${spaceId}\n` +
    `  token: ${redact(token)}\n` +
    `Restart the MCP server (or your MCP client) to pick them up.`
  );
}
