// packages/lib/src/data-connectors/types.ts
// Canonical engine-side types for Data Connectors (sub-plans 02/03/04).
//
// These are the authoritative TS shapes the sync engine works with. The
// database package (tier 1) cannot import @auxx/lib (tier 3), so it declares
// structurally-compatible placeholders in `data-connector-types.ts`. The DB
// columns are all `jsonb`/`text`, so these richer unions round-trip safely —
// the service layer casts at the read/write boundary.

import type { FieldType } from '@auxx/database/types'
import type { RuntimeConnectionData } from '../connections/resolve-connection-for-runtime'

// ── Connector-level config (jsonb on DataConnector) ───────────────────────────

/** Pagination contract for a generic-REST endpoint. */
export interface PaginationSpec {
  kind: 'cursor' | 'page' | 'offset' | 'link-header' | 'none'
  /** Where the next cursor/page token lives in the response. */
  cursorPath?: string
  /** Query/body param name carrying the cursor/page token. */
  cursorParam?: string
  pageParam?: string
  limitParam?: string
  pageSize?: number
}

/**
 * Connector-level config (jsonb on DataConnector). Generic-REST endpoint +
 * global filters only — per-stream config lives on DataConnectorStream.
 */
export interface DataConnectorConfig {
  endpoint?: {
    baseUrl: string
    auth?: 'credential' | 'none'
    pagination?: PaginationSpec
  }
  filters?: Record<string, unknown>
}

/** Per-stream request config for generic-REST streams (jsonb on DataConnectorStream). */
export interface StreamRequestConfig {
  path?: string
  method?: 'GET' | 'POST'
  params?: Record<string, unknown>
  body?: Record<string, unknown>
  headers?: Record<string, string>
  pagination?: PaginationSpec
}

// ── Stream state / connector output (03 §1) ───────────────────────────────────

/** Per-stream incremental cursor, persisted across runs. */
export interface ConnectorStreamState {
  cursor?: string
  updatedSince?: string
  backfillComplete?: boolean
  [key: string]: unknown
}

/**
 * One raw payload produced by a connector fetch. `fields` is the connector's
 * actual output — the whole HTTP response for generic-rest (so the source schema
 * mirrors what a test-fetch returns), or a per-record object for connectors that
 * pre-shape. The mapping layer (04 §1) selects records out of it via the root
 * mapping's `rootPath` and fans out; it never pre-maps to target fields.
 */
export interface ConnectorRecord {
  streamKey: string
  /**
   * Raw source-shaped payload (matches the stream sourceSchema). May be an array
   * (a collection response) or an object — the root mapping's `rootPath` picks
   * the record subtree(s) within it.
   */
  fields: unknown
  /**
   * Optional connector-provided id hint, used only for a whole-record (`rootPath
   * ''`) mapping the subtree can't self-identify. Fan-out + nested mappings
   * derive their own external id from the subtree.
   */
  externalId?: string
  /** Optional connector-provided display name hint (same fallback rule as `externalId`). */
  displayName?: string
  /** Tombstone — explicit delete signal. */
  deleted?: boolean
  /** Optional; the sink computes a sorted-key hash if absent. */
  contentHash?: string
}

/** A connector fetch result — a stream of records plus the next cursor. */
export interface FetchResult {
  records: AsyncIterable<ConnectorRecord>
  nextState: ConnectorStreamState
}

// ── Source schema declarations (03 §1) ────────────────────────────────────────

/** Field capabilities surfaced on a declared source field. */
export interface ConnectorFieldCapabilities {
  hidden?: boolean
  filterable?: boolean
}

/** One source field declaration (Layer A — the shape of what a fetch returns). */
export interface ConnectorFieldDecl {
  fieldKey: string
  /** Provider JSON path, e.g. 'total_price' / 'customer.email'. */
  sourcePath: string
  type: FieldType
  name: string
  /** Flag PII — surfaced + default-excluded in the mapping UI. */
  pii?: boolean
  capabilities?: ConnectorFieldCapabilities
}

/** A recommended fan-out mapping the connector suggests (05 §4). User confirms at setup. */
export interface ConnectorDefaultMapping {
  /** '' = root, else 'customer' / 'line_items[]'. */
  rootPath: string
  linkMode?: 'upsert' | 'reference'
  /** Edge on the PARENT def. */
  relationshipFieldKey?: string
  target:
    | { mode: 'owned'; entity: ConnectorEntityDecl }
    | { mode: 'contributing'; entityKind: string; identity: IdentityStrategy }
}

