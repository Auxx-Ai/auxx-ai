// packages/sdk/src/root/data-connectors/types.ts

/**
 * Author surface types for app-declared Data Connectors.
 *
 * A Data Connector is how an app declares *where structured records come from
 * and how they map onto the platform's entity model*. The app only **fetches +
 * normalizes to a source schema** — it never writes entities, never sees target
 * defs, and never gets DB access. The platform validates the source-shaped
 * records against the declared stream schema, then maps + sinks them (the
 * mapping layer + entity sink are platform-side).
 *
 * The SDK is published as a standalone npm package, so these types cannot import
 * from `@auxx/lib` / `@auxx/database`. They MUST stay structurally compatible
 * with the engine-side contract in
 * `packages/lib/src/data-connectors/types.ts` and the catalog projection in
 * `packages/database/src/db/schema/app-deployment.ts` (CatalogDataConnector).
 *
 * See plans/data-connectors/claude/03-connectors-and-sources.md §4.
 */

import type { z } from 'zod/v4'
import type { FieldType } from '../fields/field-types.js'

/**
 * One normalized, SOURCE-shaped record produced by a connector's `execute`. Not
 * pre-mapped to target fields — the platform mapping layer maps + fans out.
 * `fields` is keyed by the stream's source field paths (e.g. `'customer.email'`,
 * `'line_items[].sku'`).
 */
export interface ConnectorRecord {
  /** Which stream (fetch) this record belongs to. */
  streamKey: string
  /** Provider stable id (→ DataConnectorItem.externalId). */
  externalId: string
  /** Denormalized display name for the landed entity instance. */
  displayName: string
  /** Raw source-shaped values keyed by source path (matches the stream fields). */
  fields: Record<string, unknown>
  /** Tombstone — explicit delete signal. */
  deleted?: boolean
  /** Optional content hash; the platform computes a sorted-key hash if absent. */
  contentHash?: string
}

/** Per-stream incremental cursor, persisted across runs by the platform. */
export interface ConnectorStreamState {
  cursor?: string
  updatedSince?: string
  backfillComplete?: boolean
  [key: string]: unknown
}

/** A connector fetch result — a batch (or stream) of records plus the next cursor. */
export interface ConnectorFetchResult {
  /** Source-shaped records for this batch. May be an array or an async iterable. */
  records: ConnectorRecord[] | AsyncIterable<ConnectorRecord>
  /** Cursor to persist; the next incremental run resumes from here. */
  nextState: ConnectorStreamState
}

/** Field capabilities surfaced on a declared source field. */
export interface ConnectorFieldCapabilities {
  /** Provision the field hidden (synced but not shown in the CRM grid). */
  hidden?: boolean
  /** Usable in Find-node filters. */
  filterable?: boolean
}

/**
 * One source field declaration (Layer A — the shape of what a fetch returns).
 * The map key is the stable `fieldKey`; `sourcePath` is the provider JSON path.
 */
export interface ConnectorFieldDecl {
  /** Provider JSON path, e.g. `'total_price'` / `'customer.email'` / `'line_items[].sku'`. */
  sourcePath: string
  type: FieldType
  name: string
  /** Flag PII — surfaced + default-excluded in the mapping UI. */
  pii?: boolean
  capabilities?: ConnectorFieldCapabilities
}

/** Minimal entity declaration for an owned-mode default mapping. */
export interface ConnectorEntityDecl {
  apiSlug: string
  singular: string
  plural: string
  primaryDisplayField?: string
}

/**
 * A recommended fan-out mapping the connector suggests (05 §4). The user
 * confirms/overrides at setup; branches not declared here are inferred from the
 * schema tree.
 */
export interface ConnectorDefaultMapping {
  /** `''` = root record, else a subtree path (`'customer'` / `'line_items[]'`). */
  rootPath: string
  /** Default: `upsert` for embedded data, `reference` for id-only branches. */
  linkMode?: 'upsert' | 'reference'
  /** Edge on the PARENT def that holds this relationship. */
  relationshipFieldKey?: string
  target:
    | { mode: 'owned'; entity: ConnectorEntityDecl }
    | {
        mode: 'contributing'
        entityKind: string
        /**
         * Target field keys to flag as secondary identity-match keys (e.g.
         * `['email']`). The external id is always the primary key; these merge an
         * incoming record into an existing entity on first link.
         */
        matchFieldKeys?: string[]
      }
}

/** One stream (fetch) declaration. */
export interface ConnectorStreamDecl {
  /** Provider resource id / endpoint key, e.g. `'order'`. */
  key: string
  /** Field-key that holds the record's display name. */
  displayFieldKey: string
  /** Source field declarations (Layer A) keyed by stable `fieldKey`. */
  fields: Record<string, ConnectorFieldDecl>
  /** Recommended fan-out — root + embedded branches + id-only refs. */
  defaultMappings?: ConnectorDefaultMapping[]
  /** Canonical sample → schema preview + dry-run before the first live fetch. */
  exampleRecord?: Record<string, unknown>
}

/**
 * Arguments the platform hands to a connector's `execute` for one stream fetch.
 * The app receives the decrypted connection (the OAuth credential it minted) but
 * NEVER target defs, mappings, or entity write access.
 */
export interface ConnectorExecuteArgs<TConfig = Record<string, unknown>> {
  /** Which stream to fetch. */
  streamKey: string
  /** `snapshot` (full) or `incremental` (delta from the cursor). */
  mode: 'snapshot' | 'incremental'
  /** The persisted cursor for this stream. */
  state: ConnectorStreamState
  /** The borrowed connection (decrypted), or null when none is bound. */
  connection: ConnectorConnection | null
  /** The connector's validated config (from the `config` zod schema). */
  config: TConfig
}

/**
 * The decrypted connection handed to `execute`. Same shape the polling-trigger /
 * tool runtime receives — `value` is the access token, `fields` carries
 * multi-field secrets, `metadata` carries non-sensitive connection variables
 * (shop domain, region, …).
 */
export interface ConnectorConnection {
  value: string
  fields?: Record<string, string>
  metadata?: Record<string, unknown>
}

/** The server handler an app supplies to fetch + yield source-shaped records. */
export type ConnectorExecute<TConfig = Record<string, unknown>> = (
  args: ConnectorExecuteArgs<TConfig>
) => Promise<ConnectorFetchResult>

/**
 * A full app-declared data connector. Passed to `defineDataConnector`. `config`
 * is a zod schema validated at setup; `streams` declare the source schemas +
 * recommended mappings; `execute` is the server handler.
 */
export interface DataConnectorDefinition<TConfigSchema extends z.ZodTypeAny = z.ZodTypeAny> {
  /** Stable connector id, e.g. `'shopify.core'`. */
  id: string
  /** Human label shown in the connector picker. */
  label: string
  /** Whether the connector needs the app's OAuth connection to fetch. */
  requiresConnection: boolean
  /** Connector-level config schema (filters, toggles). */
  config: TConfigSchema
  /** Stream (fetch) declarations. */
  streams: ConnectorStreamDecl[]
  /** Optional icon key for the connector card. */
  iconKey?: string
  /**
   * Server handler — fetches from the provider and yields source-shaped
   * `ConnectorRecord` batches. Lives in a `.connector.server.ts(x)` module so
   * the catalog extractor can stub it.
   */
  execute: ConnectorExecute<z.output<TConfigSchema>>
}
