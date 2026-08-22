// packages/lib/src/record-rules/sync-manifest-collector.ts
// Run/slice-scoped accumulator for a sync-change manifest (v2, plan 07 §3). Two tiers:
// tier-1 membership (touched records + lifecycle) is captured UNCONDITIONALLY for every
// sync session — the collector is always real, there is no no-op stub anymore. Tier-2
// deltas stay gated on rule subscriptions via `subscriptionsFor` (empty subscriptions ⇒
// undefined for every def ⇒ the engine seams never capture values, at zero cost).
// See plans/events/07-two-tier-sync-capture-plan.md.

import { createScopedLogger } from '@auxx/logger'
import { parseRecordId, type RecordId } from '@auxx/types/resource'
import type { DefSubscriptions, SyncRuleSubscriptions } from './subscriptions'
import type {
  ManifestFieldChange,
  SyncChangeManifest,
  SyncChangeManifestV1,
} from './sync-manifest-types'

const logger = createScopedLogger('sync-manifest')

/**
 * ONE membership cap across `touched ∪ created ∪ archived` (by entity instance id).
 * Only overflowing THIS sets `membershipTruncated` — which forces the large lane and
 * the tier-3 fallback downstream. Enforced per-collector AND across `mergeManifests`.
 */
export const MAX_TOUCHED_RECORDS = 50_000

/**
 * Approximate byte budget for stored touched keys (sum of key lengths). Past it, NEW
 * touched entries degrade to the ids-only marker `1` instead of a key list; existing
 * entries keep their keys. Ids-only membership still drives activity, dispatch tally,
 * dedup, and tier-2 frames — only the key-needing doors degrade per record.
 */
export const TOUCHED_KEYS_BYTE_BUDGET = 2_000_000

/**
 * Tier-2 cap: distinct records carrying deltas (v1's changed-records cap, renamed).
 * Overflow sets `detailTruncated` ONLY — membership for the record is still recorded.
 */
export const MAX_DELTA_RECORDS = 5_000

/** Collector caps — constructor-injectable so tests can exercise overflow cheaply. */
export interface ManifestCollectorCaps {
  maxTouchedRecords: number
  touchedKeysByteBudget: number
  maxDeltaRecords: number
}

const DEFAULT_CAPS: ManifestCollectorCaps = {
  maxTouchedRecords: MAX_TOUCHED_RECORDS,
  touchedKeysByteBudget: TOUCHED_KEYS_BYTE_BUDGET,
  maxDeltaRecords: MAX_DELTA_RECORDS,
}

/**
 * Union one outputKey's change entries: the FIRST fragment's `o`-state wins (value AND
 * absence), last `n` wins. Shared by the in-memory collector (same record written twice
 * in a slice) and `mergeManifests` (folding slices into the run row) so the two merge
 * semantics can never diverge.
 *
 * `o`-absence is meaningful: creates capture `{n}` with NO `o` (the engine's delta
 * seams probe `hasCreated`), updates always capture `o` (null when the field was
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
 * Accumulates tier-1 membership + tier-2 deltas for one run/slice. Always real — every
 * mutator captures. Tier-2 gating lives at the engine seams via `subscriptionsFor`.
 *
 * All mutators are cheap: Map/Set pushes only, no queries.
 */
export interface ManifestCollector {
  /** Subscription buckets for a def, or undefined when nothing is subscribed for it. */
  subscriptionsFor(entityDefinitionId: string): DefSubscriptions | undefined
  /**
   * Tier 1: record that a write actually changed `recordId`, with the changed field
   * output keys. Merges keys per record (set union). Membership + keys are deduped on
   * the entity INSTANCE id, not the RecordId string — the same instance captured under
   * a slug-keyed and a CUID-keyed RecordId folds to one entry (first-seen form wins).
   */
  recordTouched(recordId: RecordId, keys: string[]): void
  /**
   * Tier 2: merge `{o, n}` field deltas for a record. First `o` wins, last `n` wins per
   * outputKey. A delta implies touched — membership + keys are recorded even when the
   * delta cap has overflowed.
   */
  recordChange(recordId: RecordId, entries: Record<string, ManifestFieldChange>): void
  /**
   * Record a created id — UNCONDITIONAL membership (no lifecycle-rule gating). `values`
   * (raw, systemAttribute-keyed) is stashed for native entity-trigger handlers on the
   * sync door — only when the created id is actually accepted (not capped out).
   */
  recordCreated(recordId: RecordId, values?: Record<string, unknown>): void
  /**
   * Cheap membership probe (dedupes on the entity instance id like everything else):
   * was this record already captured as created THIS run? The engine's tier-2 delta
   * seams consult it so a field write composing a create emits `{n}` with NO `o` —
   * `o`-absence is the manifest's "created this run" marker (see `mergeFieldChange`),
   * and even an `o: null` grafted onto a created record's field would break the fold.
   */
  hasCreated(recordId: RecordId): boolean
  /** Record an archived id — UNCONDITIONAL membership (no lifecycle-rule gating). */
  recordArchived(recordId: RecordId): void
  /** Serialize; null when literally nothing was captured. */
  toJson(): SyncChangeManifest | null
}

