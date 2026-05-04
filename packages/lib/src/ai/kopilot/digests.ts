// packages/lib/src/ai/kopilot/digests.ts

import { z } from 'zod'

/**
 * Shared digest schemas for kopilot tools. A digest is the small, typed
 * projection of a tool's output that the frontend uses to render status pills
 * and approval/result cards. See the implementation plan §B for the rationale.
 *
 * Conventions:
 *  - `count` always reflects the full result count, not the sample length.
 *  - `sample` is capped at 3 items so digests stay small in storage.
 *  - Snapshot shapes (thread, entity, task) match `TurnSnapshots` so the
 *    frontend can reuse the same renderers for both.
 */

const DIGEST_SAMPLE_MAX = 3

export const ThreadDigestSnapshot = z.object({
  threadId: z.string(),
  subject: z.string().nullable(),
  sender: z.string().optional(),
  lastMessageAt: z.string().nullable().optional(),
  isUnread: z.boolean().optional(),
})
export type ThreadDigestSnapshot = z.infer<typeof ThreadDigestSnapshot>

export const EntityDigestSnapshot = z.object({
  recordId: z.string(),
  entityDefinitionId: z.string(),
  displayName: z.string(),
  secondary: z.string().optional(),
})
export type EntityDigestSnapshot = z.infer<typeof EntityDigestSnapshot>

export const TaskDigestSnapshot = z.object({
  taskId: z.string(),
  title: z.string(),
  deadline: z.string().nullable().optional(),
  completedAt: z.string().nullable().optional(),
})
export type TaskDigestSnapshot = z.infer<typeof TaskDigestSnapshot>

export const FindThreadsDigest = z.object({
  count: z.number(),
  sample: z.array(ThreadDigestSnapshot).max(DIGEST_SAMPLE_MAX),
})
export type FindThreadsDigest = z.infer<typeof FindThreadsDigest>

export const DraftDigestSnapshot = z.object({
  id: z.string(),
  kind: z.enum(['reply', 'standalone']),
  subject: z.string().nullable(),
  snippet: z.string().nullable(),
  recipientSummary: z.string().nullable(),
  updatedAt: z.string(),
  scheduledAt: z.string().nullable(),
  threadId: z.string().nullable().optional(),
})
export type DraftDigestSnapshot = z.infer<typeof DraftDigestSnapshot>

export const ListDraftsDigest = z.object({
  count: z.number(),
  sample: z.array(DraftDigestSnapshot).max(DIGEST_SAMPLE_MAX),
})
export type ListDraftsDigest = z.infer<typeof ListDraftsDigest>

export const GetThreadDetailDigest = z.object({
  threadId: z.string(),
  subject: z.string().nullable(),
  messageCount: z.number(),
  lastMessageAt: z.string().nullable().optional(),
})
export type GetThreadDetailDigest = z.infer<typeof GetThreadDetailDigest>

export const SearchEntitiesDigest = z.object({
  count: z.number(),
  sample: z.array(EntityDigestSnapshot).max(DIGEST_SAMPLE_MAX),
})
export type SearchEntitiesDigest = z.infer<typeof SearchEntitiesDigest>

export const QueryRecordsDigest = SearchEntitiesDigest
export type QueryRecordsDigest = z.infer<typeof QueryRecordsDigest>

export const GetEntityDigest = z.object({
  recordId: z.string(),
  entityDefinitionId: z.string().optional(),
  displayName: z.string(),
  secondary: z.string().optional(),
})
export type GetEntityDigest = z.infer<typeof GetEntityDigest>

export const GetEntityHistoryDigest = z.object({
  entityId: z.string(),
  threadCount: z.number(),
  commentCount: z.number(),
  taskCount: z.number(),
})
export type GetEntityHistoryDigest = z.infer<typeof GetEntityHistoryDigest>

export const ListEntitiesDigest = z.object({
  entityTypes: z.array(z.string()),
})
export type ListEntitiesDigest = z.infer<typeof ListEntitiesDigest>

export const ListEntityFieldsDigest = z.object({
  entityType: z.string(),
  fieldCount: z.number(),
})
export type ListEntityFieldsDigest = z.infer<typeof ListEntityFieldsDigest>

