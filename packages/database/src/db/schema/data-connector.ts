// packages/database/src/db/schema/data-connector.ts
// Drizzle table: DataConnector — the org-owned connector instance: where data
// comes from, the borrowed credential, lifecycle. See plans/data-connectors/.

import { createId } from '@paralleldrive/cuid2'
import {
  type AnyPgColumn,
  dataConnectorStatus,
  dataConnectorSyncBehavior,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
} from './_shared'
import { AppInstallation } from './app-installation'
import { Credential } from './credential'
import type {
  DataConnectorConfig,
  DataConnectorType,
  ScheduledTriggerConfig,
} from './data-connector-types'
import { Organization } from './organization'
import { User } from './user'

export const DataConnector = pgTable(
  'DataConnector',
  {
    id: text()
      .$defaultFn(() => createId())
      .primaryKey()
      .notNull(),
    organizationId: text()
      .notNull()
      .references((): AnyPgColumn => Organization.id, { onUpdate: 'cascade', onDelete: 'cascade' }),
    createdById: text().references((): AnyPgColumn => User.id, {
      onUpdate: 'cascade',
      onDelete: 'set null',
    }),

    // `text`, NOT a pgEnum — new connector types ship without an enum migration
    // (same rationale as KnowledgeSource.type). Typed in code as DataConnectorType.
    type: text().$type<DataConnectorType>().notNull(), // 'generic-rest' | `app:${slug}` | …

    // Definition source — lets app + built-in connectors share one engine.
    // 'builtin' resolves from the platform registry; 'app' from AppDeployment.catalog.
    definitionKind: text().notNull().default('builtin'), // 'builtin' | 'app'

    // Provenance for a connector seeded from a first-party connector template
    // (05c). Stamped at create; the connector is fully user-owned thereafter
    // (seed-and-forget). Drives the list badge + source icon. Null = hand-built.
    templateId: text(),

    name: text().notNull(),

    // The connection this connector borrows. Usually minted by an app's OAuth flow.
    credentialId: text().references((): AnyPgColumn => Credential.id, {
      onUpdate: 'cascade',
      onDelete: 'set null',
    }),
    // If the credential came from an installed app, remember it (for refresh + lifecycle).
    appInstallationId: text().references((): AnyPgColumn => AppInstallation.id, {
      onUpdate: 'cascade',
      onDelete: 'set null',
    }),

    // Connector-level config: filters, generic-REST endpoint, etc. Per-stream config
    // lives on DataConnectorStream, not here.
    config: jsonb().$type<DataConnectorConfig>().default({}).notNull(),

    // Lifecycle
    syncBehavior: dataConnectorSyncBehavior().default('manual').notNull(),
    scheduleConfig: jsonb().$type<ScheduledTriggerConfig>(),
    status: dataConnectorStatus().default('pending').notNull(),
    //      'pending' | 'provisioning' | 'syncing' | 'live' | 'error' | 'paused'

    // Connector-level cursor/state (per-stream cursors live on DataConnectorStream).
    state: jsonb().$type<Record<string, unknown>>().default({}).notNull(),

    // Hash of the provisioned schema — detect drift, re-provision only the delta.
    schemaHash: text(),

    lastSyncedAt: timestamp({ precision: 3 }),
    lastJobId: text(),
    itemCount: integer().default(0).notNull(),
    error: text(),

    createdAt: timestamp({ precision: 3 }).defaultNow().notNull(),
    updatedAt: timestamp({ precision: 3 })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index('DataConnector_organizationId_idx').using(
      'btree',
      table.organizationId.asc().nullsLast()
    ),
    // No (org, type) uniqueness: template instances all share `type:'generic-rest'`
    // (05c), so an org can own a blank REST source + several template-seeded ones
    // at once. Many connectors may also contribute to one def (e.g. `contact`).
  ]
)

/** Selected DataConnector entity type */
export type DataConnectorEntity = typeof DataConnector.$inferSelect