/** Internal touched entry: first-seen RecordId form + keys (or the ids-only marker). */
interface TouchedEntry {
  rid: RecordId
  keys: Set<string> | 1
}

/**
 * The accumulation core, shared by the collector and `mergeManifests` so in-slice and
 * cross-slice folding can never diverge. All state is keyed by entity INSTANCE id
 * (parseRecordId) to defeat the dual-keyspace trap (slug-keyed import RecordIds vs
 * CUID-keyed engine RecordIds for the same record — plan 04 §11.2).
 */
class ManifestAccumulator {
  /** instanceId → touched entry. */
  private readonly touched = new Map<string, TouchedEntry>()
  /** instanceId → delta bucket. */
  private readonly deltas = new Map<
    string,
    { rid: RecordId; fields: Map<string, ManifestFieldChange> }
  >()
  /** instanceId → first-seen RecordId form. */
  private readonly created = new Map<string, RecordId>()
  private readonly archived = new Map<string, RecordId>()
  /** instanceId → raw create values (emitted under the created RecordId form). */
  private readonly createdValues = new Map<string, Record<string, unknown>>()
  /** Membership union (touched ∪ created ∪ archived) by instanceId — the ONE cap. */
  private readonly membership = new Set<string>()
  private keysBytes = 0
  private detailTruncated = false
  private membershipTruncated = false

  constructor(private readonly caps: ManifestCollectorCaps) {}

  /** True when `instanceId` is (or just became) a member; false when capped out. */
  private admitMember(instanceId: string): boolean {
    if (this.membership.has(instanceId)) return true
    if (this.membership.size >= this.caps.maxTouchedRecords) {
      if (!this.membershipTruncated) {
        this.membershipTruncated = true
        logger.warn('Sync-change manifest MEMBERSHIP truncated — cap hit', {
          cap: this.caps.maxTouchedRecords,
        })
      }
      return false
    }
    this.membership.add(instanceId)
    return true
  }

  recordTouched(recordId: RecordId, keys: string[]): void {
    const instanceId = parseRecordId(recordId).entityInstanceId
    if (!this.admitMember(instanceId)) return
    let entry = this.touched.get(instanceId)
    if (!entry) {
      entry = {
        rid: recordId,
        keys: this.keysBytes >= this.caps.touchedKeysByteBudget ? 1 : new Set(),
      }
      this.touched.set(instanceId, entry)
    }
    if (entry.keys === 1) return
    for (const key of keys) {
      if (!entry.keys.has(key)) {
        entry.keys.add(key)
        this.keysBytes += key.length
      }
    }
  }

  /** Fold in an ids-only touched entry (`1` wins downward — once ids-only, stays so). */
  degradeTouched(recordId: RecordId): void {
    const instanceId = parseRecordId(recordId).entityInstanceId
    if (!this.admitMember(instanceId)) return
    const entry = this.touched.get(instanceId)
    if (!entry) {
      this.touched.set(instanceId, { rid: recordId, keys: 1 })
      return
    }
    if (entry.keys !== 1) {
      for (const key of entry.keys) this.keysBytes -= key.length
      entry.keys = 1
    }
  }

