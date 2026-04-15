// packages/database/src/db/schema/meeting-participant.ts

import { createId } from '@paralleldrive/cuid2'
import {
  type AnyPgColumn,
  boolean,
  index,
  pgTable,
  rsvpStatus,
  sql,
  text,
  timestamp,
} from './_shared'
import { CalendarEvent } from './calendar-event'
import { EntityInstance } from './entity-instance'
import { Organization } from './organization'
import { User } from './user'

export const MeetingParticipant = pgTable(
  'MeetingParticipant',
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

    /** The Meeting entity instance */
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

    /** If internal user */
    userId: text().references((): AnyPgColumn => User.id, {
      onUpdate: 'cascade',
      onDelete: 'set null',
    }),

    name: text().notNull(),
    email: text().notNull(),

    /** Extracted for company matching */
    emailDomain: text().notNull(),

    /** Matched Contact entity */
    contactEntityInstanceId: text().references((): AnyPgColumn => EntityInstance.id, {
      onUpdate: 'cascade',
      onDelete: 'set null',
    }),

    /** Matched Company entity */
    companyEntityInstanceId: text().references((): AnyPgColumn => EntityInstance.id, {
      onUpdate: 'cascade',
      onDelete: 'set null',
    }),

    isOrganizer: boolean().notNull().default(false),
    rsvpStatus: rsvpStatus().notNull().default('needs_action'),
    isBot: boolean().notNull().default(false),

    /** Not from org domain */
    isExternal: boolean().notNull().default(false),

    createdAt: timestamp({ precision: 3 }).default(sql`CURRENT_TIMESTAMP`).notNull(),
    updatedAt: timestamp({ precision: 3 })
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index('MeetingParticipant_organizationId_idx').using(
      'btree',
      table.organizationId.asc().nullsLast()
    ),
    index('MeetingParticipant_meetingId_idx').using('btree', table.meetingId.asc().nullsLast()),
    index('MeetingParticipant_calendarEventId_idx').using(
      'btree',
      table.calendarEventId.asc().nullsLast()
    ),
    index('MeetingParticipant_email_idx').using('btree', table.email.asc().nullsLast()),
    index('MeetingParticipant_emailDomain_idx').using('btree', table.emailDomain.asc().nullsLast()),
    index('MeetingParticipant_contactEntityInstanceId_idx').using(
      'btree',
      table.contactEntityInstanceId.asc().nullsLast()
    ),
    index('MeetingParticipant_companyEntityInstanceId_idx').using(
      'btree',
      table.companyEntityInstanceId.asc().nullsLast()
    ),
  ]
)

export type MeetingParticipantEntity = typeof MeetingParticipant.$inferSelect
export type MeetingParticipantInsert = typeof MeetingParticipant.$inferInsert
