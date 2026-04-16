// packages/database/src/db/schema/transcript.ts

import { createId } from '@paralleldrive/cuid2'
import {
  type AnyPgColumn,
  doublePrecision,
  index,
  integer,
  pgTable,
  sql,
  text,
  timestamp,
  transcriptStatus,
  transcriptType,
} from './_shared'
import { CallRecording } from './call-recording'
import { Organization } from './organization'

export const Transcript = pgTable(
  'Transcript',
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

    transcriptionProvider: text().notNull(),
    type: transcriptType().notNull(),

    /** Detected language */
    language: text(),

    status: transcriptStatus().notNull().default('processing'),

    /** Provider's job ID */
    externalJobId: text(),

    /** Flat searchable text */
    fullText: text(),

    wordCount: integer(),

    /** Average confidence score */
    confidence: doublePrecision(),

    createdAt: timestamp({ precision: 3 }).default(sql`CURRENT_TIMESTAMP`).notNull(),
    updatedAt: timestamp({ precision: 3 })
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index('Transcript_organizationId_idx').using('btree', table.organizationId.asc().nullsLast()),
    index('Transcript_callRecordingId_idx').using('btree', table.callRecordingId.asc().nullsLast()),
    index('Transcript_status_idx').using('btree', table.status.asc().nullsLast()),
  ]
)

export type TranscriptEntity = typeof Transcript.$inferSelect
export type TranscriptInsert = typeof Transcript.$inferInsert
