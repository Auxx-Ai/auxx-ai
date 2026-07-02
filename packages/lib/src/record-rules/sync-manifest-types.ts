// packages/lib/src/record-rules/sync-manifest-types.ts
// Shapes for the sync-change manifest: what a bulk writer (connector sink, import job)
// accumulates per run so record rules can react to skipEvents writes. Types only — no
// runtime. See plans/events/b2-sync-change-manifest-plan.md.

import type { RecordId } from '@auxx/types/resource'

/** One field write on a subscribed field. `o` (old) present only when captured. */
export interface ManifestFieldChange {
  /** Old value — present only for subscribed fields on a pre-existing row. */
  o?: unknown
  /** New value written. */
  n: unknown
}

/**
 * Persisted on DataConnectorRun.manifest (jsonb) for connector runs; import runs persist
 * per D10 (ledger row or inline under cap). Keys per D4 gating; ids per D7 — flat
 * RecordId keys, def derivable via parseRecordId. jsonb round-trip yields plain strings;
 * cast back with `as RecordId` at the read edge.
 */
export interface SyncChangeManifest {
  version: 1
  truncated: boolean
  /** Field writes on subscribed fields. outputKey = systemAttribute ?? fieldId. */
  changes: Record<RecordId, Record<string, ManifestFieldChange>>
  /** Only populated when the def has enabled lifecycle `created` rules. */
  createdRecordIds: RecordId[]
  /** Only populated when the def has enabled lifecycle `deleted` rules. */
  archivedRecordIds: RecordId[]
  /**
   * Raw create-time field values (systemAttribute-keyed) for created records whose def has
   * a lifecycle `created` rule that reads them — the sync-door source for native
   * entity-trigger handlers (`enrichCompanyOnCreate` needs `company_domain`, etc.). Same raw
   * shape `extractEventData` produces on the interactive door. Absent when no such record was
   * created. Keys are a subset of `createdRecordIds`. See Phase 9 / Option A plan Part 4.
   */
  createdValues?: Record<RecordId, Record<string, unknown>>
}

/** Bus event pointing at a persisted manifest — pointers only, no payload inline. */
export interface SyncRecordsChangedEvent {
  type: 'sync:records:changed'
  data: {
    source: 'connector' | 'import'
    organizationId: string
    /** connector: DataConnectorRun id (manifest lives on the run row). */
    runId?: string
    dataConnectorId?: string
    /** import: ImportJob id (manifest lives on the job row). */
    importRef?: string
  }
}
