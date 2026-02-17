// packages/database/src/db/schema/signature-integration-share.ts
// Drizzle table: signatureIntegrationShare

import { createId } from '@paralleldrive/cuid2'
import { type AnyPgColumn, index, pgTable, text, timestamp, uniqueIndex } from './_shared'

import { EntityInstance } from './entity-instance'
import { Integration } from './integration'

/** Drizzle table for signatureIntegrationShare — links signature EntityInstances to integrations */
export const SignatureIntegrationShare = pgTable(
  'SignatureIntegrationShare',
  {
    id: text()
      .$defaultFn(() => createId())
      .primaryKey()
      .notNull(),
    entityInstanceId: text()
      .notNull()
      .references((): AnyPgColumn => EntityInstance.id, {
        onUpdate: 'cascade',
        onDelete: 'cascade',
      }),
    integrationId: text()
      .notNull()
      .references((): AnyPgColumn => Integration.id, { onUpdate: 'cascade', onDelete: 'cascade' }),
    createdAt: timestamp({ precision: 3 }).defaultNow().notNull(),
  },
  (table) => [
    index('SignatureIntegrationShare_integrationId_idx').using(
      'btree',
      table.integrationId.asc().nullsLast()
    ),
    index('SignatureIntegrationShare_entityInstanceId_idx').using(
      'btree',
      table.entityInstanceId.asc().nullsLast()
    ),
    uniqueIndex('SignatureIntegrationShare_entityInstanceId_integrationId_key').using(
      'btree',
      table.entityInstanceId.asc().nullsLast(),
      table.integrationId.asc().nullsLast()
    ),
  ]
)
