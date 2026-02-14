// packages/database/src/db/schema/inbox-integration.ts
// Drizzle table: inboxIntegration

import { createId } from '@paralleldrive/cuid2'
import {
  type AnyPgColumn,
  boolean,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from './_shared'

import { EntityInstance } from './entity-instance'
import { Integration } from './integration'

/**
 * Drizzle table for inboxIntegration
 * Links integrations to inbox EntityInstances
 */
export const InboxIntegration = pgTable(
  'InboxIntegration',
  {
    id: text()
      .$defaultFn(() => createId())
      .primaryKey()
      .notNull(),
    createdAt: timestamp({ precision: 3 }).defaultNow().notNull(),
    updatedAt: timestamp({ precision: 3 }).notNull(),
    settings: jsonb().default({}),
    isDefault: boolean().default(false).notNull(),
    /** References inbox EntityInstance.id */
    inboxId: text()
      .notNull()
      .references((): AnyPgColumn => EntityInstance.id, {
        onUpdate: 'cascade',
        onDelete: 'cascade',
      }),
    integrationId: text()
      .notNull()
      .references((): AnyPgColumn => Integration.id, { onUpdate: 'cascade', onDelete: 'cascade' }),
  },
  (table) => [
    index('InboxIntegration_inboxId_idx').using('btree', table.inboxId.asc().nullsLast()),
    uniqueIndex('InboxIntegration_inboxId_integrationId_key').using(
      'btree',
      table.inboxId.asc().nullsLast(),
      table.integrationId.asc().nullsLast()
    ),
    uniqueIndex('InboxIntegration_integrationId_key').using(
      'btree',
      table.integrationId.asc().nullsLast()
    ),
  ]
)