export const ListTasksDigest = z.object({
  count: z.number(),
  sample: z.array(TaskDigestSnapshot).max(DIGEST_SAMPLE_MAX),
})
export type ListTasksDigest = z.infer<typeof ListTasksDigest>

export const ListMembersDigest = z.object({
  count: z.number(),
  names: z.array(z.string()).max(DIGEST_SAMPLE_MAX),
})
export type ListMembersDigest = z.infer<typeof ListMembersDigest>

export const ListGroupsDigest = ListMembersDigest
export type ListGroupsDigest = z.infer<typeof ListGroupsDigest>

export const ListTagsDigest = z.object({
  count: z.number(),
  names: z.array(z.string()).max(DIGEST_SAMPLE_MAX),
})
export type ListTagsDigest = z.infer<typeof ListTagsDigest>

export const ListFieldChangesDigest = z.object({
  count: z.number(),
  sample: z
    .array(
      z.object({
        fieldKey: z.string(),
        oldValue: z.unknown().optional(),
        newValue: z.unknown().optional(),
      })
    )
    .max(DIGEST_SAMPLE_MAX),
})
export type ListFieldChangesDigest = z.infer<typeof ListFieldChangesDigest>

export const ArticleSearchDigest = z.object({
  articleCount: z.number(),
  titles: z.array(z.string()).max(DIGEST_SAMPLE_MAX),
})
export type ArticleSearchDigest = z.infer<typeof ArticleSearchDigest>

export const GetTranscriptDigest = z.object({
  recordingId: z.string(),
  durationMin: z.number().optional(),
})
export type GetTranscriptDigest = z.infer<typeof GetTranscriptDigest>

export const ListTranscriptsForEntityDigest = z.object({
  count: z.number(),
  ids: z.array(z.string()).max(DIGEST_SAMPLE_MAX),
})
export type ListTranscriptsForEntityDigest = z.infer<typeof ListTranscriptsForEntityDigest>

export const EmailWriteDigest = z.object({
  threadId: z.string().optional(),
  draftId: z.string().optional(),
  messageId: z.string().optional(),
  mode: z.enum(['draft', 'send']),
  status: z.string().optional(),
  recipients: z.array(z.string()).optional(),
  subject: z.string().nullable().optional(),
  body: z.string().optional(),
})
export type EmailWriteDigest = z.infer<typeof EmailWriteDigest>

export const UpdateThreadDigest = z.object({
  threadId: z.string(),
  subject: z.string().nullable().optional(),
  changes: z.array(z.string()),
})
export type UpdateThreadDigest = z.infer<typeof UpdateThreadDigest>

export const UpdateEntityDigest = z.object({
  recordId: z.string(),
  displayName: z.string().optional(),
  updatedFields: z.array(z.string()),
})
export type UpdateEntityDigest = z.infer<typeof UpdateEntityDigest>

export const BulkUpdateEntityDigest = z.object({
  recordCount: z.number(),
  updatedFields: z.array(z.string()),
  sample: z.array(EntityDigestSnapshot).max(DIGEST_SAMPLE_MAX),
})
export type BulkUpdateEntityDigest = z.infer<typeof BulkUpdateEntityDigest>

export const CreateEntityDigest = z.object({
  recordId: z.string(),
  displayName: z.string(),
  entityDefinitionId: z.string().optional(),
})
export type CreateEntityDigest = z.infer<typeof CreateEntityDigest>

export const CreateTaskDigest = z.object({
  taskId: z.string(),
  title: z.string(),
  deadline: z.string().nullable().optional(),
  assignees: z.array(z.string()).optional(),
})
export type CreateTaskDigest = z.infer<typeof CreateTaskDigest>

export const CreateNoteDigest = z.object({
  entityId: z.string().optional(),
  noteId: z.string(),
})
export type CreateNoteDigest = z.infer<typeof CreateNoteDigest>

export const ListNotesDigest = z.object({
  count: z.number(),
})
export type ListNotesDigest = z.infer<typeof ListNotesDigest>

/**
 * Helper for tools whose output is a `{ count, ... }` shape and that don't
 * benefit from per-tool snapshots — keeps the pill renderable without a
 * bespoke `buildDigest`.
 */
export function takeSample<T>(items: readonly T[] | undefined, n = DIGEST_SAMPLE_MAX): T[] {
  if (!items || !Array.isArray(items)) return []
  return items.slice(0, n)
}