  recordChange(recordId: RecordId, entries: Record<string, ManifestFieldChange>): void {
    const keys = Object.keys(entries)
    if (keys.length === 0) return

    // A delta implies touched — membership first, unconditionally.
    this.recordTouched(recordId, keys)

    const instanceId = parseRecordId(recordId).entityInstanceId
    let bucket = this.deltas.get(instanceId)
    if (!bucket) {
      // Cap only applies to NEW records — updating an already-captured record is free.
      if (this.deltas.size >= this.caps.maxDeltaRecords) {
        if (!this.detailTruncated) {
          this.detailTruncated = true
          logger.warn('Sync-change manifest DETAIL truncated — delta cap hit', {
            cap: this.caps.maxDeltaRecords,
          })
        }
        return
      }
      bucket = { rid: recordId, fields: new Map() }
      this.deltas.set(instanceId, bucket)
    }
    for (const key of keys) {
      bucket.fields.set(key, mergeFieldChange(bucket.fields.get(key), entries[key]!))
    }
  }

  recordCreated(recordId: RecordId, values?: Record<string, unknown>): void {
    const instanceId = parseRecordId(recordId).entityInstanceId
    if (this.created.has(instanceId)) return
    if (!this.admitMember(instanceId)) return
    this.created.set(instanceId, recordId)
    // Stash values only when the id is actually accepted (kept in lockstep with the cap
    // so a capped create never strands orphan values the consumer can't tie to an id).
    if (values) this.createdValues.set(instanceId, values)
  }

  recordArchived(recordId: RecordId): void {
    const instanceId = parseRecordId(recordId).entityInstanceId
    if (this.archived.has(instanceId)) return
    if (!this.admitMember(instanceId)) return
    this.archived.set(instanceId, recordId)
  }

  hasCreated(recordId: RecordId): boolean {
    return this.created.has(parseRecordId(recordId).entityInstanceId)
  }

  /** Fold a v2 manifest in (earlier fragments first — first `o` wins, last `n` wins). */
  ingest(m: SyncChangeManifest): void {
    for (const [rid, keys] of Object.entries(m.touched) as [RecordId, string[] | 1][]) {
      if (keys === 1) this.degradeTouched(rid)
      else this.recordTouched(rid, keys)
    }
    for (const [rid, fields] of Object.entries(m.deltas) as [
      RecordId,
      Record<string, ManifestFieldChange>,
    ][]) {
      this.recordChange(rid, fields)
    }
    for (const rid of m.createdRecordIds) this.recordCreated(rid, m.createdValues?.[rid])
    for (const rid of m.archivedRecordIds) this.recordArchived(rid)
    this.detailTruncated = this.detailTruncated || m.detailTruncated
    this.membershipTruncated = this.membershipTruncated || m.membershipTruncated
  }

  toJson(): SyncChangeManifest | null {
    if (
      this.touched.size === 0 &&
      this.deltas.size === 0 &&
      this.created.size === 0 &&
      this.archived.size === 0 &&
      !this.detailTruncated &&
      !this.membershipTruncated
    ) {
      return null
    }
    const touched: SyncChangeManifest['touched'] = {}
    for (const entry of this.touched.values()) {
      touched[entry.rid] = entry.keys === 1 ? 1 : [...entry.keys]
    }
    const deltas: SyncChangeManifest['deltas'] = {}
    for (const bucket of this.deltas.values()) {
      deltas[bucket.rid] = Object.fromEntries(bucket.fields)
    }
    let createdValues: SyncChangeManifest['createdValues']
    for (const [instanceId, values] of this.createdValues) {
      const rid = this.created.get(instanceId)
      if (!rid) continue
      if (!createdValues) createdValues = {}
      createdValues[rid] = values
    }
    return {
      version: 2,
      detailTruncated: this.detailTruncated,
      membershipTruncated: this.membershipTruncated,
      touched,
      deltas,
      createdRecordIds: [...this.created.values()],
      archivedRecordIds: [...this.archived.values()],
      ...(createdValues ? { createdValues } : {}),
    }
  }
}

class RealCollector implements ManifestCollector {
  private readonly acc: ManifestAccumulator

  constructor(
    private readonly subs: SyncRuleSubscriptions,
    caps: ManifestCollectorCaps
  ) {
    this.acc = new ManifestAccumulator(caps)
  }

  subscriptionsFor(entityDefinitionId: string): DefSubscriptions | undefined {
    return this.subs[entityDefinitionId]
  }

