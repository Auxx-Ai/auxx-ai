// packages/lib/src/resources/crud/door-matrix.ts

/**
 * The write fan-out door matrix — documentation as code.
 *
 * Every write to a record fans out through a fixed set of "doors" (timeline,
 * realtime, rules, workflows, hooks, stamps, caches). This module is the
 * literal table of DESIRED per-origin behavior for each door, per
 * `plans/events/03-write-context-and-batch-lane-plan.md` §6 (decisions D-1..D-19
 * in its §1) with `docs/skip-events-history.md` as the evidence base. It has no
 * runtime behavior yet — it is the artifact the remaining [R]/[Q] cells get
 * argued into, and later phases read their policy from it.
 *
 * THE RULE: adding a door or an origin kind without deciding every cell fails
 * the build — `__tests__/door-matrix.test.ts` asserts exact set equality
 * between each door's policy keys and `WRITE_ORIGIN_KINDS`, in both
 * directions. This is the same coupling pattern as the workflow catalog's
 * `NodeType <-> NOT_YET_MIGRATED` coverage test.
 */

/**
 * The origin kinds a write can declare — the matrix columns.
 *
 * - `interactive` — a human (or API token actor) acting now. Per D-17 a
 *   bulk-shaped interactive op whose record count exceeds
 *   `SYNC_SMALL_RUN_THRESHOLD` executes batch-lane doors (the sync-large
 *   column), with timeline kept per-record and the workflow guard surfaced as
 *   an immediate confirm instead of a held approval.
 * - `automation` — server-side automation: workflows, record rules, agents,
 *   field hooks, steady-state ingest. System actor, cause names the starter.
 * - `sync-small` — a sync/import run whose OBSERVED changed-record count at
 *   finalize is <= `SYNC_SMALL_RUN_THRESHOLD` (D-12). Never declared by the
 *   walker — lane selection is count-based at finalize.
 * - `sync-large` — a sync/import run above the threshold, or first-connect
 *   backfill scale. Everything accumulates against the run ref; a finalize
 *   pipeline runs set-based passes.
 * - `seed` — seeders and data migrations. Silent forever (the documented
 *   exemption), apart from batched integrity passes (D-10) and inline
 *   derived-state maintenance.
 */
export const WRITE_ORIGIN_KINDS = [
  'interactive',
  'automation',
  'sync-small',
  'sync-large',
  'seed',
] as const

export type WriteOriginKind = (typeof WRITE_ORIGIN_KINDS)[number]

/**
 * Lane threshold (D-12): a sync/import run whose observed changed-record count
 * at finalize is at or below this takes the per-record replay lane; above it,
 * the batch lane. Count-based selection at finalize — never declared by the
 * writer — and honest only because of the D-6 idempotency guard: with no-op
 * writes eliminated, a fallback full re-walk that re-asserts unchanged data
 * lands at ~0 actual changes and takes the small lane naturally.
 */
export const SYNC_SMALL_RUN_THRESHOLD = 100

/**
 * Workflow auto-dispatch threshold (D-13): applied per workflow, in the batch
 * lane only. Below it a tallied workflow's dispatches auto-enqueue; at or
 * above, that workflow's dispatches are held for approval. The tally is
 * computed and persisted always, even before any approval UI exists.
 */
export const WORKFLOW_AUTO_DISPATCH_THRESHOLD = 25

/**
 * What a door does for a given write origin:
 * - `'per-record'` — fires inline, once per changed record, as it happens.
 * - `'batched'` — accumulates against the run ref; executed set-based at
 *   finalize (or as throttled batch frames during the run).
 * - `'guarded'` — tallied always; dispatch is thresholded and may be held for
 *   approval (workflows per D-3/D-13/D-19, enrichment per D-9).
 * - `{ off: reason }` — deliberately does not fire; the reason string says why,
 *   so silence reads as a decision, not an accident.
 */
export type DoorPolicy = 'per-record' | 'batched' | 'guarded' | { off: string }

export type DoorMatrixEntry = {
  label: string
  policies: Record<WriteOriginKind, DoorPolicy>
  /** Cell nuances that don't fit the four-value vocabulary. */
  note?: string
  /** Plan §1 decision ids grounding the row (e.g. 'D-4'). Absent = [R] recommended. */
  decisionRefs?: string[]
}

/**
 * The door matrix — desired behavior per plan §6. Rows without `decisionRefs`
 * are [R] recommended (uncontested so far); rows with them are [D] decided.
 */
