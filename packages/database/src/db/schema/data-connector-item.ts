// packages/database/src/db/schema/data-connector-item.ts
// Drizzle table: DataConnectorItem — the durable upstream↔instance binding plus
// sync bookkeeping. One row per (mapping, synced upstream record). Keyed by
// mapping, not stream, since one fetch fans out to multiple defs.
// See plans/data-connectors/.

import { createId } from '@paralleldrive/cuid2'
import { type AnyPgColumn, index, jsonb, pgTable, text, timestamp, uniqueIndex } from './_shared'
import { DataConnector } from './data-connector'
import { DataConnectorMapping } from './data-connector-mapping'
import { EntityDefinition } from './entity-definition'
import { EntityInstance } from './entity-instance'
import { Organization } from './organization'

export const DataConnectorItem = pgTable(
  'DataConnectorItem',
  {
    id: text()
      .$defaultFn(() => createId())
      .primaryKey()
      .notNull(),
    dataConnectorId: text()
      .notNull()
      .references((): AnyPgColumn => DataConnector.id, {
        onUpdate: 'cascade',
        onDelete: 'cascade',
      }),
    organizationId: text()
      .notNull()
      .references((): AnyPgColumn => Organization.id, { onUpdate: 'cascade', onDelete: 'cascade' }),

    mappingId: text()
      .notNull()
      .references((): AnyPgColumn => DataConnectorMapping.id, {
        onUpdate: 'cascade',
        onDelete: 'cascade',
      }),
    externalId: text().notNull(), // upstream stable id

    entityDefinitionId: text()
      .notNull()
      .references((): AnyPgColumn => EntityDefinition.id, {
        onUpdate: 'cascade',
        onDelete: 'cascade',
      }),
    entityInstanceId: text().references((): AnyPgColumn => EntityInstance.id, {
      onUpdate: 'cascade',
      onDelete: 'set null',
    }), // null until first bind

    contentHash: text(), // sorted-key hash → skip-unchanged
    // Which target field keys this connector writes for this record (per-field
    // ownership on a shared/contributing record). Read-only enforcement itself is
    // the CustomField capability (isUpdatable=false), not a frozen-set here.
    managedFields: jsonb().$type<string[]>().default([]).notNull(),
    // Edges to wire in the two-pass: the related record's mapping + upstream id.
    pendingRelations:
      jsonb().$type<
        Array<{ fieldKey: string; targetMappingId: string; targetExternalId: string }>
      >(),

    upstreamUpdatedAt: timestamp({ precision: 3 }),
    lastSeenRunId: text(), // orphan diff: not seen this run ⇒ candidate
    lastSyncedAt: timestamp({ precision: 3 }),
    archivedAt: timestamp({ precision: 3, withTimezone: true }),
    error: text(),

    createdAt: timestamp({ precision: 3 }).defaultNow().notNull(),
  },
  (table) => [
    // Authoritative identity — the steady-state exact match, per mapping.
    uniqueIndex('DataConnectorItem_dataConnectorId_mappingId_externalId_key').using(
      'btree',
      table.dataConnectorId.asc().nullsLast(),
      table.mappingId.asc().nullsLast(),
      table.externalId.asc().nullsLast()
    ),
    index('DataConnectorItem_entityInstanceId_idx').using(
      'btree',
      table.entityInstanceId.asc().nullsLast()
    ),
    // Orphan reconciliation diff (owned + snapshot): rows of this mapping not
    // stamped with the run.
    index('DataConnectorItem_dataConnectorId_mappingId_lastSeenRunId_idx').using(
      'btree',
      table.dataConnectorId.asc().nullsLast(),
      table.mappingId.asc().nullsLast(),
      table.lastSeenRunId.asc().nullsLast()
    ),
  ]
)

/** Selected DataConnectorItem entity type */
export type DataConnectorItemEntity = typeof DataConnectorItem.$inferSelect
