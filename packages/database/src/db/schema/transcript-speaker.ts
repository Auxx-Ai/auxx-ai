// packages/database/src/db/schema/transcript-speaker.ts

import { createId } from '@paralleldrive/cuid2'
import { type AnyPgColumn, boolean, index, pgTable, sql, text, timestamp } from './_shared'
import { CallRecording } from './call-recording'
import { MeetingParticipant } from './meeting-participant'
import { Organization } from './organization'
import { Transcript } from './transcript'

export const TranscriptSpeaker = pgTable(
  'TranscriptSpeaker',
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

    /** Denormalized for queries */
    callRecordingId: text()
      .notNull()
      .references((): AnyPgColumn => CallRecording.id, {
        onUpdate: 'cascade',
        onDelete: 'cascade',
      }),

    name: text().notNull(),
    isHost: boolean(),

    /** Auto-matched participant */
    participantId: text().references((): AnyPgColumn => MeetingParticipant.id, {
      onUpdate: 'cascade',
      onDelete: 'set null',
    }),

    /** Manually corrected participant */
    manualParticipantId: text().references((): AnyPgColumn => MeetingParticipant.id, {
      onUpdate: 'cascade',
      onDelete: 'set null',
    }),

    createdAt: timestamp({ precision: 3 }).default(sql`CURRENT_TIMESTAMP`).notNull(),
  },
  (table) => [
    index('TranscriptSpeaker_transcriptId_idx').using(
      'btree',
      table.transcriptId.asc().nullsLast()
    ),
    index('TranscriptSpeaker_callRecordingId_idx').using(
      'btree',
      table.callRecordingId.asc().nullsLast()
    ),
  ]
)

export type TranscriptSpeakerEntity = typeof TranscriptSpeaker.$inferSelect
export type TranscriptSpeakerInsert = typeof TranscriptSpeaker.$inferInsert
