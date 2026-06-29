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
import type { ActionInputHint } from '../tools/types.js'

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

/**
 * Per-stream cursor an app returns from one page and reads back on the next. The
 * platform persists + restores it verbatim across runs and slices — the app never
 * sees the engine's internal cursor encoding.
 */
export interface ConnectorStreamState {
  /**
   * Opaque resume token. Any JSON-serializable value — a string token, or a
   * structured cursor like `{ after: 'x', page: 3 }`. Return it from one page to
   * fetch the next; the platform hands it straight back on `state.cursor`.
   */
  cursor?: unknown
  /** Steady-phase delta floor (watermark); return the max seen so the next steady run resumes from it. */
  updatedSince?: string
  /** Set `true` on the last page — the platform flips the stream to steady (incremental) or finishes the snapshot. */
  backfillComplete?: boolean
  [key: string]: unknown
}

/**
 * A connector fetch result — ONE page of records plus the cursor for the next
 * page. The platform re-invokes `execute` with `state.cursor = nextState.cursor`
 * until `nextState.backfillComplete` (or no cursor), so each `execute` call is a
 * single page; pagination is the loop the platform drives, not one the app does.
 */
export interface ConnectorFetchResult {
  /** Source-shaped records for this page. May be an array or an async iterable. */
  records: ConnectorRecord[] | AsyncIterable<ConnectorRecord>
  /** Cursor + watermark to persist; the next page / incremental run resumes from here. */
  nextState: ConnectorStreamState
  /**
   * Upstream throttle signal. When the source rate-limits a page (HTTP 429, or a
   * provider-specific 403/cost throttle), **return** this instead of throwing or
   * sleeping — the platform pauses the chain and re-enqueues the next slice after
   * `retryAfterMs`, so the connector never burns its sandbox budget waiting.
   *
   * Return the cursor you want to resume from in `nextState.cursor` alongside this
   * (typically the SAME page that was throttled). Records already collected this page
   * are still sinked; the throttled page is retried after the wait.
   */
  rateLimited?: {
    /** Server-hinted wait before the next attempt, in ms (`Retry-After` / reset header). */
    retryAfterMs?: number
  }
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
        /**
         * Non-identity field bindings the author pre-declares so a contributing
         * stream lands closer to `ready` — e.g. `{ sourceFieldKey: 'first_name',
         * targetKey: 'first_name' }` binds the source field to the contact's
         * first-name attribute. `targetKey` resolves against the target def's
         * `systemAttribute` / field name; unresolved bindings are dropped (the
         * mapping stays a setup draft). The external id is never bound here — it
         * rides `ConnectorRecord.externalId`.
         */
        fieldBindings?: { sourceFieldKey: string; targetKey: string }[]
      }
}

/** One stream (fetch) declaration. */
export interface ConnectorStreamDecl {
  /** Provider resource id / endpoint key, e.g. `'order'`. */
  key: string
  /** Field-key that holds the record's display name. */
  displayFieldKey: string
  /**
   * How the platform schedules this stream. `incremental` runs the backfill once
   * then steady `updatedSince`-floored delta runs; `snapshot` (default) re-crawls
   * in full every run. Drives the `mode` handed to `execute`.
   */
  syncMode?: 'snapshot' | 'incremental'
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
  /** The persisted cursor for this stream (the platform's last `nextState`). */
  state: ConnectorStreamState
  /**
   * The borrowed connection (decrypted), or null when none is bound. This is the
   * connector's ONLY connection handle — resolve auth from here, not from a
   * tool/agent ambient `getConnection()` helper.
   */
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
  /**
   * Per-config-field presentation overrides keyed by config field, reusing the
   * quick-action `ActionInputHint` shape. A `dynamic-select` hint renders the
   * field as a live dropdown whose options come from an app tool
   * (`optionsFrom`) invoked through the connector's own connection — e.g. a
   * repo picker backed by a `list_repos` tool. `optionsFrom` must name a tool in
   * the same app. Absent fields render from the JSON Schema as usual.
   */
  configOptions?: Record<string, ActionInputHint>
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
