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
// Type-only (erased at runtime) — no import cycle despite async-export importing back.
import type { AsyncExportCapability } from './async-export/types'

// ── Connector-level config (jsonb on DataConnector) ───────────────────────────

/** Pagination contract for a generic-REST endpoint. */
export interface PaginationSpec {
  kind: 'cursor' | 'page' | 'offset' | 'link-header' | 'next-url' | 'none'
  /** Query/body param name carrying the cursor/page token. */
  cursorParam?: string
  /** Where the next cursor/page token lives in the response (cursor-in-body). */
  cursorPath?: string
  /**
   * Where the next cursor comes from. `'response'` (default) reads {@link cursorPath};
   * `'lastRecord'` derives it from the last record on the page (Stripe `starting_after`).
   */
  cursorFrom?: 'response' | 'lastRecord'
  /** With `cursorFrom: 'lastRecord'`: which field of the last record is the cursor (Stripe: `id`). */
  cursorRecordField?: string
  /**
   * Dotted path to the page's record array (HubSpot `results`, Stripe `data`).
   * Used to read the last record (`lastRecord` cursor) and detect an empty page;
   * omit to auto-find the first array in the body.
   */
  recordsPath?: string
  /**
   * Boolean body field that says "more pages exist" (Stripe/Notion `has_more`).
   * When set, a falsy value terminates the loop regardless of token presence.
   */
  hasMorePath?: string
  /**
   * Dotted body path to a full next-page URL the server hands back (Salesforce
   * `nextRecordsUrl`); the URL is GET verbatim. Only read for `kind: 'next-url'`.
   * (`link-header` covers the same idea when the URL is in a response header.)
   */
  nextUrlPath?: string
  pageParam?: string
  /** Offset base for `kind: 'offset'` — `0` (default) or `1` (QuickBooks `STARTPOSITION`). */
  offsetBase?: 0 | 1
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
  /**
   * How far back a BACKFILL crawls (Step 9 §1.2, plain-language UX). Connector-level
   * (applies to every stream). `'all'` (default) crawls full history. A bounded span
   * injects a `created`-style floor on the first backfill request — but only on streams
   * whose {@link StreamRequestConfig.backfillWindow} declares WHICH param carries it
   * (templates do; bare generic-rest doesn't, so the UI hides the choice).
   */
  backfillWindowSpan?: 'all' | 'last_90_days' | 'last_12_months'
  /**
   * Webhook-sync SIGNAL — which inbound event drives this connector (v7). One per
   * connector: a connector is bound to a single credential/baseUrl = one provider, so
   * every stream shares the same signal; only topic/token STEERING differs per stream
   * (see {@link StreamWebhookTrigger}). Exactly ONE of:
   *   • `triggerId` — an APP webhook trigger (matched by `dispatchAppTriggerToConnectors`
   *     off the connector's app connection).
   *   • `webhookEndpointId` — a generic `WebhookEndpoint` (matched by
   *     `dispatchWebhookEndpointToConnectors`). Fetch auth still comes from the connector's
   *     own `credentialId`; the endpoint only provides the signal.
   * Absent ⇒ not webhook-bound. Set when `syncBehavior === 'webhook'`.
   */
  webhookTrigger?: { triggerId?: string; webhookEndpointId?: string }
}

/**
 * Steady-mode (incremental) delta config for a generic-REST stream (G2). Declares
 * the timestamp-filter param to inject and the response field to track the max of.
 * Covers `updated_at`-style providers (Shopify/Salesforce/HubSpot/QBO). NOT Stripe —
 * its list endpoints filter on `created` (never changes); Stripe's real incremental
 * path is `/v1/events`, handled separately (Step 8).
 */
