import type { NotionConfig, RichTextSegment } from '../types.js';
import { notionPost, parsePageId, unwrapRecord } from '../notion-client.js';
import { richText } from '../markdown/to-notion.js';
import { richTextToMarkdown } from '../markdown/from-notion.js';

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
 * Add a new comment (starts a new discussion) on a page or specific block.
 */
export async function addComment(
  config: NotionConfig,
  blockId: string,
  text: string,
): Promise<string> {
  const targetId = parsePageId(blockId);
  const discussionId = crypto.randomUUID();
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
    {
      id: discussionId,
      table: 'discussion',
      path: [],
      command: 'set',
      args: {
        id: discussionId,
        version: 1,
        parent_id: targetId,
        parent_table: 'block',
        comments: [commentId],
        resolved: false,
        space_id: config.spaceId,
        type: 'default',
      },
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
  ];

  await notionPost(config, 'submitTransaction', {
    requestId: crypto.randomUUID(),
    transactions: [{ id: crypto.randomUUID(), spaceId: config.spaceId, operations: ops }],
  });

  return `Added comment ${commentId.replace(/-/g, '')} in new discussion ${discussionId.replace(/-/g, '')} on block ${targetId.replace(/-/g, '')}`;
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
