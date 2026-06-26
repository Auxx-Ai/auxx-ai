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
    // Edges to wire in the two-pass (relationship-linking v3 §9.6). Each carries the
    // relationship field id to write on THIS instance (belongs_to side) plus the
    // target's def + upstream id — DEF-KEYED resolution, so build-order stops
    // mattering (the frozen `targetMappingId` pointer is gone). A `null`
    // targetExternalId (and null targetDef) is a CLEAR edge — the FK went empty, so
    // the two-pass nulls the relationship field (clear-on-empty).
    pendingRelations:
      jsonb().$type<
        Array<{
          fieldKey: string
          targetDef: string | null
          targetExternalId: string | null
        }>
      >(),
    // Field keys this connector currently maintains a live relationship edge on
    // (clear-on-empty bookkeeping). A clear fires once on the set→empty transition
    // (the sink drops a clear whose field isn't here), then stays silent. Also the
    // provenance guard: the connector only clears edges it recorded as having set.
    linkedRelations: jsonb().$type<string[]>(),

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
    // DEF-KEYED resolution (relationship-linking v3 §9.10): backs the two-pass
    // resolver's `findItemByDef` + the sink's def-keyed instance reuse-read.
    // NON-unique on purpose — two mappings legitimately bind the same
    // (connector, def, externalId) to one shared `entityInstanceId`.
    index('DataConnectorItem_dataConnectorId_entityDefinitionId_externalId_idx').using(
      'btree',
      table.dataConnectorId.asc().nullsLast(),
      table.entityDefinitionId.asc().nullsLast(),
      table.externalId.asc().nullsLast()
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
