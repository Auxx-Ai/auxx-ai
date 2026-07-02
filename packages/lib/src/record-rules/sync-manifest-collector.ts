// packages/lib/src/record-rules/sync-manifest-collector.ts
// Run/slice-scoped accumulator for a sync-change manifest. Bulk writers (connector
// sink, import job) that write with `skipEvents: true` feed this so record rules can
// still react to their writes (B2 plan D4). Subscription-aware: an org with no enabled
// rules on the touched defs gets a zero-cost no-op stub — nothing is captured, no query
// is issued at the write sites. See plans/events/b2-sync-change-manifest-plan.md.

import { createScopedLogger } from '@auxx/logger'
import type { RecordId } from '@auxx/types/resource'
import type { DefSubscriptions, SyncRuleSubscriptions } from './subscriptions'
import type { ManifestFieldChange, SyncChangeManifest } from './sync-manifest-types'

const logger = createScopedLogger('sync-manifest')

/**
 * Run-level caps (D4). Enforced both per-collector (a single slice) AND across the fold
 * in `mergeManifests` — otherwise, since the deviation made collectors per-slice, an
 * N-slice run could accumulate N × these into one run row with no `truncated` flag and
 * blow the consumer's queue-blocking budget. Beyond these the manifest is flagged
 * `truncated` and stops growing.
 */
const MAX_CHANGED_RECORDS = 5000
const MAX_LIFECYCLE_RECORDS = 10000

/**
 * Union one outputKey's change entries: the FIRST fragment's `o`-state wins (value AND
 * absence), last `n` wins. Shared by the in-memory collector (same record written twice
 * in a slice) and `mergeManifests` (folding slices into the run row) so the two merge
 * semantics can never diverge.
 *
 * `o`-absence is meaningful: creates capture `{n}` with NO `o` (see
 * `captureCreateFieldChanges`), updates always capture `o` (null when the field was
 * empty). So an existing entry without `o` means "this record+field first appeared as a
 * create THIS run" — a later update fragment must NOT graft its pre-read `o` (the
 * values the create just wrote) onto it, or a created-then-updated record would fold to
 * `{o: v, n: v2}` and a `set` rule (`isEmpty(o)`) would never fire.
 */
function mergeFieldChange(
  existing: ManifestFieldChange | undefined,
  incoming: ManifestFieldChange
): ManifestFieldChange {
  if (!existing) return incoming
  return { n: incoming.n, ...('o' in existing ? { o: existing.o } : {}) }
}

/**
 * Accumulates field changes + lifecycle ids for the subscribed defs of one run/slice.
 * All mutators are no-ops when `enabled` is false (no subscriptions) — producers still
 * call them unconditionally; the gating lives here.
 */
export interface ManifestCollector {
  /** False ⇒ the org has no enabled rules on any def — every mutator is a no-op. */
  readonly enabled: boolean
  /** Subscription buckets for a def, or undefined when nothing is subscribed for it. */
  subscriptionsFor(entityDefinitionId: string): DefSubscriptions | undefined
  /** Merge field writes for a record. First `o` wins, last `n` wins per outputKey. */
  recordChange(recordId: RecordId, entries: Record<string, ManifestFieldChange>): void
  /**
   * Record a created id (only captured when the def has lifecycle `created` rules).
   * `values` (raw, systemAttribute-keyed) is stashed for native entity-trigger handlers on
   * the sync door — only when the created id is actually accepted (not truncated).
   */
  recordCreated(recordId: RecordId, values?: Record<string, unknown>): void
  /** Record an archived id (only captured when the def has lifecycle `deleted` rules). */
  recordArchived(recordId: RecordId): void
  /** Serialize; null when nothing was captured. */
  toJson(): SyncChangeManifest | null
}

class RealCollector implements ManifestCollector {
  readonly enabled = true
  private readonly changes = new Map<RecordId, Map<string, ManifestFieldChange>>()
  private readonly created = new Set<RecordId>()
  private readonly createdValues = new Map<RecordId, Record<string, unknown>>()
  private readonly archived = new Set<RecordId>()
  private truncated = false

  constructor(private readonly subs: SyncRuleSubscriptions) {}

  subscriptionsFor(entityDefinitionId: string): DefSubscriptions | undefined {
    return this.subs[entityDefinitionId]
  }

  recordChange(recordId: RecordId, entries: Record<string, ManifestFieldChange>): void {
    const keys = Object.keys(entries)
    if (keys.length === 0) return

    let bucket = this.changes.get(recordId)
    if (!bucket) {
      // Cap only applies to NEW records — updating an already-captured record is free.
      if (this.changes.size >= MAX_CHANGED_RECORDS) {
        this.markTruncated('changed records')
        return
      }
      bucket = new Map()
      this.changes.set(recordId, bucket)
    }

    for (const key of keys) {
      bucket.set(key, mergeFieldChange(bucket.get(key), entries[key]!))
    }
  }

  recordCreated(recordId: RecordId, values?: Record<string, unknown>): void {
    // Stash values only when the id is actually accepted (kept in lockstep with the cap so a
    // truncated create never strands orphan values the consumer can't tie to a created id).
    if (this.addLifecycle(this.created, recordId) && values) {
      this.createdValues.set(recordId, values)
    }
  }

  recordArchived(recordId: RecordId): void {
    this.addLifecycle(this.archived, recordId)
  }

