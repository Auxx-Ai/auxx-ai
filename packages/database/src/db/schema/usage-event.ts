// packages/database/src/db/schema/usage-event.ts

import { createId } from '@paralleldrive/cuid2'
import { type AnyPgColumn, index, integer, jsonb, pgTable, text, timestamp } from './_shared'

import { Organization } from './organization'
import { User } from './user'

/** Drizzle table for usage events (durable audit trail for metered usage) */
export const UsageEvent = pgTable(
  'UsageEvent',
  {
    id: text()
      .$defaultFn(() => createId())
      .primaryKey()
      .notNull(),
    organizationId: text()
      .notNull()
      .references((): AnyPgColumn => Organization.id, { onDelete: 'cascade' }),
    userId: text().references((): AnyPgColumn => User.id, { onDelete: 'set null' }),
    /** Usage metric name: 'outboundEmails', 'workflowRuns', 'aiCompletions', etc. */
    metric: text().notNull(),
    quantity: integer().default(1).notNull(),
    metadata: jsonb(),
    /** Calendar month key, e.g. '2026-03' */
    periodKey: text().notNull(),
    createdAt: timestamp({ precision: 3 }).defaultNow().notNull(),
  },
  (table) => [
    index('UsageEvent_org_metric_period_idx').using(
      'btree',
      table.organizationId.asc().nullsLast(),
      table.metric.asc().nullsLast(),
      table.periodKey.asc().nullsLast()
    ),
  ]
)
