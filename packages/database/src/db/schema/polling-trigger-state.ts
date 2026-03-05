// packages/database/src/db/schema/polling-trigger-state.ts

import { createId } from '@paralleldrive/cuid2'
import {
  type AnyPgColumn,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from './_shared'
import { Organization } from './organization'
import { WorkflowApp } from './workflow-app'

export const PollingTriggerState = pgTable(
  'PollingTriggerState',
  {
    id: text()
      .$defaultFn(() => createId())
      .primaryKey()
      .notNull(),
    organizationId: text()
      .notNull()
      .references((): AnyPgColumn => Organization.id, { onUpdate: 'cascade', onDelete: 'cascade' }),
    workflowAppId: text()
      .notNull()
      .references((): AnyPgColumn => WorkflowApp.id, { onUpdate: 'cascade', onDelete: 'cascade' }),
    /** App trigger ID, e.g. 'gog-calendar.event-trigger' */
    triggerId: text().notNull(),
    /** Persisted polling state: lastTimeChecked, cursor, pageToken, etc. */
    state: jsonb().$type<Record<string, unknown>>().notNull().default({}),
    lastPollAt: timestamp({ precision: 3 }),
    /** 'success' | 'error' | 'no_events' */
    lastPollStatus: text(),
    lastPollError: text(),
    consecutiveErrors: integer().default(0).notNull(),
    createdAt: timestamp({ precision: 3 }).defaultNow().notNull(),
    updatedAt: timestamp({ precision: 3 })
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex('PollingTriggerState_workflowAppId_triggerId_key').using(
      'btree',
      table.workflowAppId.asc().nullsLast(),
      table.triggerId.asc().nullsLast()
    ),
    index('PollingTriggerState_organizationId_idx').using(
      'btree',
      table.organizationId.asc().nullsLast()
    ),
  ]
)

export type PollingTriggerStateEntity = typeof PollingTriggerState.$inferSelect
export type CreatePollingTriggerStateInput = typeof PollingTriggerState.$inferInsert
export type UpdatePollingTriggerStateInput = Partial<CreatePollingTriggerStateInput>
