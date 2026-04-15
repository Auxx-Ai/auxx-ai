// packages/database/src/db/schema/recording-chapter.ts

import { createId } from '@paralleldrive/cuid2'
import { type AnyPgColumn, index, integer, pgTable, sql, text, timestamp } from './_shared'
import { CallRecording } from './call-recording'
import { Organization } from './organization'

export const RecordingChapter = pgTable(
  'RecordingChapter',
  {
    id: text()
      .primaryKey()
      .notNull()
      .$defaultFn(() => createId()),

    organizationId: text()
      .notNull()
      .references((): AnyPgColumn => Organization.id, {
        onUpdate: 'cascade',
        onDelete: 'cascade',
      }),

    callRecordingId: text()
      .notNull()
      .references((): AnyPgColumn => CallRecording.id, {
        onUpdate: 'cascade',
        onDelete: 'cascade',
      }),

    title: text().notNull(),

    /** Start time in milliseconds */
    startMs: integer().notNull(),

    /** End time in milliseconds */
    endMs: integer().notNull(),

    sortOrder: integer().notNull(),

    createdAt: timestamp({ precision: 3 }).default(sql`CURRENT_TIMESTAMP`).notNull(),
  },
  (table) => [
    index('RecordingChapter_callRecordingId_sortOrder_idx').using(
      'btree',
      table.callRecordingId.asc().nullsLast(),
      table.sortOrder.asc().nullsLast()
    ),
  ]
)

export type RecordingChapterEntity = typeof RecordingChapter.$inferSelect
export type RecordingChapterInsert = typeof RecordingChapter.$inferInsert
