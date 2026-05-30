/** `notion-mcp init` — interactive setup wizard. Reads a pasted cURL from stdin. */
import { notionInit } from './tools/init.js';
import { SETUP_GUIDE } from './guide.js';

function readStdin(): Promise<string> {
  return new Promise((resolve) => {
    let data = '';
    process.stdin.setEncoding('utf-8');
    process.stdin.on('data', (c) => (data += c));
    process.stdin.on('end', () => resolve(data));
    process.stdin.resume();
  });
}

export async function runInit(): Promise<void> {
  // Guide + prompts go to stderr so stdout carries only the result.
  process.stderr.write(SETUP_GUIDE + '\n\nPaste the cURL, then press Ctrl-D:\n\n');
  const curl = (await readStdin()).trim();
  if (!curl) {
    process.stderr.write('No input received.\n');
    process.exit(1);
  }
  try {
    const result = await notionInit(curl);
    process.stdout.write('\n' + result + '\n');
  } catch (err: any) {
    process.stderr.write(`\n✗ ${err.message}\n`);
    process.exit(1);
  }
}
