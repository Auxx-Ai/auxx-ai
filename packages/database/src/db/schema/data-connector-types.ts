// packages/database/src/db/schema/data-connector-types.ts
// Code-side TS types backing the jsonb/text columns on the Data Connector tables.
// These live in the database package (tier 1) because schema files cannot import
// from @auxx/lib (tier 3). The canonical engine-side types are defined in the
// data-connectors sub-plans (02/03/05a); these are structurally-compatible
// placeholders kept in sync. Drift between the two is reconciled in code review.

/**
 * Connector kind — text-backed (not a pgEnum) so new connectors ship without an
 * enum-alter migration. Built-in ids plus the `app:${slug}` template literal, so
 * it can't be a fixed `as const` array. Mirrors {@link KnowledgeSourceType}.
 * Defined alongside the connector registry in sub-plan 03.
 */
export type DataConnectorType = 'generic-rest' | `app:${string}`

/** Pagination contract for a generic-REST endpoint. Refined in sub-plan 05a. */
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
 * Connector-level config (jsonb on {@link DataConnector}). Generic-REST endpoint
 * + global filters only — per-stream config lives on DataConnectorStream,
 * target/identity/merge on DataConnectorMapping.
 */
export interface DataConnectorConfig {
  endpoint?: {
    baseUrl: string
    auth?: 'credential' | 'none'
    pagination?: PaginationSpec
  }
  filters?: Record<string, unknown>
}

/**
 * Scheduled-trigger config (jsonb on {@link DataConnector}). Structural mirror of
 * `ScheduledTriggerConfig` from `@auxx/lib/workflows/cron-pattern` — re-declared
 * here because the database package cannot import lib (tier ordering).
 */
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

/**
 * Per-stream incremental cursor + sync bookkeeping (jsonb on
 * {@link DataConnectorStream}). Persisted across runs. Refined in sub-plan 03.
 */
export interface ConnectorStreamState {
  /** Incremental cursor (timestamp, opaque token, or page marker). */
  cursor?: string | number
  /** Last successful run id for this stream. */
  lastRunId?: string
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
}

/**
 * A single target-field mapping (CALC shape, reused from CALC custom fields —
 * sub-plan 05 §4 Layer B). A one-click row is the degenerate single-token
 * `{source}` expression.
 */
export interface FieldMapping {
  expression: string
  sourceFields: Record<string, string>
  /**
   * When present, this bound field is also a secondary identity-match key (the
   * external id is the always-on primary). Mirrors the engine `FieldMapping.match`
   * in `@auxx/lib/data-connectors/types`.
   */
  match?: { normalize?: IdentityNormalize }
}

/**
 * Per-field write behavior (jsonb on {@link DataConnectorMapping}, keyed by
 * target field key). MUST mirror the engine `FieldMergeStrategy` in
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
