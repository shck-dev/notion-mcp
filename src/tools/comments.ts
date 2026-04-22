import type { NotionConfig, NotionRawBlock, RichTextSegment } from '../types.js';
import { notionPost, parsePageId, unwrapRecord } from '../notion-client.js';
import { richText } from '../markdown/to-notion.js';
import { richTextToMarkdown } from '../markdown/from-notion.js';

type Decoration = [string, string?] | [string, string];

/**
 * Splice a Notion rich-text array so that the span matching `anchor` gets an
 * extra ['m', discussionId] decoration. Returns the new segments plus the
 * marked portion (used as the discussion's `context`).
 *
 * Supports the common case: `anchor` matches a contiguous substring of the
 * concatenated plaintext. Segments that intersect the anchor are split so the
 * marker only decorates the matched region. Existing decorations on those
 * segments are preserved.
 */
export function injectMarker(
  segments: RichTextSegment[],
  anchor: string,
  discussionId: string,
): { segments: RichTextSegment[]; context: RichTextSegment[] } {
  if (!anchor) throw new Error('anchor_text must not be empty');

  const plain = segments.map((s) => s[0] ?? '').join('');
  const start = plain.indexOf(anchor);
  if (start < 0) {
    throw new Error(`anchor_text not found in block title: ${JSON.stringify(anchor)}`);
  }
  const end = start + anchor.length;

  const out: RichTextSegment[] = [];
  const context: RichTextSegment[] = [];
  let offset = 0;

  for (const seg of segments) {
    const segText = seg[0] ?? '';
    const segDecos = (seg[1] as Decoration[] | undefined) ?? [];
    const segStart = offset;
    const segEnd = offset + segText.length;
    offset = segEnd;

    if (segEnd <= start || segStart >= end || segText.length === 0) {
      // Entirely outside the anchor region (or empty) — keep as-is.
      out.push(seg);
      continue;
    }

    const localStart = Math.max(0, start - segStart);
    const localEnd = Math.min(segText.length, end - segStart);

    const before = segText.slice(0, localStart);
    const middle = segText.slice(localStart, localEnd);
    const after = segText.slice(localEnd);

    if (before) out.push(segDecos.length ? [before, segDecos] : [before]);

    const markedDecos: Decoration[] = [...segDecos, ['m', discussionId]];
    const markedSeg: RichTextSegment = [middle, markedDecos];
    out.push(markedSeg);
    context.push(markedSeg);

    if (after) out.push(segDecos.length ? [after, segDecos] : [after]);
  }

  return { segments: out, context };
}

interface DiscussionRecord {
  id: string;
  parent_id: string;
  parent_table: string;
  comments: string[];
  resolved?: boolean;
  context?: RichTextSegment[];
  space_id: string;
  type?: string;
}

interface CommentRecord {
  id: string;
  parent_id: string;
  text?: RichTextSegment[];
  created_time?: number;
  last_edited_time?: number;
  created_by_id?: string;
  alive?: boolean;
  space_id: string;
}

interface NotionUserRecord {
  id: string;
  name?: string;
  given_name?: string;
  family_name?: string;
  email?: string;
}

/**
 * List all comment discussions on a page (and its child blocks).
 * Uses loadPageChunk which returns discussions + comments in the same response.
 */
export async function listComments(
  config: NotionConfig,
  pageId: string,
  includeResolved = false,
): Promise<string> {
  const id = parsePageId(pageId);

  const data = await notionPost(config, 'loadPageChunk', {
    page: { id },
    limit: 100,
    cursor: { stack: [] },
    chunkNumber: 0,
    verticalColumns: false,
  });

  const discussionsRaw = data.recordMap?.discussion ?? {};
  const commentsRaw = data.recordMap?.comment ?? {};
  const usersRaw = data.recordMap?.notion_user ?? {};

  const discussions: DiscussionRecord[] = Object.values(discussionsRaw)
    .map((e) => unwrapRecord<DiscussionRecord>(e))
    .filter((d): d is DiscussionRecord => !!d);

  if (discussions.length === 0) return 'No comments on this page.';

  const out: string[] = [];
  for (const disc of discussions) {
    if (!includeResolved && disc.resolved) continue;

    const contextText = richTextToMarkdown(disc.context).trim();
    const anchor = contextText ? ` — on "${contextText}"` : '';
    const status = disc.resolved ? ' [resolved]' : '';
    out.push(`## Discussion ${disc.id.replace(/-/g, '')}${anchor}${status}`);
    out.push(`Block: ${disc.parent_id.replace(/-/g, '')}`);

    for (const commentId of disc.comments ?? []) {
      const comment = unwrapRecord<CommentRecord>(commentsRaw[commentId]);
      if (!comment || comment.alive === false) continue;

      const user = comment.created_by_id ? unwrapRecord<NotionUserRecord>(usersRaw[comment.created_by_id]) : undefined;
      const author = user ? (user.name || [user.given_name, user.family_name].filter(Boolean).join(' ') || user.email || comment.created_by_id) : comment.created_by_id ?? 'unknown';
      const when = comment.created_time ? new Date(comment.created_time).toISOString() : '';
      const body = richTextToMarkdown(comment.text);
      out.push('');
      out.push(`**${author}**${when ? ` (${when})` : ''} [${commentId.replace(/-/g, '')}]`);
      out.push(body || '(empty)');
    }
    out.push('');
  }

  if (out.length === 0) return 'No open comments on this page.';
  return out.join('\n');
}