export const DOOR_MATRIX = {
  timelineEntry: {
    label: 'Timeline entry (record)',
    policies: {
      interactive: 'per-record',
      automation: 'per-record',
      'sync-small': 'per-record',
      'sync-large': 'batched',
      seed: { off: 'seed is silent forever; timeline is a user-facing audit surface' },
    },
    note:
      'sync-large: collapsed to one entry per record per run ("Sync run X changed 5 fields"). ' +
      'automation: system actor. Interactive bulk ops stay per-record and attributed to the ' +
      'human even over the lane threshold (D-17).',
    decisionRefs: ['D-4', 'D-17'],
  },
  perFieldTimeline: {
    label: 'Per-field timeline (entity:field:updated)',
    policies: {
      interactive: 'per-record',
      automation: 'per-record',
      'sync-small': 'per-record',
      'sync-large': 'batched',
      seed: { off: 'seed is silent forever' },
    },
    note: 'sync-large: folded into the collapsed per-record run entry (D-4), not emitted per field.',
    decisionRefs: ['D-4'],
  },
  realtimeTier1: {
    label: 'Realtime tier 1 (per-record frames)',
    policies: {
      interactive: 'per-record',
      automation: 'per-record',
      'sync-small': 'per-record',
      'sync-large': { off: 'tier 2 batched delta frames instead' },
      seed: { off: 'no live UI is watching a seed run' },
    },
    note: 'interactive: delta frames when the op is bulk-shaped (plan §7b).',
  },
  realtimeTier2: {
    label: 'Realtime tier 2 (batched delta frames, ids + fieldIds)',
    policies: {
      interactive: 'batched',
      automation: 'batched',
      'sync-small': { off: 'optional; tier 1 per-record frames already cover small runs' },
      'sync-large': 'batched',
      seed: { off: 'no live UI is watching a seed run' },
    },
    note:
      'interactive/automation: for bulk-shaped ops only. sync-large: throttled during the run ' +
      'plus one frame per finalize round. Ids-only payload per D-18 (tier 2 ships ids-only).',
    decisionRefs: ['D-18'],
  },
  realtimeTier3: {
    label: 'Realtime tier 3 (coarse records:invalidated + run:completed)',
    policies: {
      interactive: { off: 'per-record / tier 2 frames suffice' },
      automation: { off: 'per-record / tier 2 frames suffice' },
      'sync-small': { off: 'per-record frames suffice for a small run' },
      'sync-large': 'batched',
      seed: { off: 'no live UI is watching a seed run' },
    },
    note:
      'sync-large: fallback when tier 2 deltas would be oversized, plus the final settle frame ' +
      'after finalize rounds complete.',
  },
  notifications: {
    label: 'Notifications',
    policies: {
      interactive: 'per-record',
      automation: 'per-record',
      'sync-small': 'per-record',
      'sync-large': { off: 'no digest in v1 (D-14)' },
      seed: { off: 'seed is silent forever' },
    },
    decisionRefs: ['D-14'],
  },
  recordRules: {
    label: 'Record rules (field + lifecycle)',
    policies: {
      interactive: 'per-record',
      automation: 'per-record',
      'sync-small': 'per-record',
      'sync-large': 'batched',
      seed: { off: 'seeded data is shaped by the seeder, not rules' },
    },
    note:
      'automation: depth-capped. sync-large: batched at finalize (D-5); their enqueue-workflow ' +
      'actions route through the D-3 dispatch guard.',
    decisionRefs: ['D-5'],
  },
  workflowDispatch: {
    label: 'Workflows / agents / webhooks',
    policies: {
      interactive: 'per-record',
      automation: 'per-record',
      'sync-small': 'per-record',
      'sync-large': 'guarded',
      seed: { off: 'seed must never start workflow runs' },
    },
    note:
      'automation: loop-guarded. sync-small fires per-record (D-2: incremental sync is new ' +
      'activity). sync-large: tally always; auto-dispatch below WORKFLOW_AUTO_DISPATCH_THRESHOLD ' +
      'per workflow, held for approval at or above (D-3/D-13, approval spine per D-19). ' +
      'Interactive bulk over the lane threshold: immediate confirm to the acting user (D-17).',
    decisionRefs: ['D-2', 'D-3', 'D-13', 'D-17', 'D-19'],
  },
  dedupScan: {
    label: 'Dedup scan',
    policies: {
      interactive: 'per-record',
      automation: 'per-record',
      'sync-small': 'batched',
      'sync-large': 'batched',
      seed: { off: 'scheduled sweep catches up' },
    },
    note: 'interactive/automation: per-record enqueue. sync: batched via the run manifest (as today).',
  },
  enrichmentHooks: {
    label: 'Enrichment hooks (company enrich — costs credits)',
    policies: {
      interactive: 'per-record',
      automation: 'per-record',
      'sync-small': 'per-record',
      'sync-large': 'guarded',
      seed: { off: 'seed must never spend enrichment credits' },
    },
    note:
      'sync-large: guarded like workflows (D-9) — enriching 8k mined companies is a bill, not a ' +
      'hook. As a rule native action it needs its own lane check in the native-action executor ' +
      '(bug B-13).',
    decisionRefs: ['D-9'],
  },
  connectorMirrorHooks: {
    label: 'Connector mirror hooks (QuickBooks)',
    policies: {
      interactive: 'per-record',
      automation: 'per-record',
      'sync-small': 'per-record',
      'sync-large': 'batched',
      seed: { off: 'seed data must not be mirrored to external systems' },
    },
    note:
      'automation and sync: echo-suppressed — never mirror a write back to its own source ' +
      'connector (checked via session.cause, not a global off switch). sync-large: batched, ' +
      'echo-suppressed.',
  },
  inverseRelationshipVisibility: {
    label: 'Inverse-side relationship visibility (timeline + realtime + rules on the OTHER record)',
    policies: {
      interactive: 'per-record',
      automation: 'per-record',
      'sync-small': 'per-record',
      'sync-large': 'batched',
      seed: { off: 'seed is silent forever' },
    },
    note:
      'D-11: the relationship-sync diff feeds the session collector instead of staying raw-SQL ' +
      'silent. A single interactive relation set touches few records, so per-record inline is fine.',
    decisionRefs: ['D-11'],
  },
  integrityHooks: {
    label:
      'Data-integrity hooks (totals, address normalize + geocode, phone geo, inventory/BOM, catalog pricing)',
    policies: {
      interactive: 'per-record',
      automation: 'per-record',
      'sync-small': 'per-record',
      'sync-large': 'batched',
      seed: 'batched',
    },
    note:
      'sync-large: batched at finalize — this retires inventory-bridge-pass as the general case. ' +
      'seed: batched (D-10) — safer than trusting every seeder to write complete derived data.',
    decisionRefs: ['D-10'],
  },
  searchTextDisplayInverse: {
    label: 'searchText / display recompute / inverse sync',
    policies: {
      interactive: 'per-record',
      automation: 'per-record',
      'sync-small': 'per-record',
      'sync-large': 'per-record',
      seed: 'per-record',
    },
    note:
      'Unchanged: always on, inline derived-state maintenance — part of the write itself, not ' +
      'fan-out. sync-large moves to set-based passes later (efficiency only, Phase 8; no ' +
      'semantic change).',
  },
  lastActivityAt: {
    label: 'lastActivityAt',
    policies: {
      interactive: 'per-record',
      automation: 'per-record',
      'sync-small': 'per-record',
      'sync-large': 'batched',
      seed: { off: 'seeded data is not activity' },
    },
    note:
      'D-1: bumps on sync writes too — coupled to the D-6 idempotency guard so "changed" means ' +
      'changed. sync-large: one batched UPDATE at finalize.',
    decisionRefs: ['D-1'],
  },
  updatedAtStamp: {
    label: 'EntityInstance.updatedAt (explicit stamp)',
    policies: {
      interactive: 'per-record',
      automation: 'per-record',
      'sync-small': 'per-record',
      'sync-large': 'batched',
      seed: 'per-record',
    },
    note:
      'D-7: $onUpdate removed; stamped explicitly at the write chokepoints. Bookkeeping writes ' +
      'do not stamp. sync-large: one batched stamp at finalize. seed: stamp on create only.',
    decisionRefs: ['D-7'],
  },
  cacheInvalidation: {
    label: 'Cache invalidation (inbox etc.)',
    policies: {
      interactive: 'per-record',
      automation: 'per-record',
      'sync-small': 'batched',
      'sync-large': 'batched',
      seed: { off: 'seeder handles its own invalidation' },
    },
    note: 'sync (both lanes): once per touched def at finalize.',
  },
} as const satisfies Record<string, DoorMatrixEntry>

export type DoorId = keyof typeof DOOR_MATRIX
