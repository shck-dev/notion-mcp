import type { BlockMap, RichTextSegment } from '../types.js';

export function richTextToMarkdown(segments: RichTextSegment[] | undefined): string {
  if (!segments || segments.length === 0) return '';

  return segments
    .map((seg) => {
      const text = seg[0];
      const decorations = seg[1] as Array<[string, string?]> | undefined;
      if (!decorations || decorations.length === 0) return text;

      let result = text;
      const hasB = decorations.some((d) => d[0] === 'b');
      const hasI = decorations.some((d) => d[0] === 'i');
      const hasC = decorations.some((d) => d[0] === 'c');
      const link = decorations.find((d) => d[0] === 'a');

      if (link) return `[${text}](${link[1]})`;
      if (hasC) return `\`${text}\``;
      if (hasB && hasI) return `***${text}***`;
      if (hasB) return `**${text}**`;
      if (hasI) return `*${text}*`;

      return result;
    })
    .join('');
}

export function blocksToMarkdown(blockMap: BlockMap, rootId: string): string {
  const lines: string[] = [];

  function renderBlock(blockId: string, depth: number, numberedCounter: { n: number }): void {
    const entry = blockMap[blockId];
    if (!entry) return;
    const block = entry.value;
    const title = richTextToMarkdown(block.properties?.title as RichTextSegment[] | undefined);
    const indent = '  '.repeat(depth);

    switch (block.type) {
      case 'text':
        lines.push(`${indent}${title}`);
        lines.push('');
        break;

      case 'header':
        lines.push(`# ${title}`);
        lines.push('');
        break;

      case 'sub_header':
        lines.push(`## ${title}`);
        lines.push('');
        break;

      case 'sub_sub_header':
        lines.push(`### ${title}`);
        lines.push('');
        break;

      case 'bulleted_list':
        lines.push(`${indent}- ${title}`);
        break;

      case 'numbered_list':
        lines.push(`${indent}${numberedCounter.n}. ${title}`);
        numberedCounter.n++;
        break;

      case 'code': {
        const lang = block.properties?.language?.[0]?.[0] ?? '';
        lines.push(`\`\`\`${lang}`);
        lines.push(title);
        lines.push('```');
        lines.push('');
        break;
      }

      case 'divider':
        lines.push('---');
        lines.push('');
        break;

      case 'quote':
        lines.push(`> ${title}`);
        lines.push('');
        break;

      case 'to_do': {
        const checked = block.properties?.checked?.[0]?.[0] === 'Yes';
        lines.push(`- [${checked ? 'x' : ' '}] ${title}`);
        break;
      }

      case 'image': {
        const src = block.properties?.source?.[0]?.[0] ?? '';
        lines.push(`![](${src})`);
        lines.push('');
        break;
      }

      case 'callout': {
        const icon = block.format?.page_icon ?? '';
        lines.push(`> ${icon ? icon + ' ' : ''}${title}`);
        lines.push('');
        break;
      }

      case 'toggle':
        lines.push(`${title}`);
        lines.push('');
        break;

      case 'table': {
        renderTable(block, depth);
        return; // table handles its own children
      }

      case 'page':
        // Skip page block itself, render children below
        break;

      default:
        // Graceful degradation: render as plain text
        if (title) {
          lines.push(`${indent}${title}`);
          lines.push('');
        }
        break;
    }

    // Render children
    if (block.content && block.type !== 'table') {
      const childNumbered = { n: 1 };
      for (const childId of block.content) {
        const childEntry = blockMap[childId];
        const childType = childEntry?.value?.type;

        // Reset numbered counter when we switch away from numbered_list
        if (childType !== 'numbered_list') {
          childNumbered.n = 1;
        }

        const childDepth = block.type === 'page' ? depth : depth + 1;
        renderBlock(childId, childDepth, childNumbered);
      }
    }
  }

  function renderTable(tableBlock: typeof blockMap[string]['value'], _depth: number): void {
    const colOrder = tableBlock.format?.table_block_column_order;
    const rowIds = tableBlock.content;
    if (!colOrder || !rowIds) return;

    const rows: string[][] = [];
    for (const rowId of rowIds) {
      const rowEntry = blockMap[rowId];
      if (!rowEntry) continue;
      const rowBlock = rowEntry.value;
      const cells = colOrder.map((colId) => {
        const cellSegments = rowBlock.properties?.[colId] as RichTextSegment[] | undefined;
        return richTextToMarkdown(cellSegments);
      });
      rows.push(cells);
    }

    if (rows.length === 0) return;

    // First row is header
    lines.push('| ' + rows[0].join(' | ') + ' |');
    lines.push('| ' + rows[0].map(() => '---').join(' | ') + ' |');
    for (let i = 1; i < rows.length; i++) {
      lines.push('| ' + rows[i].join(' | ') + ' |');
    }
    lines.push('');
  }

  const rootNumbered = { n: 1 };
  renderBlock(rootId, 0, rootNumbered);

  // Clean up: remove trailing empty lines, collapse multiple blank lines
  return lines
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    + '\n';
}
