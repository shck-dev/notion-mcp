type MessageHandler = (msg: any) => Promise<any>;

export function startStdioTransport(handler: MessageHandler): void {
  let buffer = '';

  process.stdin.setEncoding('utf-8');
  process.stdin.on('data', async (chunk: string) => {
    buffer += chunk;
    while (true) {
      const headerEnd = buffer.indexOf('\r\n\r\n');
      if (headerEnd === -1) break;

      const header = buffer.slice(0, headerEnd);
      const lengthMatch = header.match(/Content-Length:\s*(\d+)/i);
      if (!lengthMatch) {
        buffer = buffer.slice(headerEnd + 4);
        continue;
      }

      const contentLength = Number(lengthMatch[1]);
      const bodyStart = headerEnd + 4;
      if (buffer.length < bodyStart + contentLength) break;

      const body = buffer.slice(bodyStart, bodyStart + contentLength);
      buffer = buffer.slice(bodyStart + contentLength);

      try {
        const msg = JSON.parse(body);
        const response = await handler(msg);
        if (response) {
          const responseStr = JSON.stringify(response);
          process.stdout.write(`Content-Length: ${Buffer.byteLength(responseStr)}\r\n\r\n${responseStr}`);
        }
      } catch (err: any) {
        process.stderr.write(`Parse error: ${err.message}\n`);
      }
    }
  });
}
