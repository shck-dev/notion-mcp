type MessageHandler = (msg: any) => Promise<any>;

export function startStdioTransport(handler: MessageHandler): void {
  let buffer = '';

  process.stdin.setEncoding('utf-8');
  process.stdin.resume();
  process.stdin.on('data', async (chunk: string) => {
    buffer += chunk;

    // Split on newlines — each line is a complete JSON-RPC message
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? ''; // last element is incomplete (or empty)

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      // Skip Content-Length headers (for backward compat)
      if (trimmed.startsWith('Content-Length:')) continue;

      try {
        const msg = JSON.parse(trimmed);
        const response = await handler(msg);
        if (response) {
          const responseStr = JSON.stringify(response);
          process.stdout.write(responseStr + '\n');
        }
      } catch (err: any) {
        process.stderr.write(`Parse error: ${err.message}\n`);
      }
    }
  });
}
