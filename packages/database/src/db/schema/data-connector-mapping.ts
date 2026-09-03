// packages/database/src/db/schema/data-connector-mapping.ts
// Drizzle table: DataConnectorMapping — the fan-out. One row per target def a
// fetch lands in. Each carries its own target, identity, merge, field mapping,
// and link mode. Relationships are parent→child edges between mappings, so the
// whole fan-out (and the two-pass) is derivable from these rows.
// See plans/data-connectors/.

import { createId } from '@paralleldrive/cuid2'
import { type AnyPgColumn, index, jsonb, pgTable, text, timestamp } from './_shared'
import { DataConnectorStream } from './data-connector-stream'
import type { FieldMapping } from './data-connector-types'
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
    // The drilled relationship edge to the parent, stored as a serialized
    // `FieldReference` (`fieldRefToKey`) — a `ResourceFieldId` (`order:customer`) for
    // a single-drill edge, or a `::`-joined `FieldPath` for a deeper drill
    // (relationship-linking v3 §9.5). Self-scoping (parent def = `getRootEntityId`);
    // the related def is the next path segment. Was a bare field key; the runtime
    // resolves the target def DEF-KEYED, so the frozen `referenceTargetMappingId`
    // pointer that lived here is gone.
    relationshipFieldKey: text(),

    // Target binding. 'owned' → connector provisioned the def; 'contributing' →
    // writes into a pre-existing def (incl. system contact/ticket). For 'reference'
    // the def is the one whose records we resolve against (e.g. Product).
    targetMode: text().notNull(), // 'owned' | 'contributing'
    // Nullable: a mapping can exist before a target def is picked (the user picks
    // it in the UI). The runtime skips untargeted mappings.
    // `cascade`: deleting a target def removes the mappings that point at it (and,
    // via the `parentMappingId` self-cascade, their descendant mappings in the same
    // stream). The entity-def delete path (`deleteEntityDefinitionDeep`) pairs this
    // with a connector-integrity sweep that tears down streams left without a root
    // mapping — see plans/entitydefinition/delete-entity-definition-plan.md §3.3.
    entityDefinitionId: text().references((): AnyPgColumn => EntityDefinition.id, {
      onUpdate: 'cascade',
      onDelete: 'cascade',
    }),

    // Array of binding entries. Each carries a stable `id` (identity) + a nullable
    // `targetFieldRef` (a canonical `ResourceFieldId`; a null entry is an unassigned
    // draft / provisioned field awaiting its ref, both skipped by the runtime), the
    // CALC shape, its `mergeStrategy`, and `match`/`provision` flags. An array (not
    // a Record) so identity is independent of the target and nothing keys by it;
    // a one-click row is the degenerate single-token `{source}` expression. Empty
    // for 'reference'. A field flagged `match` is also a secondary identity key —
    // the external id is always the primary key.
    fieldMappings: jsonb().$type<FieldMapping[]>().default([]).notNull(),

    orphanBehavior: text().default('ignore').notNull(), // 'archive' | 'mark_deleted' | 'ignore'

    /** Hash of the shape the app catalog seeder wrote (task 41 D3); null when the row was
     *  created by hand or before this column existed. */
    catalogHash: text(),

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
