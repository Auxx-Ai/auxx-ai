// packages/database/src/db/schema/data-connector-stream.ts
// Drizzle table: DataConnectorStream — one fetch = one source schema. Owns the
// request config, source schema (Layer A), and provenance — but no target
// binding; a fetch fans out to N target defs via DataConnectorMapping.
// See plans/data-connectors/.

import { createId } from '@paralleldrive/cuid2'
import { type AnyPgColumn, boolean, jsonb, pgTable, text, timestamp, uniqueIndex } from './_shared'
import { DataConnector } from './data-connector'
import type { ConnectorStreamState, StreamRequestConfig } from './data-connector-types'
import { Organization } from './organization'

export const DataConnectorStream = pgTable(
  'DataConnectorStream',
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

    // Provider resource id / endpoint key, e.g. 'order'. Nullable: a stream is
    // created blank (no name) and named inline later; an unnamed stream is never
    // fetched (the sync loader skips null-key streams). The unique index treats
    // NULLs as distinct, so multiple unnamed drafts under one connector are fine.
    streamKey: text(),
    enabled: boolean().default(true).notNull(),

    // The expected shape of one fetched record (Layer A) — JSON Schema, seeded by
    // catalog declaration / sample-fetch inference / manual edit. Drives field-pickers.
    sourceSchema: jsonb().$type<Record<string, unknown>>(),
    // Where that source shape came from. Drives re-provisioning rules. Decoupled
    // from the target (owned/contributing is per-mapping) — so no `existing` tag here.
    schemaSource: text().default('catalog').notNull(), // 'catalog' | 'inferred' | 'manual'

    syncMode: text().default('snapshot').notNull(), // 'snapshot' | 'incremental' | 'webhook'

    // Per-stream request config (generic-rest only).
    requestConfig: jsonb().$type<StreamRequestConfig>(),

    // Per-stream incremental cursor, persisted across runs.
    state: jsonb().$type<ConnectorStreamState>().default({}).notNull(),

    // Schema-inference provenance, if a sample run shaped this stream.
    sampleRunId: text(),

    createdAt: timestamp({ precision: 3 }).defaultNow().notNull(),
    updatedAt: timestamp({ precision: 3 })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex('DataConnectorStream_dataConnectorId_streamKey_key').using(
      'btree',
      table.dataConnectorId.asc().nullsLast(),
      table.streamKey.asc().nullsLast()
    ),
  ]
)

/** Selected DataConnectorStream entity type */
export type DataConnectorStreamEntity = typeof DataConnectorStream.$inferSelect
