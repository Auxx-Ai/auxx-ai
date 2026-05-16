// packages/database/src/db/schema/comment-reference.ts
// Drizzle table: CommentReference

import { createId } from '@paralleldrive/cuid2'
import { type AnyPgColumn, index, pgTable, text, timestamp, uniqueIndex } from './_shared'
import { Comment } from './comment'

/**
 * Per-comment reference rows. One row per inline `<reference>` node in the
 * comment's Tiptap body, identifying the referenced record via a
 * `(entityDefinitionId, entityInstanceId)` pair — same convention as
 * `TaskReference`, `Notification`, and `TimelineEvent`.
 *
 * No FK on the instance id: it can point at `User`, `EntityInstance`,
 * `Article`, `Thread`, etc. depending on the definition. Round-trips to
 * `RecordId` via `parseRecordId` / `toRecordId` from `@auxx/types/resource`.
 */
export const CommentReference = pgTable(
  'CommentReference',
  {
    id: text()
      .$defaultFn(() => createId())
      .primaryKey()
      .notNull(),
    commentId: text()
      .notNull()
      .references((): AnyPgColumn => Comment.id, { onUpdate: 'cascade', onDelete: 'cascade' }),
    /** RecordId left half — 'user' | 'agent' | 'thread' | 'article' | system entity slug | custom-entity cuid. */
    entityDefinitionId: text().notNull(),
    /** RecordId right half — the actual instance id (User.id / EntityInstance.id / Article.id / Thread.id / …). */
    entityInstanceId: text().notNull(),
    createdAt: timestamp({ precision: 3 }).defaultNow().notNull(),
  },
  (table) => [
    index('CommentReference_commentId_idx').on(table.commentId),
    // Dedup per comment.
    uniqueIndex('CommentReference_commentId_def_inst_key').on(
      table.commentId,
      table.entityDefinitionId,
      table.entityInstanceId
    ),
    // Hot path for the trigger dispatcher's
    // "find references to (def='agent', inst=<agentId>)" lookup.
    index('CommentReference_def_inst_idx').on(table.entityDefinitionId, table.entityInstanceId),
  ]
)

/** Selected CommentReference entity type */
export type CommentReferenceEntity = typeof CommentReference.$inferSelect
export type CommentReferenceInsert = typeof CommentReference.$inferInsert