export interface StreamIncrementalConfig {
  /**
   * Incremental mechanism (Step 8D). `'timestamp'` (default) filters a list endpoint
   * on `updated_at >= watermark` — covers updates but NEVER deletes or `created`-only
   * providers. `'event-feed'` polls a provider event log (Stripe `/v1/events`): each
   * event is an upsert or a delete, so it covers updates AND deletes in one pass.
   */
  kind?: 'timestamp' | 'event-feed'
  /** Query param carrying the delta floor, e.g. `updated_at_min` / `since` / `created[gte]`. */
  sinceParam: string
  /**
   * Record field whose running max becomes the next watermark, e.g. `updated_at`.
   * For `event-feed` this is the EVENT field (Stripe event `created`), not the object's.
   */
  watermarkField: string
  /** Comparison/format hint. Advisory — `maxWatermark` auto-detects numeric vs ISO. */
  watermarkFormat?: 'iso' | 'unix'
  // ── event-feed only (kind: 'event-feed') ──
  /** Endpoint to poll for events on a steady run, e.g. `/v1/events` (overrides the stream path). */
  eventsPath?: string
  /** Dotted path on each event to its `type`/topic (Stripe `type`). Default `type`. */
  eventTypePath?: string
  /** Event types treated as deletes (Stripe `customer.deleted`); the rest are upserts. */
  deleteEventTypes?: string[]
  /** Dotted path on each event to the embedded object to sink (Stripe `data.object`). */
  objectPath?: string
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
  /**
   * Declares WHICH request param carries the backfill-window floor (Step 9 §1.2),
   * e.g. Shopify `created_at_min` / Stripe `created[gte]`. Present ⇒ the connector
   * can honor {@link DataConnectorConfig.backfillWindowSpan} on this stream (and the
   * UI offers the window radio). Distinct from `incremental.sinceParam`, which is the
   * STEADY delta floor (`updated_at`); this one bounds the initial BACKFILL crawl.
   */
  backfillWindow?: { sinceParam: string; format?: 'iso' | 'unix' }
  /**
   * Per-stream webhook STEERING (generic-REST only — `webhookTrigger` SIGNAL lives on
   * {@link DataConnectorConfig.webhookTrigger} since v7). Present only on
   * `syncBehavior='webhook'` streams (sync bridge, plans/data-connectors/v4). Declares
   * how a matched delivery steers the regular fetch: expose payload `{path}` values out of
   * `triggerData`, interpolate them into `path`/`params`/`headers`/`body` (which become
   * `{path}`-templatable), run the normal fetch, and sink the FETCH result as the
   * canonical record. The webhook is the signal; the fetch is the truth. App connectors
   * ignore this (their fetch is fixed — `requestModel:'fixed'`).
   */
  webhookTrigger?: StreamWebhookTrigger
}

/**
 * Per-stream webhook STEERING for a generic-REST stream (sync bridge §3.1). Lives
 * inside {@link StreamRequestConfig} (jsonb on the stream). The SIGNAL (which trigger/
 * endpoint drives the connector) is connector-level — {@link DataConnectorConfig.webhookTrigger}.
 */
