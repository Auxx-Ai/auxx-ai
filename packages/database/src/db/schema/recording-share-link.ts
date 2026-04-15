// packages/database/src/db/schema/recording-share-link.ts

import { createId } from '@paralleldrive/cuid2'
import {
  type AnyPgColumn,
  boolean,
  index,
  pgTable,
  sql,
  text,
  timestamp,
  uniqueIndex,
} from './_shared'
import { CallRecording } from './call-recording'
import { Organization } from './organization'
import { User } from './user'

export const RecordingShareLink = pgTable(
  'RecordingShareLink',
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

    /** Short ID for public URL */
    publicId: text().notNull(),

    /** null = never expires */
    expiresAt: timestamp({ precision: 3, withTimezone: true }),

    /** Optional password protection */
    password: text(),

    includeVideo: boolean().notNull().default(true),
    includeTranscript: boolean().notNull().default(true),
    includeInsights: boolean().notNull().default(false),

    createdById: text()
      .notNull()
      .references((): AnyPgColumn => User.id, {
        onUpdate: 'cascade',
        onDelete: 'cascade',
      }),

    createdAt: timestamp({ precision: 3 }).default(sql`CURRENT_TIMESTAMP`).notNull(),
  },
  (table) => [
    uniqueIndex('RecordingShareLink_publicId_key').using('btree', table.publicId.asc().nullsLast()),
    index('RecordingShareLink_callRecordingId_idx').using(
      'btree',
      table.callRecordingId.asc().nullsLast()
    ),
  ]
)

export type RecordingShareLinkEntity = typeof RecordingShareLink.$inferSelect
export type RecordingShareLinkInsert = typeof RecordingShareLink.$inferInsert
