// packages/database/src/db/schema/transcript-utterance.ts

import { createId } from '@paralleldrive/cuid2'
import {
  type AnyPgColumn,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  sql,
  text,
  timestamp,
} from './_shared'
import { Organization } from './organization'
import { Transcript } from './transcript'
import { TranscriptSpeaker } from './transcript-speaker'

export const TranscriptUtterance = pgTable(
  'TranscriptUtterance',
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

    transcriptId: text()
      .notNull()
      .references((): AnyPgColumn => Transcript.id, {
        onUpdate: 'cascade',
        onDelete: 'cascade',
      }),

    speakerId: text()
      .notNull()
      .references((): AnyPgColumn => TranscriptSpeaker.id, {
        onUpdate: 'cascade',
        onDelete: 'cascade',
      }),

    /** Start time in milliseconds */
    startMs: integer().notNull(),

    /** End time in milliseconds */
    endMs: integer().notNull(),

    /** Spoken text */
    text: text().notNull(),

    /** Per-word timings from the provider — provider-agnostic shape. Null for older rows or providers that don't emit word-level timing. */
    words: jsonb().$type<{ text: string; startMs: number; endMs: number }[]>(),

    confidence: doublePrecision(),

    /** For ordering */
    sortOrder: integer().notNull(),

    createdAt: timestamp({ precision: 3 }).default(sql`CURRENT_TIMESTAMP`).notNull(),
  },
  (table) => [
    index('TranscriptUtterance_transcriptId_sortOrder_idx').using(
      'btree',
      table.transcriptId.asc().nullsLast(),
      table.sortOrder.asc().nullsLast()
    ),
    index('TranscriptUtterance_speakerId_idx').using('btree', table.speakerId.asc().nullsLast()),
  ]
)

export type TranscriptUtteranceEntity = typeof TranscriptUtterance.$inferSelect
export type TranscriptUtteranceInsert = typeof TranscriptUtterance.$inferInsert
