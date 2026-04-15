// packages/database/src/db/schema/call-recording.ts

import { createId } from '@paralleldrive/cuid2'
import {
  type AnyPgColumn,
  index,
  integer,
  jsonb,
  meetingPlatform,
  pgTable,
  recordingProvider,
  recordingStatus,
  sql,
  text,
  timestamp,
} from './_shared'
import { CalendarEvent } from './calendar-event'
import { EntityInstance } from './entity-instance'
import { File } from './file'
import { Organization } from './organization'
import { User } from './user'

export const CallRecording = pgTable(
  'CallRecording',
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

    /** Meeting entity instance */
    meetingId: text()
      .notNull()
      .references((): AnyPgColumn => EntityInstance.id, {
        onUpdate: 'cascade',
        onDelete: 'cascade',
      }),

    calendarEventId: text().references((): AnyPgColumn => CalendarEvent.id, {
      onUpdate: 'cascade',
      onDelete: 'set null',
    }),

    /** Bot provider */
    provider: recordingProvider().notNull(),

    meetingPlatform: meetingPlatform().notNull(),

    /** Recall.ai bot ID */
    externalBotId: text().notNull(),

    status: recordingStatus().notNull().default('created'),

    /** Video recording */
    videoFileId: text().references((): AnyPgColumn => File.id, {
      onUpdate: 'cascade',
      onDelete: 'set null',
    }),

    /** Audio-only extract */
    audioFileId: text().references((): AnyPgColumn => File.id, {
      onUpdate: 'cascade',
      onDelete: 'set null',
    }),

    /** Thumbnail/preview image */
    videoPreviewFileId: text().references((): AnyPgColumn => File.id, {
      onUpdate: 'cascade',
      onDelete: 'set null',
    }),

    /** Timeline storyboard image */
    videoStoryboardFileId: text().references((): AnyPgColumn => File.id, {
      onUpdate: 'cascade',
      onDelete: 'set null',
    }),

    durationSeconds: integer(),
    botName: text().notNull(),
    consentMessage: text(),

    /** Actual recording start */
    startedAt: timestamp({ precision: 3, withTimezone: true }),

    /** Actual recording end */
    endedAt: timestamp({ precision: 3, withTimezone: true }),

    /** If status = failed */
    failureReason: text(),

    /** Provider-specific data */
    metadata: jsonb(),

    /** Who initiated */
    createdById: text()
      .notNull()
      .references((): AnyPgColumn => User.id, {
        onUpdate: 'cascade',
        onDelete: 'cascade',
      }),

    createdAt: timestamp({ precision: 3 }).default(sql`CURRENT_TIMESTAMP`).notNull(),
    updatedAt: timestamp({ precision: 3 })
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index('CallRecording_organizationId_idx').using(
      'btree',
      table.organizationId.asc().nullsLast()
    ),
    index('CallRecording_meetingId_idx').using('btree', table.meetingId.asc().nullsLast()),
    index('CallRecording_calendarEventId_idx').using(
      'btree',
      table.calendarEventId.asc().nullsLast()
    ),
    index('CallRecording_status_idx').using('btree', table.status.asc().nullsLast()),
    index('CallRecording_organizationId_status_idx').using(
      'btree',
      table.organizationId.asc().nullsLast(),
      table.status.asc().nullsLast()
    ),
    index('CallRecording_externalBotId_idx').using('btree', table.externalBotId.asc().nullsLast()),
    index('CallRecording_createdById_idx').using('btree', table.createdById.asc().nullsLast()),
  ]
)

export type CallRecordingEntity = typeof CallRecording.$inferSelect
export type CallRecordingInsert = typeof CallRecording.$inferInsert
