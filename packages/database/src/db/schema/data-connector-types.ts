// packages/database/src/db/schema/data-connector-types.ts
// Code-side TS types backing the jsonb/text columns on the Data Connector tables.
// These live in the database package (tier 1) because schema files cannot import
// from @auxx/lib (tier 3). The canonical engine-side types are defined in the
// data-connectors sub-plans (02/03/05a); these are structurally-compatible
// placeholders kept in sync. Drift between the two is reconciled in code review.

import type { FieldType } from '../../types'

/**
 * Connector kind — text-backed (not a pgEnum) so new connectors ship without an
 * enum-alter migration. Built-in ids plus the `app:${slug}` template literal, so
 * it can't be a fixed `as const` array. Mirrors {@link KnowledgeSourceType}.
 * Defined alongside the connector registry in sub-plan 03.
 */
export type DataConnectorType = 'generic-rest' | `app:${string}`

/**
 * Pagination contract for a generic-REST endpoint. Refined in sub-plan 05a.
 * Structural mirror of `PaginationSpec` in `@auxx/lib/data-connectors/types`
 * (this package can't import tier-3 lib) — keep the two byte-compatible.
 */
export interface PaginationSpec {
  kind: 'cursor' | 'page' | 'offset' | 'link-header' | 'next-url' | 'none'
  /** Query/body param name carrying the cursor/page token. */
  cursorParam?: string
  /** Where the next cursor/page token lives in the response (cursor-in-body). */
  cursorPath?: string
  /** `'response'` (default) reads cursorPath; `'lastRecord'` derives it from the last record (Stripe). */
  cursorFrom?: 'response' | 'lastRecord'
  /** With `lastRecord`: which field of the last record is the cursor (Stripe: `id`). */
  cursorRecordField?: string
  /** Dotted path to the page's record array (read last record + detect empty); auto-found if omitted. */
  recordsPath?: string
  /** Boolean body field that says "more pages exist" (Stripe/Notion `has_more`); falsy terminates. */
  hasMorePath?: string
  /** Dotted body path to a full next-page URL the server hands back (Salesforce `nextRecordsUrl`). */
  nextUrlPath?: string
  pageParam?: string
  /** Offset base for `kind: 'offset'` — `0` (default) or `1` (QuickBooks `STARTPOSITION`). */
  offsetBase?: 0 | 1
  limitParam?: string
  pageSize?: number
}

/**
 * Connector-level config (jsonb on {@link DataConnector}). Generic-REST endpoint
 * + global filters only — per-stream config lives on DataConnectorStream,
 * target/identity/merge on DataConnectorMapping.
 */
export interface DataConnectorConfig {
  endpoint?: {
    baseUrl: string
    auth?: 'credential' | 'none'
    pagination?: PaginationSpec
    /** Non-secret headers sent on every request, under per-stream headers. */
    headers?: Record<string, string>
    /**
     * Rate-limit handling for every request to this endpoint (G3). Structural
     * mirror of `RateLimitPolicy` in `@auxx/lib/connections/transports/types`
     * (this package can't import tier-3 lib).
     */
    rateLimit?: {
      strategy?: 'retry-after' | 'graphql-cost' | 'backoff-jitter'
      maxRetries?: number
      minDelayMs?: number
    }
  }
  filters?: Record<string, unknown>
  /**
   * Webhook-sync SIGNAL — which inbound event drives this connector (v7, one per
   * connector). Mirror of lib `DataConnectorConfig.webhookTrigger`. Exactly one of:
   * `triggerId` (an app webhook trigger) or `webhookEndpointId` (a generic
   * `WebhookEndpoint`). Set when `syncBehavior === 'webhook'`.
   */
  webhookTrigger?: { triggerId?: string; webhookEndpointId?: string }
  /** Backfill crawl span (Step 9 §1.2). Mirror of lib `DataConnectorConfig.backfillWindowSpan`. */
  backfillWindowSpan?: 'all' | 'last_90_days' | 'last_12_months'
}

/**
 * Pending re-sync marker (jsonb on {@link DataConnector}, nullable). Stamped by the
 * mapping-edit-safety mutations when a structural edit (mapping/connector/stream
 * change) means existing synced records no longer reflect the config; cleared when a
 * full backfill of the affected streams completes. Drives the connector-page banner.
 * Structural mirror of `ResyncPending` in `@auxx/lib/data-connectors/types` (this
 * package can't import tier-3 lib) — keep the two byte-compatible (Invariants §18).
 */
