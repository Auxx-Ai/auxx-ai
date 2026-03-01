// packages/database/src/db/schema/app-event-log.ts
// Drizzle table for app event log

import { createId } from '@paralleldrive/cuid2'
import { type AnyPgColumn, index, integer, jsonb, pgTable, text, timestamp } from './_shared'
import { App } from './app'
import { AppDeployment } from './app-deployment'
import { Organization } from './organization'

/** Drizzle table for AppEventLog */
export const AppEventLog = pgTable(
  'AppEventLog',
  {
    id: text()
      .$defaultFn(() => createId())
      .primaryKey()
      .notNull(),
    appId: text()
      .notNull()
      .references((): AnyPgColumn => App.id, { onUpdate: 'cascade', onDelete: 'cascade' }),

    // Context
    organizationId: text()
      .notNull()
      .references((): AnyPgColumn => Organization.id, { onUpdate: 'cascade', onDelete: 'cascade' }),
    appDeploymentId: text().references((): AnyPgColumn => AppDeployment.id, {
      onUpdate: 'cascade',
      onDelete: 'set null',
    }),
    userId: text(),

    // Event details
    eventType: text().notNull(),
    eventData: jsonb(),

    // Request/Response
    requestMethod: text(),
    requestPath: text(),
    responseStatus: integer(),

    // Timing
    durationMs: integer(),

    timestamp: timestamp({ precision: 3 }).defaultNow().notNull(),
  },
  (table) => [
    index('AppEventLog_appId_idx').using('btree', table.appId.asc().nullsLast()),
    index('AppEventLog_organizationId_idx').using('btree', table.organizationId.asc().nullsLast()),
    index('AppEventLog_appDeploymentId_idx').using(
      'btree',
      table.appDeploymentId.asc().nullsLast()
    ),
    index('AppEventLog_timestamp_idx').using('btree', table.timestamp.asc().nullsLast()),
  ]
)
