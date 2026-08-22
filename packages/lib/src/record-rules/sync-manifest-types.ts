// packages/lib/src/record-rules/sync-manifest-types.ts
// Shapes for the sync-change manifest: what a bulk writer (connector sink, import job)
// accumulates per run so finalize doors and record rules can react to sync-session
// writes. Types only — no runtime. See plans/events/07-two-tier-sync-capture-plan.md.

import type { RecordId } from '@auxx/types/resource'

/** One field write on a subscribed field. `o` (old) present only when captured. */
export interface ManifestFieldChange {
  /** Old value — present only for subscribed fields on a pre-existing row. */
  o?: unknown
  /** New value written. */
  n: unknown
}

/**
 * Manifest v2 (plan 07 §3) — two tiers with independent truncation:
 *
 * - **Tier 1 (membership)** — `touched` + the lifecycle id arrays. Unconditional for
 *   sync sessions: EVERY changed record, no rule subscriptions required. Near-zero
 *   capture cost (no pre-read, no values).
 * - **Tier 2 (deltas)** — canonical `{o, n}` per field, still gated on rule
 *   subscriptions exactly as v1's `changes` was.
 *
 * Truncation only ever drops detail, never membership (plan 06 I-4).
 *
 * Persisted on DataConnectorRun.manifest (jsonb) for connector runs; import runs persist
 * per D10 (ledger row or inline under cap). Ids per D7 — flat RecordId keys, def
 * derivable via parseRecordId. jsonb round-trip yields plain strings; cast back with
 * `as RecordId` at the read edge.
 */
export interface SyncChangeManifest {
  version: 2
  /** Tier-2 detail hit its cap — deltas incomplete; membership still complete. */
  detailTruncated: boolean
  /** Membership itself overflowed — forces the large lane + tier-3 fallback. */
  membershipTruncated: boolean
  /**
   * Tier 1. EVERY record a sync-session write actually changed. Value = changed field
   * output keys (outputKey = systemAttribute ?? fieldId), or the literal `1` when keys
   * were shed under the byte budget (ids-only degradation — see
   * `TOUCHED_KEYS_BYTE_BUDGET` in `sync-manifest-collector.ts`).
   */
  touched: Record<RecordId, string[] | 1>
  /**
   * Tier 2. Rule-subscribed deltas — exactly v1's `changes`, renamed. Keyed
   * RecordId → outputKey. `o`-absence is meaningful: an entry without `o` means "this
   * record+field first appeared as a create THIS run" (see `mergeFieldChange`).
   */
  deltas: Record<RecordId, Record<string, ManifestFieldChange>>
  /** UNCONDITIONAL membership: every created record, not only lifecycle-ruled defs. */
  createdRecordIds: RecordId[]
  /** UNCONDITIONAL membership: every archived record, not only lifecycle-ruled defs. */
  archivedRecordIds: RecordId[]
  /**
   * Raw create-time field values (systemAttribute-keyed) for created records whose def has
   * a lifecycle `created` rule that reads them — the sync-door source for native
   * entity-trigger handlers (`enrichCompanyOnCreate` needs `company_domain`, etc.). Same raw
   * shape `extractEventData` produces on the interactive door. Still gated — no rules means
   * no handler reads them. Absent when no such record was created. Keys are a subset of
   * `createdRecordIds`. See Phase 9 / Option A plan Part 4.
   */
  createdValues?: Record<RecordId, Record<string, unknown>>
}

/**
 * Manifest v1 — capture was gated on rule subscriptions end-to-end. Kept only so
 * `upgradeManifestV1` can lift in-flight run rows written before the v2 deploy; delete
 * with the shim after one release (run rows are short-lived).
 */
export interface SyncChangeManifestV1 {
  version: 1
  truncated: boolean
  /** Field writes on subscribed fields. outputKey = systemAttribute ?? fieldId. */
  changes: Record<RecordId, Record<string, ManifestFieldChange>>
  createdRecordIds: RecordId[]
  archivedRecordIds: RecordId[]
  createdValues?: Record<RecordId, Record<string, unknown>>
}

/**
 * Bus event pointing at a persisted manifest — pointers only, no payload inline.
 *
 * `{ source, ref }` is the target shape (plan 07 §3 / plan 03 H-2 finding 3): `ref` is
 * the DataConnectorRun id for `source: 'connector'` and the ImportJob id for
 * `source: 'import'`. `ref` is optional only for the one-release deprecation window —
 * new publishers MUST set it; consumers fall back to the deprecated per-source fields
 * for in-flight events.
 */
export interface SyncRecordsChangedEvent {
  type: 'sync:records:changed'
  data: {
    source: 'connector' | 'import'
    organizationId: string
    /** Manifest pointer: DataConnectorRun id (connector) or ImportJob id (import). */
    ref?: string
    /** @deprecated Use `ref` with `source: 'connector'`. Removed after one release. */
    runId?: string
    /** @deprecated Derivable from the run row via `ref`. Removed after one release. */
    dataConnectorId?: string
    /** @deprecated Use `ref` with `source: 'import'`. Removed after one release. */
    importRef?: string
  }
}