/**
 * Start a new discussion on a block. When `anchorText` is provided, the
 * comment is anchored inline — a marker decoration is added to the matching
 * span in the block's title and the discussion's `context` is set to that
 * span (this is how Notion renders the yellow-highlighted commented text).
 * Without `anchorText`, the discussion attaches at the block level.
 */
export async function addComment(
  config: NotionConfig,
  blockId: string,
  text: string,
  anchorText?: string,
): Promise<string> {
  const targetId = parsePageId(blockId);
  const discussionId = crypto.randomUUID();
  const commentId = crypto.randomUUID();
  const now = Date.now();

  const rt = richText(text);

  const discussionArgs: Record<string, any> = {
    id: discussionId,
    version: 1,
    parent_id: targetId,
    parent_table: 'block',
    comments: [commentId],
    resolved: false,
    space_id: config.spaceId,
    type: 'default',
  };

  const ops: any[] = [
    {
      id: commentId,
      table: 'comment',
      path: [],
      command: 'set',
      args: {
        id: commentId,
        version: 1,
        parent_id: discussionId,
        parent_table: 'discussion',
        text: rt,
        created_time: now,
        last_edited_time: now,
        alive: true,
        created_by_table: 'notion_user',
        created_by_id: config.userId,
        last_edited_by_table: 'notion_user',
        last_edited_by_id: config.userId,
        space_id: config.spaceId,
      },
    },
  ];

  if (anchorText) {
    // Pull the block's current title, splice in the marker decoration.
    const sync = await notionPost(config, 'syncRecordValues', {
      requests: [{ pointer: { table: 'block', id: targetId }, version: -1 }],
    });
    const block = unwrapRecord<NotionRawBlock>(sync.recordMap?.block?.[targetId]);
    if (!block) throw new Error(`Block ${targetId} not found`);

    const title = (block.properties?.title as RichTextSegment[] | undefined) ?? [];
    const { segments: newTitle, context } = injectMarker(title, anchorText, discussionId);

    discussionArgs.context = context;

    ops.push({
      id: targetId,
      table: 'block',
      path: ['properties', 'title'],
      command: 'set',
      args: newTitle,
    });
  }

  ops.push(
    {
      id: discussionId,
      table: 'discussion',
      path: [],
      command: 'set',
      args: discussionArgs,
    },
    {
      id: targetId,
      table: 'block',
      path: ['discussions'],
      command: 'listAfter',
      args: { id: discussionId },
    },
    {
      id: targetId,
      table: 'block',
      path: [],
      command: 'update',
      args: { last_edited_time: now },
    },
  );

  await notionPost(config, 'submitTransaction', {
    requestId: crypto.randomUUID(),
    transactions: [{ id: crypto.randomUUID(), spaceId: config.spaceId, operations: ops }],
  });

  const mode = anchorText ? `inline on "${anchorText}"` : 'block-level';
  return `Added ${mode} comment ${commentId.replace(/-/g, '')} in new discussion ${discussionId.replace(/-/g, '')} on block ${targetId.replace(/-/g, '')}`;
}

/**
 * Reply to an existing discussion thread.
 */
export async function replyComment(
  config: NotionConfig,
  discussionId: string,
  text: string,
): Promise<string> {
  const discId = parsePageId(discussionId);
  const commentId = crypto.randomUUID();
  const now = Date.now();

  const rt = richText(text);

  const ops: any[] = [
    {
      id: commentId,
      table: 'comment',
      path: [],
      command: 'set',
      args: {
        id: commentId,
        version: 1,
        parent_id: discId,
        parent_table: 'discussion',
        text: rt,
        created_time: now,
        last_edited_time: now,
        alive: true,
        created_by_table: 'notion_user',
        created_by_id: config.userId,
        last_edited_by_table: 'notion_user',
        last_edited_by_id: config.userId,
        space_id: config.spaceId,
      },
    },
    {
      id: discId,
      table: 'discussion',
      path: ['comments'],
      command: 'listAfter',
      args: { id: commentId },
    },
  ];

  await notionPost(config, 'submitTransaction', {
    requestId: crypto.randomUUID(),
    transactions: [{ id: crypto.randomUUID(), spaceId: config.spaceId, operations: ops }],
  });

  return `Added reply ${commentId.replace(/-/g, '')} to discussion ${discId.replace(/-/g, '')}`;
}
