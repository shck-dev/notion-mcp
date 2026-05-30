/**
 * Persistent credential store at ~/.notion-mcp/config.json (file mode 0600).
 * Written by the `init` flows; read by loadConfig() as a fallback when env vars are absent.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { NotionConfig } from './types.js';

export function configDir(): string {
  // NOTION_MCP_CONFIG_DIR overrides the default — handy for tests, multi-account setups,
  // or a non-standard HOME. Read fresh from process.env on every call.
  return process.env.NOTION_MCP_CONFIG_DIR ?? path.join(os.homedir(), '.notion-mcp');
}

export function configPath(): string {
  return path.join(configDir(), 'config.json');
}

export function readConfigFile(): Partial<NotionConfig> | null {
  try {
    const j = JSON.parse(fs.readFileSync(configPath(), 'utf-8'));
    const out: Partial<NotionConfig> = {};
    if (j.token) out.token = j.token;
    if (j.userId) out.userId = j.userId;
    if (j.spaceId) out.spaceId = j.spaceId;
    return out;
  } catch {
    return null;
  }
}

export function writeConfigFile(cfg: NotionConfig): void {
  fs.mkdirSync(configDir(), { recursive: true, mode: 0o700 });
  fs.writeFileSync(configPath(), JSON.stringify(cfg, null, 2) + '\n', { mode: 0o600 });
}
