/**
 * Interactive setup: turn a browser "Copy as cURL" of any notion.so/api/v3 request into
 * stored credentials. parseCurl() is the shared core; resolveSpaces()/notionInit() (Task 5)
 * build on it for the tool + CLI front-ends.
 */

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