  recordTouched(recordId: RecordId, keys: string[]): void {
    this.acc.recordTouched(recordId, keys)
  }

  recordChange(recordId: RecordId, entries: Record<string, ManifestFieldChange>): void {
    this.acc.recordChange(recordId, entries)
  }

  recordCreated(recordId: RecordId, values?: Record<string, unknown>): void {
    this.acc.recordCreated(recordId, values)
  }

  recordArchived(recordId: RecordId): void {
    this.acc.recordArchived(recordId)
  }

  hasCreated(recordId: RecordId): boolean {
    return this.acc.hasCreated(recordId)
  }

  toJson(): SyncChangeManifest | null {
    return this.acc.toJson()
  }
}

/**
 * Derive a v2 manifest from a v1 run row written before the v2 deploy: `touched` from
 * each `changes` bucket's key list, `deltas` = `changes` verbatim, `detailTruncated` =
 * `truncated`, `membershipTruncated` = false (v1 never tracked membership overflow),
 * lifecycle arrays copied. Pure. Delete with `SyncChangeManifestV1` after one release.
 */
export function upgradeManifestV1(m: SyncChangeManifestV1): SyncChangeManifest {
  const touched: SyncChangeManifest['touched'] = {}
  for (const [rid, fields] of Object.entries(m.changes)) {
    touched[rid as RecordId] = Object.keys(fields)
  }
  return {
    version: 2,
    detailTruncated: m.truncated,
    membershipTruncated: false,
    touched,
    deltas: m.changes,
    createdRecordIds: [...m.createdRecordIds],
    archivedRecordIds: [...m.archivedRecordIds],
    ...(m.createdValues ? { createdValues: m.createdValues } : {}),
  }
}

function asV2(m: SyncChangeManifest | SyncChangeManifestV1): SyncChangeManifest {
  return m.version === 2 ? m : upgradeManifestV1(m)
}

/**
 * Merge a later manifest fragment into a base, for folding per-slice manifests into one
 * run row (the sliced sync-core writes slices as separate jobs). Runs both fragments
 * through the same accumulator the collector uses, so the two merge semantics can never
 * diverge: touched key-sets union (the ids-only marker `1` wins downward), deltas fold
 * with FIRST `o` wins / LAST `n` wins (base is earlier, `add` later), lifecycle ids
 * union, truncation flags OR. Everything is deduped on the entity instance id, and the
 * same caps apply across the fold (an N-slice run cannot accumulate N × cap into one
 * row). Accepts v1 fragments and upgrades them first. Pure — testable.
 *
 * @param caps Test-only override of the run-level caps.
 */
export function mergeManifests(
  base: SyncChangeManifest | SyncChangeManifestV1 | null | undefined,
  add: SyncChangeManifest | SyncChangeManifestV1 | null | undefined,
  caps?: Partial<ManifestCollectorCaps>
): SyncChangeManifest | null {
  if (!base) return add ? asV2(add) : null
  if (!add) return asV2(base)
  const acc = new ManifestAccumulator({ ...DEFAULT_CAPS, ...caps })
  acc.ingest(asV2(base))
  acc.ingest(asV2(add))
  return acc.toJson()
}

/**
 * Build a collector from a pre-computed subscription index (pure — testable). Always
 * returns a real collector: tier-1 membership is unconditional; empty subscriptions
 * only mean `subscriptionsFor` answers undefined for every def, so tier-2 delta
 * capture never happens, at zero cost.
 *
 * @param caps Test-only override of the capture caps.
 */
export function createManifestCollector(
  subs: SyncRuleSubscriptions,
  caps?: Partial<ManifestCollectorCaps>
): ManifestCollector {
  return new RealCollector(subs, { ...DEFAULT_CAPS, ...caps })
}

/**
 * Load the org's rule subscriptions from the cache and build a collector. Always real
 * (see `createManifestCollector`). Lazy-imports the cache + subscriptions helpers to
 * stay clear of the record-rules ↔ cache import cycle.
 */
export async function loadManifestCollector(organizationId: string): Promise<ManifestCollector> {
  const { getCachedRecordRules } = await import('../cache')
  const { getSyncRuleSubscriptions } = await import('./subscriptions')
  const rules = await getCachedRecordRules(organizationId)
  return createManifestCollector(getSyncRuleSubscriptions(rules))
}
