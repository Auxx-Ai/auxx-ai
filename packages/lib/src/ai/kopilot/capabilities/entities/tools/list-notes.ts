// packages/lib/src/ai/kopilot/capabilities/entities/tools/list-notes.ts

import { z } from 'zod'
import { getCachedMembersByUserIds } from '../../../../../cache/org-cache-helpers'
import { CommentService } from '../../../../../comments'
import type { RecordId } from '../../../../../resources/resource-id'
import { docToText } from '../../../../../tiptap'
import { getKnownDefIds, normalizeRecordIdArg } from '../../../../agent-framework/tool-inputs'
import type { AgentToolDefinition } from '../../../../agent-framework/types'
import type { GetToolDeps } from '../../types'

const MAX_LIMIT = 50
const MAX_CONTENT_LENGTH = 600

/** Recursive note shape — top-level notes carry nested `replies` or a `replyCount`. */
const NoteDigestSchema: z.ZodType<{
  id: string
  content: string
  by: { userId: string; name: string | null }
  at: string
  parentId: string | null
  isPinned: boolean
  replyCount?: number
  replies?: unknown[]
}> = z.object({
  id: z.string(),
  content: z.string(),
  by: z.object({ userId: z.string(), name: z.string().nullable() }),
  at: z.string(),
  parentId: z.string().nullable(),
  isPinned: z.boolean(),
  replyCount: z.number().optional(),
  replies: z.array(z.lazy(() => NoteDigestSchema)).optional(),
})

/** Full success output of `list_notes` — top-level notes (most-recent first) + pagination flag. */
const ListNotesOutput = z.object({
  notes: z.array(NoteDigestSchema),
  hasMore: z.boolean(),
})

interface NoteDigest {
  id: string
  content: string
  by: { userId: string; name: string | null }
  at: string
  parentId: string | null
  isPinned: boolean
  replyCount?: number
  replies?: NoteDigest[]
}

function truncate(text: string | null | undefined, max: number): string {
  if (!text) return ''
  return text.length > max ? `${text.slice(0, max)}...` : text
}

export function createListNotesTool(getDeps: GetToolDeps): AgentToolDefinition {
  return {
    name: 'list_notes',
    displayName: 'List notes',
    toolsetSlug: 'auxx:comments:read',
    category: 'system',
    idempotent: true,
    outputSchema: ListNotesOutput,
    exampleOutput: {
      notes: [
        {
          id: 'comment_5tR8wK',
          content: 'Customer requested a callback on Friday afternoon.',
          by: { userId: 'user_7Hd2', name: 'Alex Morgan' },
          at: '2026-06-04T10:15:00.000Z',
          parentId: null,
          isPinned: true,
          replies: [
            {
              id: 'comment_8nM3vC',
              content: 'Called back — left a voicemail.',
              by: { userId: 'user_9Kp4', name: 'Sam Rivera' },
              at: '2026-06-04T16:40:00.000Z',
              parentId: 'comment_5tR8wK',
              isPinned: false,
            },
          ],
        },
      ],
      hasMore: false,
    } satisfies z.output<typeof ListNotesOutput>,
    buildDigest: (output) => {
      const out = (output ?? {}) as { notes?: unknown[] }
      return { count: Array.isArray(out.notes) ? out.notes.length : 0 }
    },
    description:
      'List internal notes (a.k.a. comments) on a record. Use whenever the user asks for notes, comments, discussion, internal remarks, or annotations on an entity. Ordered most-recent first.',
    parameters: {
      type: 'object',
      properties: {
        recordId: {
          type: 'string',
          description: 'Record ID (format: entityDefinitionId:entityInstanceId).',
        },
        limit: {
          type: 'number',
          description: `Max top-level notes to return (default 20, max ${MAX_LIMIT}).`,
        },
        includeReplies: {
          type: 'boolean',
          description: 'Whether to nest replies under parent notes (default true).',
        },
      },
      required: ['recordId'],
      additionalProperties: false,
    },
    validateInputs: async (args, ctx) => {
      const known = await getKnownDefIds(ctx.organizationId)
      const recordId = normalizeRecordIdArg(args.recordId, {
        knownDefIds: known,
        argName: 'recordId',
      })
      if (!recordId.ok) return { ok: false, error: recordId.error }
      return {
        ok: true,
        args: { ...args, recordId: recordId.value },
        warnings: recordId.warnings,
      }
    },
    execute: async (args, agentDeps) => {
      const { db } = getDeps()
      const recordId = args.recordId as RecordId
      const limit = Math.min((args.limit as number) ?? 20, MAX_LIMIT)
      const includeReplies = (args.includeReplies as boolean | undefined) ?? true

      const service = new CommentService(agentDeps.organizationId, agentDeps.userId, db)

      let comments
      try {
        // Fetch limit + 1 so we can compute hasMore.
        comments = await service.getCommentsByRecordId(recordId, {
          includeReplies,
          page: 1,
          limit: limit + 1,
        })
      } catch (err) {
        return {
          success: false,
          output: null,
          error: err instanceof Error ? err.message : 'Failed to load notes',
        }
      }

      const hasMore = comments.length > limit
      const top = hasMore ? comments.slice(0, limit) : comments

      // Resolve actor names from the org members cache.
      const collectIds = (rows: Array<{ createdById: string; replies?: any[] }>): string[] => {
        const ids: string[] = []
        for (const r of rows) {
          if (r.createdById) ids.push(r.createdById)
          if (r.replies) ids.push(...collectIds(r.replies))
        }
        return ids
      }
      const userIds = Array.from(new Set(collectIds(top as any)))
      const members = userIds.length
        ? await getCachedMembersByUserIds(agentDeps.organizationId, userIds)
        : []
      const nameByUserId = new Map(members.map((m) => [m.userId, m.user?.name ?? null]))

      const toDigest = (c: any): NoteDigest => ({
        id: c.id,
        content: truncate(docToText(c.contentJson ?? {}), MAX_CONTENT_LENGTH),
        by: { userId: c.createdById, name: nameByUserId.get(c.createdById) ?? null },
        at: c.createdAt instanceof Date ? c.createdAt.toISOString() : String(c.createdAt),
        parentId: c.parentId ?? null,
        isPinned: !!c.isPinned,
      })

      const notes: NoteDigest[] = top.map((c: any) => {
        const digest = toDigest(c)
        const replyRows = (c.replies ?? []) as any[]
        if (includeReplies) {
          digest.replies = replyRows.map(toDigest)
        } else {
          digest.replyCount = replyRows.length
        }
        return digest
      })

      return {
        success: true,
        output: { notes, hasMore },
      }
    },
  }
}
