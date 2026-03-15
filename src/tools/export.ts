import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import type { NotionConfig } from '../types.js';
import { notionPost, parsePageId } from '../notion-client.js';

export async function exportPageMarkdown(config: NotionConfig, pageId: string): Promise<string> {
  const id = parsePageId(pageId);

  // Enqueue export task
  const taskRes = await notionPost(config, 'enqueueTask', {
    task: {
      eventName: 'exportBlock',
      request: {
        block: { id },
        recursive: false,
        exportOptions: { exportType: 'markdown', timeZone: 'UTC', locale: 'en' },
      },
    },
  });

  const taskId = taskRes.taskId;
  if (!taskId) throw new Error('No taskId returned from enqueueTask');

  // Poll for completion
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    const status = await notionPost(config, 'getTasks', { taskIds: [taskId] });
    const task = status.results?.[0];

    if (task?.state === 'success' && task?.status?.exportURL) {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'notion-export-'));
      try {
        // Download the zip
        const zipRes = await fetch(task.status.exportURL, {
          headers: {
            cookie: `token_v2=${config.token}; notion_user_id=${config.userId}`,
          },
        });
        if (!zipRes.ok) throw new Error(`Download failed: ${zipRes.status}`);

        const zipBuffer = Buffer.from(await zipRes.arrayBuffer());
        const zipPath = path.join(tmpDir, 'export.zip');
        fs.writeFileSync(zipPath, zipBuffer);

        // Extract with unzip
        const { execSync } = await import('child_process');
        try {
          execSync(`unzip -o "${zipPath}" -d "${tmpDir}"`, { stdio: 'pipe' });
        } catch (e: any) {
          throw new Error(`unzip failed: ${e.stderr?.toString().slice(0, 200)}`);
        }

        // Find the .md file
        function findMd(dir: string): string | null {
          for (const entry of fs.readdirSync(dir)) {
            const full = path.join(dir, entry);
            if (fs.statSync(full).isDirectory()) {
              const found = findMd(full);
              if (found) return found;
            } else if (entry.endsWith('.md')) {
              return full;
            }
          }
          return null;
        }

        const mdFile = findMd(tmpDir);
        if (!mdFile) throw new Error('No .md file found in export');
        return fs.readFileSync(mdFile, 'utf-8');
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    }

    if (task?.state === 'failure') throw new Error(`Export failed: ${JSON.stringify(task)}`);
  }

  throw new Error('Export timed out after 30s');
}
