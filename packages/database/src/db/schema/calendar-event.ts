// packages/database/src/db/schema/calendar-event.ts

import { createId } from '@paralleldrive/cuid2'
import {
  type AnyPgColumn,
  boolean,
  calendarEventStatus,
  calendarProvider,
  index,
  jsonb,
  meetingPlatform,
  pgTable,
  sql,
  text,
  timestamp,
  uniqueIndex,
} from './_shared'
import { EntityInstance } from './entity-instance'
import { Organization } from './organization'
import { User } from './user'

export const CalendarEvent = pgTable(
  'CalendarEvent',
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

    /** Calendar owner */
    userId: text()
      .notNull()
      .references((): AnyPgColumn => User.id, {
        onUpdate: 'cascade',
        onDelete: 'cascade',
      }),

    provider: calendarProvider().notNull(),

    /** Provider's event ID */
    externalId: text().notNull(),

    title: text().notNull(),
    description: text(),
    startTime: timestamp({ precision: 3, withTimezone: true }).notNull(),
    endTime: timestamp({ precision: 3, withTimezone: true }).notNull(),
    timezone: text().notNull(),

    /** Google Meet / Teams / Zoom URL */
    meetingUrl: text(),

    /** Detected from meetingUrl */
    meetingPlatform: meetingPlatform(),

    location: text(),
    isAllDay: boolean().notNull().default(false),
    status: calendarEventStatus().notNull().default('confirmed'),

    /** { email, name, self } */
    organizer: jsonb().notNull(),

    /** [{ email, name, status, self }] */
    attendees: jsonb().notNull().default([]),

    /** Has attendees from outside org domain */
    isExternal: boolean().notNull().default(false),

    /** For recurring series */
    recurringEventId: text(),

    /** Full provider response for debugging */
    rawData: jsonb(),

    /** Last sync time */
    syncedAt: timestamp({ precision: 3, withTimezone: true }).notNull(),

    /** Linked Meeting entity */
    entityInstanceId: text().references((): AnyPgColumn => EntityInstance.id, {
      onUpdate: 'cascade',
      onDelete: 'set null',
    }),

    createdAt: timestamp({ precision: 3 }).default(sql`CURRENT_TIMESTAMP`).notNull(),
    updatedAt: timestamp({ precision: 3 })
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex('CalendarEvent_org_provider_externalId_key').using(
      'btree',
      table.organizationId.asc().nullsLast(),
      table.provider.asc().nullsLast(),
      table.externalId.asc().nullsLast()
    ),
    index('CalendarEvent_organizationId_idx').using(
      'btree',
      table.organizationId.asc().nullsLast()
    ),
    index('CalendarEvent_userId_idx').using('btree', table.userId.asc().nullsLast()),
    index('CalendarEvent_startTime_endTime_idx').using(
      'btree',
      table.startTime.asc().nullsLast(),
      table.endTime.asc().nullsLast()
    ),
    index('CalendarEvent_entityInstanceId_idx').using(
      'btree',
      table.entityInstanceId.asc().nullsLast()
    ),
  ]
)

export type CalendarEventEntity = typeof CalendarEvent.$inferSelect
export type CalendarEventInsert = typeof CalendarEvent.$inferInsert