export interface ResyncPending {
  /** `'rebackfill'` (re-projection needed) vs `'rebind'` (identity/match key changed). */
  level: 'rebackfill' | 'rebind'
  /** Short reason codes for the banner detail (e.g. `'rootPath'`, `'field-added'`). */
  reasons: string[]
  /** Streams whose backfill must re-run to clear the pending state. */
  streamIds: string[]
  /** Bound record count at stamp time (for the banner message; cheap `count(*)`). */
  itemCount: number
  /** ISO 8601 timestamp the marker was stamped. */
  at: string
}

/**
 * Scheduled-trigger config (jsonb on {@link DataConnector}). Structural mirror of
 * `ScheduledTriggerConfig` from `@auxx/lib/workflows/cron-pattern` — re-declared
 * here because the database package cannot import lib (tier ordering).
 *
 * It is a SUPERSET of the workflow one: this column also stores `'off'`, the
 * webhook-mode SWEEP cadence (v9 §5) that has no workflow equivalent. The
 * connector router persists it and the sweep scheduler reads it, so a union
 * without `'off'` is narrower than the column it describes.
 */
export interface ScheduledTriggerConfig {
  /** `'off'` is webhook-mode only — the delete-reconciliation sweep is opted out. */
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

/**
 * Durable per-stream sync state + bookkeeping (jsonb on
 * {@link DataConnectorStream}). Persisted across runs and checkpointed AFTER
 * every committed slice. MUST stay byte-compatible with the engine
 * `ConnectorStreamState` in `@auxx/lib/data-connectors/types` (this package can't
 * import tier-3 lib). See plans/data-connectors/v3/large-dataset-sync-plan.md §8.
 */
export interface ConnectorStreamState {
  /** Engine-managed lifecycle phase (orthogonal to the user's `syncMode`). */
  phase?: 'backfill' | 'steady'
  /** Durable backfill page cursor — structured `{kind,value}`, never lossy (H6);
   *  checkpointed AFTER every committed slice. Mirrors `SyncCursor` in
   *  `@auxx/lib/sync-core/contracts` (this package can't import tier-3 lib). */
  backfillCursor?: { kind: string; value: string }
  /** When the current backfill chain began (ISO 8601). */
  backfillStartedAt?: string
  /** Running total for the progress UI (counts, never a percent). */
  recordsSeen?: number
  /** Steady-phase delta floor; the source returns a monotonic max each slice. */
  watermark?: string
  /** Backfill-window floor (Step 9 §1.2), pinned once at fresh-backfill reset.
   *  Mirror of lib `ConnectorStreamState.backfillFloor`. */
  backfillFloor?: string
  /** Legacy single-shot incremental cursor (snapshot-first generic-rest path). */
  cursor?: string
  /** Set by a connector's terminal `nextState` when its backfill is exhausted. */
  backfillComplete?: boolean
  /** Consecutive no-progress slices (pagination stall guard). Mirror of lib
   *  `ConnectorStreamState.noProgressStrikes`. */
  noProgressStrikes?: number
  [key: string]: unknown
}

/**
 * Per-stream request config for generic-REST streams (jsonb on
 * {@link DataConnectorStream}). Path/method/params/body/pagination. Records are
 * selected by the root mapping's `rootPath`, not here. Refined in sub-plan 05a.
 */
export interface StreamRequestConfig {
  path?: string
  method?: 'GET' | 'POST'
  params?: Record<string, unknown>
  body?: Record<string, unknown>
  headers?: Record<string, string>
  pagination?: PaginationSpec
  /** Steady-phase delta config (G2 / Step 8D). Mirror of lib `StreamIncrementalConfig`. */
  incremental?: {
    /** `'timestamp'` (default, updated_at filter) | `'event-feed'` (Stripe /v1/events). */
    kind?: 'timestamp' | 'event-feed'
    sinceParam: string
    watermarkField: string
    watermarkFormat?: 'iso' | 'unix'
    // event-feed only:
    /** Endpoint polled for events on a steady run, e.g. `/v1/events` (overrides path). */
    eventsPath?: string
    /** Dotted path on each event to its type/topic (Stripe `type`). */
    eventTypePath?: string
    /** Event types treated as deletes (Stripe `customer.deleted`); rest are upserts. */
    deleteEventTypes?: string[]
    /** Dotted path on each event to the embedded object to sink (Stripe `data.object`). */
    objectPath?: string
  }
  /** Backfill-window floor param declaration (Step 9 §1.2). Mirror of lib
   *  `StreamRequestConfig.backfillWindow`. */
  backfillWindow?: { sinceParam: string; format?: 'iso' | 'unix' }
  /**
   * Per-stream webhook STEERING (v7). Mirror of lib `StreamWebhookTrigger`. Present
   * only on `syncBehavior='webhook'` generic-REST streams: a matched delivery exposes
   * payload `{path}` values out of `triggerData` to steer the regular fetch (the
   * connector-level SIGNAL is `DataConnectorConfig.webhookTrigger`).
   */
  webhookTrigger?: {
    filter?: Record<string, unknown>
    paths: string[]
    deleteWhen?: { tokenTruthy?: string } | { topicEquals?: string }
    deleteExternalIdPath?: string
    resultShape?: 'single' | 'collection'
  }
}

/**
 * One binding entry (CALC shape, reused from CALC custom fields — sub-plan 05 §4
 * Layer B). Stored as elements of the `fieldMappings` ARRAY on
 * {@link DataConnectorMapping}: identity is the stable `id`, NOT the target field,
 * so a binding can exist before (or without) a target. A one-click row is the
 * degenerate single-token `{source}` expression. Mirrors the engine `FieldMapping`
 * in `@auxx/lib/data-connectors/types`.
 */
export interface FieldMapping {
  /** Stable entry id (generateId). React key + dialog/patch handle; never reused. */
  id: string
  /**
   * Canonical `ResourceFieldId` reference to the target field — concrete
   * (`${entityDefinitionId}:${fieldId}`) or the late-bound `@app:` form. `null` =
   * unassigned draft / provisioned field awaiting its concrete ref. Branded
   * `ResourceFieldId` in the engine `FieldMapping` (`@auxx/lib/data-connectors/types`);
   * a plain string here (this package can't import tier-1 `@auxx/types`).
   */
  targetFieldRef: string | null
  expression: string
  sourceFields: Record<string, string>
  /**
   * The identity ROLE this bound field plays (relationship-linking v3 §9.5). Mirror
   * of the engine `FieldMapping.identityRole`. `externalId` designates the upstream
   * stable id (re-identification + link anchor; `order` sequences a fallback chain);
   * `match` is a secondary adoption key (external id stays primary). At most one role
   * per field.
   */
  identityRole?:
    | { kind: 'externalId'; order?: number }
    | { kind: 'match'; normalize?: IdentityNormalize }
  /** Per-field write behavior (folded in from the old parallel map). Absent ⇒ 'overwrite'. */
  mergeStrategy?: FieldMergeStrategy
  /**
   * This binding writes a value read from the connector's CONNECTION METADATA
   * (e.g. Shopify `shopDomain`), not the source record subtree. Mirror of the
   * engine `FieldMapping.connectionMetaKey` (`@auxx/lib/data-connectors/types`).
   */
  connectionMetaKey?: string
  /**
   * Provisioning hint for a connector-introduced target field (05d) — used to
   * create a missing target field with the declared type/name at sync time.
   * `appFieldKey` (05e) is the STABLE idempotency key the provisioner + ref
   * write-back match on; `name` is the display label. When absent the key falls
   * back to `name` (templates, where the two coincide).
   */
  provision?: {
    name: string
    type: FieldType
    icon?: string
    isHidden?: boolean
    appFieldKey?: string
  }
}

/**
 * Per-field write behavior (folded into {@link FieldMapping}`.mergeStrategy`).
 * MUST mirror the engine `FieldMergeStrategy` in
 * `@auxx/lib/data-connectors/types` (this package can't import tier-3 lib).
 */
export type FieldMergeStrategy =
  | 'overwrite'
  | 'fill_blank'
  | 'connector_owned_only'
  | 'manual_review'
  | 'ignore'

/**
 * Identity match normalizers — mirror of the engine `IdentityNormalize`. A
 * bound field flagged for match (see {@link FieldMapping}`.match`) carries one.
 */
export type IdentityNormalize = 'email' | 'phone' | 'domain' | 'none'