  /** Returns true when the id was newly added (false when a duplicate or capped out). */
  private addLifecycle(set: Set<RecordId>, recordId: RecordId): boolean {
    if (set.has(recordId)) return false
    if (this.created.size + this.archived.size >= MAX_LIFECYCLE_RECORDS) {
      this.markTruncated('lifecycle records')
      return false
    }
    set.add(recordId)
    return true
  }

  private markTruncated(what: string): void {
    if (!this.truncated) {
      this.truncated = true
      logger.warn('Sync-change manifest truncated — cap hit', {
        what,
        changed: this.changes.size,
        lifecycle: this.created.size + this.archived.size,
      })
    }
  }

  toJson(): SyncChangeManifest | null {
    if (this.changes.size === 0 && this.created.size === 0 && this.archived.size === 0) {
      return null
    }
    const changes: SyncChangeManifest['changes'] = {}
    for (const [recordId, bucket] of this.changes) {
      changes[recordId] = Object.fromEntries(bucket)
    }
    return {
      version: 1,
      truncated: this.truncated,
      changes,
      createdRecordIds: [...this.created],
      archivedRecordIds: [...this.archived],
      ...(this.createdValues.size > 0
        ? { createdValues: Object.fromEntries(this.createdValues) }
        : {}),
    }
  }
}

/** Shared no-op used whenever nothing is subscribed. All mutators do nothing. */
const NOOP_COLLECTOR: ManifestCollector = {
  enabled: false,
  subscriptionsFor: () => undefined,
  recordChange: () => {},
  recordCreated: () => {},
  recordArchived: () => {},
  toJson: () => null,
}

/**
 * Merge a later manifest fragment into a base, for folding per-slice manifests into one
 * run row (B2 §3b — the sliced sync-core writes slices as separate jobs). Union changes
 * per RecordId → outputKey with FIRST `o` wins / LAST `n` wins (base is earlier, `add`
 * later), union lifecycle id sets, OR the truncated flags. Enforces the run-level caps
 * (a NEW record/lifecycle id past the cap is dropped and sets `truncated`; updating an
 * already-present record is always free). `base` is invariably ≤ cap (a single slice's
 * `toJson` or a prior merge), so copying it first can never itself overflow. Pure —
 * testable.
 */
export function mergeManifests(
  base: SyncChangeManifest | null | undefined,
  add: SyncChangeManifest | null | undefined
): SyncChangeManifest | null {
  if (!base) return add ?? null
  if (!add) return base

  let truncated = base.truncated || add.truncated

  const changes: SyncChangeManifest['changes'] = {}
  for (const [rid, fields] of Object.entries(base.changes)) {
    changes[rid as keyof typeof changes] = { ...fields }
  }
  for (const [rid, fields] of Object.entries(add.changes)) {
    let bucket = changes[rid as keyof typeof changes]
    if (!bucket) {
      if (Object.keys(changes).length >= MAX_CHANGED_RECORDS) {
        truncated = true
        continue
      }
      bucket = changes[rid as keyof typeof changes] = {}
    }
    for (const [key, entry] of Object.entries(fields)) {
      bucket[key] = mergeFieldChange(bucket[key], entry)
    }
  }

  const created = new Set(base.createdRecordIds)
  const archived = new Set(base.archivedRecordIds)
  for (const rid of add.createdRecordIds) {
    if (created.has(rid)) continue
    if (created.size + archived.size >= MAX_LIFECYCLE_RECORDS) {
      truncated = true
      break
    }
    created.add(rid)
  }
  for (const rid of add.archivedRecordIds) {
    if (archived.has(rid)) continue
    if (created.size + archived.size >= MAX_LIFECYCLE_RECORDS) {
      truncated = true
      break
    }
    archived.add(rid)
  }

  // Union created values (base wins on the rare duplicate), keeping only ids that survived
  // the lifecycle cap above so values never outlive their created id.
  let createdValues: Record<RecordId, Record<string, unknown>> | undefined
  const mergedCreatedValues = { ...add.createdValues, ...base.createdValues }
  for (const [rid, vals] of Object.entries(mergedCreatedValues)) {
    if (!created.has(rid as RecordId)) continue
    if (!createdValues) createdValues = {}
    createdValues[rid as RecordId] = vals
  }

  return {
    version: 1,
    truncated,
    changes,
    createdRecordIds: [...created],
    archivedRecordIds: [...archived],
    ...(createdValues ? { createdValues } : {}),
  }
}

/** Build a collector from a pre-computed subscription index (pure — testable). */
export function createManifestCollector(subs: SyncRuleSubscriptions): ManifestCollector {
  if (Object.keys(subs).length === 0) return NOOP_COLLECTOR
  return new RealCollector(subs)
}

/**
 * Load the org's rule subscriptions from the cache and build a collector. Returns the
 * zero-cost no-op stub when the org has no enabled rules. Lazy-imports the cache +
 * subscriptions helpers to stay clear of the record-rules ↔ cache import cycle.
 */
export async function loadManifestCollector(organizationId: string): Promise<ManifestCollector> {
  const { getCachedRecordRules } = await import('../cache')
  const { getSyncRuleSubscriptions } = await import('./subscriptions')
  const rules = await getCachedRecordRules(organizationId)
  return createManifestCollector(getSyncRuleSubscriptions(rules))
}