export interface StreamWebhookTrigger {
  /**
   * Discriminate multiplexed deliveries with the SAME `matchesFilter()` helper the
   * agent app-trigger path uses. Flagship apps fan MANY topics through ONE triggerId
   * (Shopify sends all 22 topics on `shopify.shopify-trigger`; the topic lives in
   * `triggerData.topic`), so an exact value or a `{ in: [...] }` membership set picks
   * the subset this stream cares about. Omit for one-trigger-per-event apps.
   * e.g. `{ topic: 'orders/create' }` or `{ topic: { in: ['orders/create', 'orders/paid'] } }`.
   */
  filter?: Record<string, unknown>
  /**
   * Payload paths exposed as `{path}` placeholders for the fetch (no rename — the path
   * IS the placeholder, v7). Each dotted path is read out of `triggerData` with the
   * connector's `getByPath` and made available as `{path}` to interpolate into
   * `path`/`params`/`headers`/`body`. Paths are ENVELOPE-relative: prefer the trigger's
   * normalized outputs (`resourceId`, `updatedAt`) over the raw body. e.g.
   * `['resourceId', 'updatedAt']` → `{resourceId}` / `{updatedAt}` in the request.
   */
  paths: string[]
  /** When the event is a delete, skip the fetch and archive by externalId. */
  deleteWhen?: { tokenTruthy?: string } | { topicEquals?: string }
  /** Dotted path into `triggerData` for the externalId to archive on delete. e.g. `'resourceId'`. */
  deleteExternalIdPath?: string
  /**
   * Treat the fetch as a single record (skip pagination) vs a paginated collection.
   * Advisory — the fetch already stops after one page when no `pagination` is set;
   * defaults to `'single'` in that case. `'collection'` documents an intentional
   * filtered paginated fan-in (e.g. "all line items for order {orderId}").
   */
  resultShape?: 'single' | 'collection'
  /**
   * Coalesce same-record steer bursts: same resolved steer-token values within this
   * many ms collapse into a single delayed steer job (BullMQ `jobId` + `delay`).
   * 0/absent = steer immediately (today's behavior).
   */
  debounceMs?: number
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
  /**
   * Backfill-window floor (Step 9 §1.2) — the already-formatted value injected on
   * every page of a snapshot run (Shopify `created_at_min` / Stripe `created[gte]`).
   * PINNED ONCE when the backfill resets to fresh (`freshBackfillState`), so it stays
   * stable across every slice of the chain (no per-slice `now` drift). Absent ⇒ span
   * `'all'` or no `backfillWindow` declared ⇒ crawl full history.
   */
  backfillFloor?: string
  /** Legacy single-shot incremental cursor (snapshot-first generic-rest path). */
  cursor?: string
  /** Set by a connector's terminal `nextState` when its backfill is exhausted. */
  backfillComplete?: boolean
  /** Consecutive no-progress slices (stall guard) — see the core `SyncState`. */
  noProgressStrikes?: number
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
 * exhausted). The test-fetch (sample) path skips these; the sliced `SyncSource`
 * adapter uses them to bound + checkpoint a slice.
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

/**
 * Thrown by a connector fetch when pagination stops making progress — the upstream
 * hands back the SAME resume token it was just given while still signalling more
 * pages (an endpoint that ignores the cursor param and replays a page). Unlike
 * {@link ConnectorRateLimitError} this is NOT retriable: re-fetching just re-freezes.
 * It is neither a rate-limit nor an abort, so it propagates out of `runConnectorSlice`
 * and the slice-runner closes the run `failed` with this message — surfacing the real
 * cause instead of silently completing a backfill that only ever saw page 1.
 */
export class PaginationStalledError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PaginationStalledError'
  }
}

/**
 * A deterministic, non-retriable failure of a webhook-steered fetch — e.g. a payload path
 * that returned no value, leaving an unresolved `{token}` in the request. Replaying the same
 * delivery fails identically, so the steer job dead-letters it on the FIRST attempt instead
 * of burning the bounded BullMQ retries (which are meant for transient 5xx/network errors).
 */
export class PermanentSteerError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PermanentSteerError'
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
  /** Predefined select option set (SINGLE_SELECT / MULTI_SELECT / TAGS). */
  options?: Array<{ value: string; label?: string; color?: string }>
  /** Sub-field set for an ADDRESS_STRUCT field. */
  addressComponents?: string[]
  /** This field's value is the owned record's stable external id (dedupe/link key). */
  isExternalId?: boolean
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
        /** Non-identity field bindings pre-declared by the app author (e.g. `first_name`
         *  → contact first-name). Bound by key like match keys, sans `identityRole` — unless
         *  `targetAppField` names an `identity: true` app field, which auto-stamps one. */
        fieldBindings?: { sourceFieldKey: string; targetKey?: string; targetAppField?: string }[]
        /** Fill a plain (non-identity) app field from connection metadata (e.g. Shopify
         *  `shopDomain`) — the only synthetic write channel. See SDK mirror for details. */
        connectionAppFields?: { appFieldKey: string; from: string }[]
      }
}

