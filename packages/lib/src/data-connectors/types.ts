// packages/lib/src/data-connectors/types.ts
// Canonical engine-side types for Data Connectors (sub-plans 02/03/04).
//
// These are the authoritative TS shapes the sync engine works with. The
// database package (tier 1) cannot import @auxx/lib (tier 3), so it declares
// structurally-compatible placeholders in `data-connector-types.ts`. The DB
// columns are all `jsonb`/`text`, so these richer unions round-trip safely —
// the service layer casts at the read/write boundary.

import type { FieldType } from '@auxx/database/types'
import type { ResourceFieldId } from '@auxx/types/field'
import type { RuntimeConnectionData } from '../connections/resolve-connection-for-runtime'
import type { RateLimitPolicy } from '../connections/transports/types'
import { RateLimitError } from '../errors'
import type { SyncCursor } from '../sync-core/contracts'

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
    /** Non-secret headers sent on every request, under per-stream headers. */
    headers?: Record<string, string>
    /** Rate-limit handling for every request to this endpoint (G3). */
    rateLimit?: RateLimitPolicy
  }
  filters?: Record<string, unknown>
}

/**
 * Steady-mode (incremental) delta config for a generic-REST stream (G2). Declares
 * the timestamp-filter param to inject and the response field to track the max of.
 * Covers `updated_at`-style providers (Shopify/Salesforce/HubSpot/QBO). NOT Stripe —
 * its list endpoints filter on `created` (never changes); Stripe's real incremental
 * path is `/v1/events`, handled separately (Step 8).
 */
export interface StreamIncrementalConfig {
  /** Query param carrying the delta floor, e.g. `updated_at_min` / `since`. */
  sinceParam: string
  /** Record field whose running max becomes the next watermark, e.g. `updated_at`. */
  watermarkField: string
  /** Comparison/format hint. Advisory — `maxWatermark` auto-detects numeric vs ISO. */
  watermarkFormat?: 'iso' | 'unix'
}

/** Per-stream request config for generic-REST streams (jsonb on DataConnectorStream). */
export interface StreamRequestConfig {
  path?: string
  method?: 'GET' | 'POST'
  params?: Record<string, unknown>
  body?: Record<string, unknown>
  headers?: Record<string, string>
  pagination?: PaginationSpec
  /** Steady-phase delta config (absent ⇒ every steady run re-crawls in full). */
  incremental?: StreamIncrementalConfig
}

// ── Stream state / connector output (03 §1) ───────────────────────────────────

/**
 * Durable per-stream sync state (jsonb on `DataConnectorStream.state`). Persisted
 * across runs and checkpointed AFTER every committed slice. The shared sync-core
 * `SyncStateStore` adapter (sync-core/contracts `SyncState`) maps onto this; the
 * legacy single-shot generic-rest fetch path reads `cursor`/`backfillComplete`.
 *
 * This shape MUST stay byte-compatible with the DB mirror
 * `ConnectorStreamState` in `@auxx/database` schema/`data-connector-types.ts` —
 * the DB package (tier 1) can't import this engine type, so the two are
 * hand-synced. See plans/data-connectors/v3/large-dataset-sync-plan.md §8.
 */