/** Minimal entity declaration for an owned-mode default mapping. */
export interface ConnectorEntityDecl {
  apiSlug: string
  singular: string
  plural: string
  primaryDisplayField?: string
}

/** One stream (fetch) declaration. */
export interface ConnectorStreamDecl {
  key: string
  /** Source field declarations (Layer A). */
  fields: Record<string, ConnectorFieldDecl>
  displayFieldKey: string
  defaultMappings?: ConnectorDefaultMapping[]
  /** Canonical sample → schema preview + dry-run before live call. */
  exampleRecord?: Record<string, unknown>
}

// ── The connector contract (03 §1) ────────────────────────────────────────────

/** Decrypted credential handed to a connector's fetch. Shape is provider-defined. */
export type DecryptedCredential = Record<string, unknown>

/** Arguments passed to a connector fetch. */
export interface ConnectorFetchArgs {
  streamKey: string
  mode: 'snapshot' | 'incremental'
  state: ConnectorStreamState
  /**
   * The resolved runtime connection bound to this connector — the unified
   * resolver reveals + lazily refreshes it and carries the definition's
   * `authApply` spec, so the connector applies auth via `applyAuth` instead of
   * hand-rolling headers. `null` when the connector binds no credential.
   */
  credential: RuntimeConnectionData | null
  config: DataConnectorConfig
  /** Per-stream request config (generic-rest). */
  requestConfig?: StreamRequestConfig
}

/** A connector only fetches + normalizes; it never writes entities. */
export interface DataConnectorDefinition {
  type: string
  schemaVersion: number
  streams: ConnectorStreamDecl[]
  fetch(args: ConnectorFetchArgs): Promise<FetchResult>
  /** Map a provider delete event onto a (streamKey, externalId). */
  resolveDelete?(event: unknown): { streamKey: string; externalId: string } | null
}

// ── Policy types — identity / merge / link (02) ───────────────────────────────

/**
 * How an incoming upstream record is matched to an existing entity record.
 * Stored on DataConnectorMapping.identityStrategy (jsonb). `matchField`/
 * `composite` match a SOURCE field's value against a TARGET field on the entity:
 *  - `connectorFieldKey` — a subtree-relative source path (like `sourceFields`),
 *    read straight from the source record.
 *  - `targetFieldId` — the entity field whose value must equal it (often an
 *    app-`defineField`'d field, e.g. `email`).
 */
export type IdentityStrategy =
  | { kind: 'connectorExternalId' }
  | {
      kind: 'matchField'
      connectorFieldKey: string
      targetFieldId: string
      normalize?: 'email' | 'phone' | 'domain' | 'none'
    }
  | {
      kind: 'composite'
      rules: Array<{
        connectorFieldKey: string
        targetFieldId: string
        normalize?: 'email' | 'phone' | 'domain' | 'none'
      }>
    }
  | { kind: 'manualReview' }

/** Per-field write behavior (02 §3). Keyed by target field key. */
export type FieldMergeStrategy =
  | 'overwrite'
  | 'fill_blank'
  | 'connector_owned_only'
  | 'manual_review'
  | 'ignore'

/** A single target-field mapping (CALC shape, reused from CALC custom fields). */
export interface FieldMapping {
  expression: string
  sourceFields: Record<string, string>
}

export type LinkMode = 'upsert' | 'reference'
export type TargetMode = 'owned' | 'contributing'
export type SyncMode = 'snapshot' | 'incremental' | 'webhook'
export type OrphanBehavior = 'archive' | 'mark_deleted' | 'ignore'

// ── Scheduled-trigger config (jsonb on DataConnector) ─────────────────────────

export interface ScheduledTriggerConfig {
  triggerInterval: 'minutes' | 'hours' | 'days' | 'weeks' | 'custom'
  timeBetweenTriggers: {
    minutes?: number | string
    hours?: number | string
    days?: number | string
    weeks?: number | string
    isConstant?: boolean
  }
  customCron?: string
  timezone?: string
}

/** Connector type union — built-in ids plus `app:${slug}`. */
export type DataConnectorType = 'generic-rest' | 'fixture' | `app:${string}`
