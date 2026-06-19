// packages/database/src/db/schema/data-connector-mapping.ts
// Drizzle table: DataConnectorMapping — the fan-out. One row per target def a
// fetch lands in. Each carries its own target, identity, merge, field mapping,
// and link mode. Relationships are parent→child edges between mappings, so the
// whole fan-out (and the two-pass) is derivable from these rows.
// See plans/data-connectors/.

import { createId } from '@paralleldrive/cuid2'
import { type AnyPgColumn, index, jsonb, pgTable, text, timestamp } from './_shared'
import { DataConnectorStream } from './data-connector-stream'
import type { FieldMapping, FieldMergeStrategy } from './data-connector-types'
import { EntityDefinition } from './entity-definition'
import { Organization } from './organization'

export const DataConnectorMapping = pgTable(
  'DataConnectorMapping',
  {
    id: text()
      .$defaultFn(() => createId())
      .primaryKey()
      .notNull(),
    dataConnectorStreamId: text()
      .notNull()
      .references((): AnyPgColumn => DataConnectorStream.id, {
        onUpdate: 'cascade',
        onDelete: 'cascade',
      }),
    organizationId: text()
      .notNull()
      .references((): AnyPgColumn => Organization.id, { onUpdate: 'cascade', onDelete: 'cascade' }),

    // Subtree of the source schema this mapping consumes. '' = root record, else a
    // JSON path (e.g. 'customer', 'line_items[]').
    rootPath: text().default('').notNull(),

    // 'upsert'  → project the record (create/update via the sink).
    // 'reference' → resolve + wire the relationship only; no field writes, no identity-create.
    linkMode: text().default('upsert').notNull(), // 'upsert' | 'reference'

    // Relationship wiring — this mapping's edge to its parent. Root mapping has both null.
    // Self-FK: parent mapping in the same fan-out tree.
    parentMappingId: text().references((): AnyPgColumn => DataConnectorMapping.id, {
      onUpdate: 'cascade',
      onDelete: 'cascade',
    }),
    relationshipFieldKey: text(), // field on the PARENT def that holds the edge

    // Target binding. 'owned' → connector provisioned the def; 'contributing' →
    // writes into a pre-existing def (incl. system contact/ticket). For 'reference'
    // the def is the one whose records we resolve against (e.g. Product).
    targetMode: text().notNull(), // 'owned' | 'contributing'
    // Nullable: a stream is seeded with a root mapping that has no target yet —
    // the user picks the def in the UI. The runtime skips untargeted mappings.
    entityDefinitionId: text().references((): AnyPgColumn => EntityDefinition.id, {
      onUpdate: 'cascade',
      onDelete: 'restrict',
    }),

    // targetFieldKey → mapping. Each mapping is the CALC shape; a one-click row is
    // the degenerate single-token `{source}` expression. Empty for 'reference'.
    // A field flagged `match` is also a secondary identity key — identity is fully
    // derived from these flags; the external id is always the primary key.
    fieldMappings: jsonb().$type<Record<string, FieldMapping>>().default({}).notNull(),
    // Per-field write behavior. Keyed by target field key.
    mergeStrategies: jsonb().$type<Record<string, FieldMergeStrategy>>().default({}).notNull(),
    orphanBehavior: text().default('ignore').notNull(), // 'archive' | 'mark_deleted' | 'ignore'

    createdAt: timestamp({ precision: 3 }).defaultNow().notNull(),
    updatedAt: timestamp({ precision: 3 })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index('DataConnectorMapping_dataConnectorStreamId_idx').using(
      'btree',
      table.dataConnectorStreamId.asc().nullsLast()
    ),
    index('DataConnectorMapping_entityDefinitionId_idx').using(
      'btree',
      table.entityDefinitionId.asc().nullsLast()
    ),
    index('DataConnectorMapping_parentMappingId_idx').using(
      'btree',
      table.parentMappingId.asc().nullsLast()
    ),
  ]
)

/** Selected DataConnectorMapping entity type */
export type DataConnectorMappingEntity = typeof DataConnectorMapping.$inferSelect