export interface ConnectorStreamState {
  /** Engine-managed lifecycle phase (orthogonal to the user's `syncMode`). */
  phase?: 'backfill' | 'steady'
  /** Durable backfill page cursor — structured `SyncCursor`, never lossy (H6);
   *  checkpointed AFTER every committed slice. */
  backfillCursor?: SyncCursor
  /** When the current backfill chain began (ISO 8601). */
  backfillStartedAt?: string
  /** Running total for the progress UI (counts, never a percent). */
  recordsSeen?: number
  /** Steady-phase delta floor; the source returns a monotonic max each slice. */
  watermark?: string
  /** Legacy single-shot incremental cursor (snapshot-first generic-rest path). */
  cursor?: string
  /** Set by a connector's terminal `nextState` when its backfill is exhausted. */
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

/**
 * A resume-point sentinel a connector MAY yield between pages (§4.3 Option A). It
 * carries the cursor a sliced backfill resumes the NEXT page from, so the engine
 * checkpoints at safe boundaries without ever interpreting the connector's
 * pagination. A connector emits one after each page it finishes yielding records
 * for; the absence of `cursor` means "that was the last page" (the source is
 * exhausted). Single-shot consumers (`runDataConnectorSync`, the test-fetch) skip
 * these; the sliced `SyncSource` adapter uses them to bound + checkpoint a slice.
 */
export interface ConnectorCheckpoint {
  /** Discriminant — distinguishes a checkpoint from a {@link ConnectorRecord}. */
  __checkpoint: true
  /** Cursor to resume the NEXT page from; absent ⇒ this was the last page. */
  cursor?: SyncCursor
  /** Max watermark observed through this page (steady/incremental delta floor). */
  watermark?: string
}

/** What a connector `fetch` iterable yields — a record to sink or a resume point. */
export type ConnectorYield = ConnectorRecord | ConnectorCheckpoint

/** Type guard separating a resume-point sentinel from a record to sink. */
export function isConnectorCheckpoint(y: ConnectorYield): y is ConnectorCheckpoint {
  return (y as ConnectorCheckpoint).__checkpoint === true
}

/**
 * Thrown by a connector fetch when the upstream signals a throttle (429/503, or a
 * provider-specific cost throttle) and the transport is configured NOT to sleep on
 * it (`rateLimitOverride.maxRetries = 0`, set by the sliced `SyncSource` — H1). The
 * source maps it to a `partial-retriable` / held-cursor slice outcome and folds
 * `retryAfterMs` into the re-enqueue delay, so a worker NEVER sleeps on a throttle
 * while holding the BullMQ lock. Extends the shared {@link RateLimitError} so any
 * generic `instanceof RateLimitError` handler still recognizes it.
 */
export class ConnectorRateLimitError extends RateLimitError {
  constructor(
    message: string,
    /** Server-hinted wait before retrying, in milliseconds (Retry-After / backoff). */
    public readonly retryAfterMs?: number
  ) {
    super(message, retryAfterMs !== undefined ? Math.ceil(retryAfterMs / 1_000) : undefined)
  }
}

/** A connector fetch result — a stream of records (+ resume checkpoints) plus the next cursor. */
export interface FetchResult {
  records: AsyncIterable<ConnectorYield>
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
    | {
        mode: 'contributing'
        entityKind: string
        /** Target field keys to flag as secondary identity-match keys (e.g. `['email']`). */
        matchFieldKeys?: string[]
      }
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
  /**
   * Per-call override merged onto the endpoint's `rateLimit` policy. The sliced
   * `SyncSource` sets `{ maxRetries: 0 }` so a throttle returns immediately (the
   * connector throws {@link ConnectorRateLimitError}) instead of the transport
   * sleeping under the slice's `maxMs` budget while holding the worker lock (H1).
   * Absent for the single-shot path, which keeps the default retry-and-sleep.
   */
  rateLimitOverride?: Partial<RateLimitPolicy>
}

/**
 * How a source's request is authored — the capability the connect-a-source
 * catalog advertises for an *uninstantiated* source (05c §2).
 *  - 'builder' → expose the generic-rest HTTP request builder (generic-rest +
 *    template instances).
 *  - 'fixed'   → request baked into the connector's code; surface only the
 *    declared `config` schema (app connectors; future closed templates).
 *
 * The detail view itself branches on the persisted `DataConnector.definitionKind`
 * (`'app'` ⇔ fixed), not on this — `requestModel` exists so the catalog can
 * describe sources that have no row yet.
 */
export type ConnectorRequestModel = 'builder' | 'fixed'

/** A connector only fetches + normalizes; it never writes entities. */
export interface DataConnectorDefinition {
  type: string
  schemaVersion: number
  /** Request-authoring surface this connector exposes. Defaults to 'builder'. */
  requestModel?: ConnectorRequestModel
  streams: ConnectorStreamDecl[]
  fetch(args: ConnectorFetchArgs): Promise<FetchResult>
  /** Map a provider delete event onto a (streamKey, externalId). */
  resolveDelete?(event: unknown): { streamKey: string; externalId: string } | null
}

// ── Policy types — identity / merge / link (02) ───────────────────────────────

/** How an identity-match value is canonicalized before comparison. */
export type IdentityNormalize = 'email' | 'phone' | 'domain' | 'none'

/** Per-field write behavior (02 §3). Keyed by target field key. */
export type FieldMergeStrategy =
  | 'overwrite'
  | 'fill_blank'
  | 'connector_owned_only'
  | 'manual_review'
  | 'ignore'

/**
 * One binding entry, stored as an element of the `fieldMappings` ARRAY on a
 * mapping (CALC shape, reused from CALC custom fields). Identity is the stable
 * `id`, NOT the target field — so a binding persists before (or without) a
 * target, and retarget/merge ride along without re-keying. The array gives
 * ordering; nothing keys by it (the runtime iterates; the UI finds by id).
 */
export interface FieldMapping {
  /** Stable entry id (generateId). React key + dialog/patch handle; never reused. */
  id: string
  /**
   * Canonical reference to the target field this binding writes into — a
   * single-segment `VarRef`. Concrete (`${entityDefinitionId}:${fieldId}`) for a
   * bind-to-existing field, or the connection-late-bound `${slug}:@app:${slug}:${key}`
   * form for an app-declared field (resolved at sync time against the connector's
   * connection). `null` = unassigned draft (runtime skips it) or a generic-rest
   * provisioned field awaiting its concrete ref (see {@link FieldMapping.provision}).
   */
  targetFieldRef: ResourceFieldId | null
  expression: string
  sourceFields: Record<string, string>
  /**
   * When present, this bound field is ALSO a secondary identity key. The external
   * id is always the primary key (the DataConnectorItem binding); on first link
   * (before a binding exists) the sink looks for an existing entity whose value of
   * this target field equals the source value and merges into it. Absent = the
   * field is projected only. `normalize` is derived from the target field type at
   * toggle time (email/phone/domain), else 'none'.
   */
  match?: { normalize?: IdentityNormalize }
  /** Per-field write behavior (folded in from the old parallel map). Absent ⇒ 'overwrite'. */
  mergeStrategy?: FieldMergeStrategy
  /**
   * Provisioning hint for a connector-introduced target field (05d). Consumed by
   * `provisionConnectorMappings` to create the field with the declared type/name
   * when the target def is missing it; ignored when the field already exists
   * (e.g. `email`/`name` reused from a system def). Absent on hand-authored UI
   * mappings — those bind to fields that already exist.
   */
  provision?: { name: string; type: FieldType; icon?: string; isHidden?: boolean }
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
