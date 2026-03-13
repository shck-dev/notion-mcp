import type { NotionBlock } from '../types.js';

export function richText(text: string): any[][] {
  if (!text) return [];
  const result: any[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    // Bold
    const boldMatch = remaining.match(/^\*\*(.+?)\*\*/);
    if (boldMatch) {
      result.push([boldMatch[1], [['b']]]);
      remaining = remaining.slice(boldMatch[0].length);
      continue;
    }
    // Inline code
    const codeMatch = remaining.match(/^`(.+?)`/);
    if (codeMatch) {
      result.push([codeMatch[1], [['c']]]);
      remaining = remaining.slice(codeMatch[0].length);
      continue;
    }
    // Italic
    const italicMatch = remaining.match(/^\*(.+?)\*/);
    if (italicMatch) {
      result.push([italicMatch[1], [['i']]]);
      remaining = remaining.slice(italicMatch[0].length);
      continue;
    }
    // Link
    const linkMatch = remaining.match(/^\[(.+?)\]\((.+?)\)/);
    if (linkMatch) {
      result.push([linkMatch[1], [['a', linkMatch[2]]]]);
      remaining = remaining.slice(linkMatch[0].length);
      continue;
    }
    // Plain text — consume until next special char
    const plainMatch = remaining.match(/^[^*`\[]+/);
    if (plainMatch) {
      result.push([plainMatch[0]]);
      remaining = remaining.slice(plainMatch[0].length);
      continue;
    }
    // Single special char that didn't match a pattern
    result.push([remaining[0]]);
    remaining = remaining.slice(1);
  }

  return result;
}

export function markdownToNotionBlocks(markdown: string, parentId: string): NotionBlock[] {
  const lines = markdown.split('\n');
  const blocks: NotionBlock[] = [];
  let i = 0;
  let prevId: string | undefined;

  function addBlock(type: string, properties: Record<string, any>): string {
    const blockId = crypto.randomUUID();
    blocks.push({ id: blockId, type, properties, after: prevId });
    prevId = blockId;
    return blockId;
  }

  while (i < lines.length) {
    const line = lines[i];

    // Empty line
    if (line.trim() === '') {
      i++;
      continue;
    }

    // Headings
    const h1Match = line.match(/^# (.+)/);
    if (h1Match) {
      addBlock('header', { title: richText(h1Match[1]) });
      i++;
      continue;
    }
    const h2Match = line.match(/^## (.+)/);
    if (h2Match) {
      addBlock('sub_header', { title: richText(h2Match[1]) });
      i++;
      continue;
    }
    const h3Match = line.match(/^### (.+)/);
    if (h3Match) {
      addBlock('sub_sub_header', { title: richText(h3Match[1]) });
      i++;
      continue;
    }

    // Horizontal rule
    if (/^---+$/.test(line.trim())) {
      addBlock('divider', {});
      i++;
      continue;
    }

    // Blockquote
    if (line.startsWith('> ')) {
      const quoteLines: string[] = [];
      while (i < lines.length && lines[i].startsWith('> ')) {
        quoteLines.push(lines[i].slice(2));
        i++;
      }
      addBlock('quote', { title: richText(quoteLines.join('\n')) });
      continue;
    }

    // Code block
    if (line.startsWith('```')) {
      const lang = line.slice(3).trim();
      i++;
      const codeLines: string[] = [];
      while (i < lines.length && !lines[i].startsWith('```')) {
        codeLines.push(lines[i]);
        i++;
      }
      i++; // skip closing ```
      const props: Record<string, any> = { title: [[codeLines.join('\n')]] };
      if (lang) {
        props.language = [[lang]];
      }
      addBlock('code', props);
      continue;
    }

    // Table
    if (line.includes('|') && line.trim().startsWith('|')) {
      const tableLines: string[] = [];
      while (i < lines.length && lines[i].includes('|') && lines[i].trim().startsWith('|')) {
        tableLines.push(lines[i]);
        i++;
      }
      const rows = tableLines
        .filter((l) => !l.match(/^\|[\s-:|]+\|$/))
        .map((l) => l.split('|').slice(1, -1).map((cell) => cell.trim()));
      for (const row of rows) {
        addBlock('text', { title: richText(row.join(' | ')) });
      }
      continue;
    }

    // Bulleted list (indented and top-level)
    if (line.match(/^\s*[-*] /)) {
      addBlock('bulleted_list', { title: richText(line.replace(/^\s*[-*] /, '')) });
      i++;
      continue;
    }

    // Numbered list
    const numMatch = line.match(/^(\d+)\. (.+)/);
    if (numMatch) {
      addBlock('numbered_list', { title: richText(numMatch[2]) });
      i++;
      continue;
    }

    // Regular text paragraph
    addBlock('text', { title: richText(line) });
    i++;
  }

  return blocks;
}
