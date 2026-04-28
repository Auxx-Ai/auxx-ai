// packages/lib/src/ai/kopilot/capabilities/entities/tools/list-comments.ts

import { schema } from '@auxx/database'
import { and, desc, eq, inArray, isNull } from 'drizzle-orm'
import { getCachedMembersByUserIds } from '../../../../../cache/org-cache-helpers'
import type { AgentToolDefinition } from '../../../../agent-framework/types'
import type { GetToolDeps } from '../../types'

const MAX_LIMIT = 50
const MAX_CONTENT_LENGTH = 600

interface CommentRow {
  id: string
  content: string
  createdAt: Date
  parentId: string | null
  isPinned: boolean
  createdById: string
}

interface CommentDigest {
  id: string
  content: string
  by: { userId: string; name: string | null }
  at: string
  parentId: string | null
  isPinned: boolean
  replyCount?: number
  replies?: CommentDigest[]
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}...` : text
}

export function createListCommentsTool(getDeps: GetToolDeps): AgentToolDefinition {
  return {
    name: 'list_comments',
    idempotent: true,
    description:
      'List comments on an entity, ordered most-recent first. Use to see internal discussion or notes on a record.',
    parameters: {
      type: 'object',
      properties: {
        entityInstanceId: {
          type: 'string',
          description: 'EntityInstance ID (just the instance id, not a full recordId).',
        },
        limit: {
          type: 'number',
          description: `Max top-level comments to return (default 20, max ${MAX_LIMIT}).`,
        },
        includeReplies: {
          type: 'boolean',
          description: 'Whether to nest replies under parent comments (default true).',
        },
      },
      required: ['entityInstanceId'],
      additionalProperties: false,
    },
    execute: async (args, agentDeps) => {
      const { db } = getDeps()
      const entityInstanceId = args.entityInstanceId as string
      const limit = Math.min((args.limit as number) ?? 20, MAX_LIMIT)
      const includeReplies = (args.includeReplies as boolean | undefined) ?? true

      // Top-level comments — Comment rows are scoped by (entityId, organizationId).
      const topLevel = (await db
        .select({
          id: schema.Comment.id,
          content: schema.Comment.content,
          createdAt: schema.Comment.createdAt,
          parentId: schema.Comment.parentId,
          isPinned: schema.Comment.isPinned,
          createdById: schema.Comment.createdById,
        })
        .from(schema.Comment)
        .where(
          and(
            eq(schema.Comment.entityId, entityInstanceId),
            eq(schema.Comment.organizationId, agentDeps.organizationId),
            isNull(schema.Comment.parentId),
            isNull(schema.Comment.deletedAt)
          )
        )
        .orderBy(desc(schema.Comment.isPinned), desc(schema.Comment.createdAt))
        .limit(limit + 1)) as CommentRow[]

      const hasMore = topLevel.length > limit
      const top = hasMore ? topLevel.slice(0, limit) : topLevel

      // Replies — fetch all replies for the visible top-level comments in one query.
      let replies: CommentRow[] = []
      if (top.length > 0) {
        const parentIds = top.map((c) => c.id)
        replies = (await db
          .select({
            id: schema.Comment.id,
            content: schema.Comment.content,
            createdAt: schema.Comment.createdAt,
            parentId: schema.Comment.parentId,
            isPinned: schema.Comment.isPinned,
            createdById: schema.Comment.createdById,
          })
          .from(schema.Comment)
          .where(
            and(
              inArray(schema.Comment.parentId, parentIds),
              eq(schema.Comment.organizationId, agentDeps.organizationId),
              isNull(schema.Comment.deletedAt)
            )
          )
          .orderBy(schema.Comment.createdAt)) as CommentRow[]
      }

      // Resolve actor names from the org members cache.
      const userIds = Array.from(
        new Set([...top, ...replies].map((c) => c.createdById).filter(Boolean))
      )
      const members = userIds.length
        ? await getCachedMembersByUserIds(agentDeps.organizationId, userIds)
        : []
      const nameByUserId = new Map(members.map((m) => [m.userId, m.user?.name ?? null]))

      const repliesByParent = new Map<string, CommentRow[]>()
      for (const r of replies) {
        if (!r.parentId) continue
        const arr = repliesByParent.get(r.parentId) ?? []
        arr.push(r)
        repliesByParent.set(r.parentId, arr)
      }

      const toDigest = (c: CommentRow): CommentDigest => ({
        id: c.id,
        content: truncate(c.content, MAX_CONTENT_LENGTH),
        by: { userId: c.createdById, name: nameByUserId.get(c.createdById) ?? null },
        at: c.createdAt.toISOString(),
        parentId: c.parentId,
        isPinned: c.isPinned,
      })

      const comments: CommentDigest[] = top.map((c) => {
        const childRows = repliesByParent.get(c.id) ?? []
        const digest = toDigest(c)
        if (includeReplies) {
          digest.replies = childRows.map(toDigest)
        } else {
          digest.replyCount = childRows.length
        }
        return digest
      })

      return {
        success: true,
        output: { comments, hasMore },
      }
    },
  }
}