/** Minimal entity declaration for an owned-mode default mapping. */
export interface ConnectorEntityDecl {
  apiSlug: string
  singular: string
  plural: string
  primaryDisplayField?: string
  /** `fieldKey` of a URL/FILE field to wire as the def's avatar/display image. */
  avatarField?: string
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
   * Resolved `{token}` → value map for a webhook-STEERED fetch (sync bridge §4.1).
   * Undefined for normal scheduled/backfill syncs. The generic-rest connector
   * interpolates these into the request's path/params/headers/body (the same
   * `{key}` mechanism `baseUrlTemplate`/`authApply` use) so a webhook delivery
   * points the fetch at exactly the changed resource.
   */
  triggerContext?: Record<string, string>
  /**
   * Per-call override merged onto the endpoint's `rateLimit` policy. The sliced
   * `SyncSource` sets `{ maxRetries: 0 }` so a throttle returns immediately (the
   * connector throws {@link ConnectorRateLimitError}) instead of the transport
   * sleeping under the slice's `maxMs` budget while holding the worker lock (H1).
   * Absent for the single-shot path, which keeps the default retry-and-sleep.
   */
  rateLimitOverride?: Partial<RateLimitPolicy>
  /**
   * The slice's cancellation signal (worker lock budget / graceful shutdown).
   * Threaded into the HTTP transport so an in-flight request aborts when the
   * slice does — without it the connector relies solely on the transport's own
   * per-request timeout.
   */
  signal?: AbortSignal
  /**
   * Sample/test-fetch only: invoked once per fetched page with the transport's
   * normalized response headers (lowercased keys). Lets the builder's test-fetch
   * surface `link-header` pagination without putting transport metadata on
   * {@link ConnectorRecord} (which flows through the whole sink/mapping spine on
   * every real sync). The scheduled sync never passes this; connectors that have
   * no HTTP headers simply never call it.
   */
  onPageMeta?: (meta: { pageIndex: number; headers: Record<string, string> }) => void
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
  /**
   * Optional async bulk-export capability (Step 7). When present, a BACKFILL runs the
   * initiate → poll → download lifecycle (rate-limit-exempt, the right tool for
   * 100k+ reads) instead of synchronous paging; steady deltas still page/webhook.
   * The capability builds a provider {@link AsyncExportDriver} per stream.
   */
  asyncExport?: AsyncExportCapability
  /** Map a provider delete event onto a (streamKey, externalId). */
  resolveDelete?(event: unknown): { streamKey: string; externalId: string } | null
}

// ── Policy types — identity / merge / link (02) ───────────────────────────────

// Lifted to `../write-policy` once the CSV importer became the second consumer
// of the same three questions (which columns identify a record, what happens to
// an existing value, how a reference becomes a link). Re-exported here so every
// connector call site keeps importing from `data-connectors/types`; a web-local
// or import-local duplicate of a policy vocabulary is exactly how
// `DISPLAY_OPTION_KEYS` silently ate option keys for months.
import type { FieldMergeStrategy, IdentityNormalize, IdentityRole } from '../write-policy'

export type { FieldMergeStrategy, IdentityNormalize, IdentityRole }

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
   * The identity ROLE this bound field plays (relationship-linking v3 §9.5). One
   * discriminated union structurally enforces "at most one role per field":
   *   • `externalId` — designates this field as (part of) the upstream stable id
   *     used for re-identification + link anchoring (§9.3a). `order` sequences a
   *     first-non-null fallback CHAIN (`id → email`); absent ⇒ the synthetic
   *     `${parentExternalId}:${index}` is the last resort. Replaces the old silent
   *     `subtreeExternalId` guess — now explicit + editable.
   *   • `match` — a SECONDARY identity key. The external id stays the primary key
   *     (the DataConnectorItem binding); on first contact (no binding yet) the sink
   *     looks for an existing entity whose value of this target field equals the
   *     source value and adopts it. `normalize` is derived from the target field
   *     type at toggle time (email/phone/domain), else 'none'.
   * Absent = the field is projected only.
   */
  identityRole?: IdentityRole
  /** Per-field write behavior (folded in from the old parallel map). Absent ⇒ 'overwrite'. */
  mergeStrategy?: FieldMergeStrategy
  /**
   * This binding writes a value read from the connector's CONNECTION METADATA
   * (e.g. Shopify `shopDomain`), not the source record subtree — the SDK
   * `connectionAppFields` synthetic-write channel. The value is
   * `ctx.connectionMeta?.[connectionMetaKey]`, injected by the sink before the
   * normal write-set build; `expression`/`sourceFields` are unused (map-record
   * skips evaluating these entries). Never carries an `identityRole`.
   */
  connectionMetaKey?: string
  /**
   * Provisioning hint for a connector-introduced target field (05d). Consumed by
   * `materializeConnectorTargets` to create the field with the declared type/name
   * when the target def is missing it; ignored when the field already exists
   * (e.g. `email`/`name` reused from a system def). Absent on hand-authored UI
   * mappings — those bind to fields that already exist.
   *
   * `appFieldKey` (05e) is the STABLE idempotency key the provisioner + ref
   * write-back match on; `name` is the display label. Owned Shopify fields need the
   * two to differ (`appFieldKey: 'name'`, display `'Order Name'`). Absent ⇒ key
   * falls back to `name` (templates, where the two coincide).
   */
  provision?: {
    name: string
    type: FieldType
    icon?: string
    isHidden?: boolean
    appFieldKey?: string
    /** Predefined select options to provision (SINGLE_SELECT / MULTI_SELECT / TAGS). */
    options?: Array<{ value: string; label?: string; color?: string }>
    /** Sub-field set to provision for an ADDRESS_STRUCT field. */
    addressComponents?: string[]
  }
}

/**
 * Pending re-sync marker (jsonb on `DataConnector.resyncPending`, nullable).
 * Stamped by the mapping-edit-safety mutations when a structural edit means existing
 * synced records no longer reflect the current config; cleared on the next full
 * backfill of the affected streams. Drives the connector-page banner.
 *
 * MUST stay byte-compatible with the DB mirror `ResyncPending` in `@auxx/database`
 * schema/`data-connector-types.ts` (the DB package can't import this tier-3 type).
 */
export interface ResyncPending {
  /** `'rebackfill'` = re-projection needed; `'rebind'` = identity/match key changed. */
  level: 'rebackfill' | 'rebind'
  /** Short reason codes for the banner detail (e.g. `'rootPath'`, `'field-added'`). */
  reasons: string[]
  /** Streams whose backfill must re-run to clear the pending state. */
  streamIds: string[]
  /** Bound record count at stamp time (banner message; cheap `count(*)`). */
  itemCount: number
  /** ISO 8601 timestamp the marker was stamped. */
  at: string
}

export type LinkMode = 'upsert' | 'reference'
export type TargetMode = 'owned' | 'contributing'
/**
 * A stream's completeness strategy for FULL (backfill/sweep/scheduled/manual) runs, which
 * also gates orphan reconciliation: `snapshot` re-crawls everything every run (absence =
 * deletion → reconcile), `incremental` fetches watermark deltas (absence ≠ deletion → no
 * reconcile unless a sweep). Webhook-steered partial runs are an orthogonal, per-delivery
 * trigger concern (`syncBehavior='webhook'` + per-stream steering config) — NOT a sync mode.
 */
export type SyncMode = 'snapshot' | 'incremental'
export type OrphanBehavior = 'archive' | 'mark_deleted' | 'ignore'

// ── Scheduled-trigger config (jsonb on DataConnector) ─────────────────────────

export interface ScheduledTriggerConfig {
  /** `'off'` is only meaningful as a webhook-mode SWEEP cadence (v9 §5) — no self-heal. */
  triggerInterval: 'minutes' | 'hours' | 'days' | 'weeks' | 'custom' | 'off'
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
