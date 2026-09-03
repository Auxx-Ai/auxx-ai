// apps/web/src/components/resources/store/field-value-fetch-queue.ts

import type { CellSyncInfo } from '@auxx/lib/data-connectors/client'
import type { AiStatus, AiValueMetadata } from '@auxx/lib/realtime/client'
import type { RecordId } from '@auxx/lib/resources/client'
import { fieldRefToKey, isResourceFieldId, type ResourceFieldId } from '@auxx/types/field'
import { generateId } from '@auxx/utils/generateId'
import { buildCanonicalFieldValueKey, canonicalizeFieldRef } from '../utils/canonicalize-field-ref'
import { getNormalizedRecordId, tryNormalizeRecordId } from '../utils/normalize-record-id'
import { ensureCalcValue } from './calc-value-computer'
import { computedFieldRegistry } from './computed-field-registry'
import {
  buildFieldValueKey,
  type FieldReference,
  type FieldValueKey,
  normalizeFieldRef,
  type StoredFieldValue,
  useFieldValueStore,
} from './field-value-store'
import { useResourceStore } from './resource-store'

const BATCH_SIZE = 100
const DEFAULT_DEBOUNCE_MS = 50

/**
 * Function signature for the batch fetch API call.
 */
type FetchFn = (params: { recordIds: RecordId[]; fieldReferences: FieldReference[] }) => Promise<{
  values: Array<{
    recordId: string
    fieldRef: FieldReference
    value: StoredFieldValue
    aiStatus?: AiStatus | null
    aiMetadata?: AiValueMetadata | null
    /** Contributing data-connector sync state (per-cell), null when unbound. */
    sync?: CellSyncInfo | null
  }>
}>

/**
 * Entry in the pending fetch queue.
 */
interface QueueEntry {
  recordId: RecordId
  fieldRef: FieldReference
  key: FieldValueKey
}

/**
 * Singleton fetch queue that batches and deduplicates field value requests.
 * Used by both useFieldValueSyncer (table views) and useFieldValue with autoFetch (single record views).
 *
 * Invariants (hardening plan Parts 4/7):
 * - `pendingByKey` gives O(1) dedupe — no linear scans on enqueue.
 * - Keys are canonical in BOTH halves (RecordId prefix + fieldRef definition
 *   segments) whenever the prefix map can resolve them.
 * - flush() drains per-id: resolvable entries fetch, unresolved entries stay
 *   pending until the prefix map changes (no timer polling).
 * - reset() + generation guard: an org switch discards in-flight results so
 *   they can never write into the next org's stores.
 */
class FieldValueFetchQueue {
  private pendingByKey = new Map<FieldValueKey, QueueEntry>()
  private timeoutId: ReturnType<typeof setTimeout> | null = null
  private fetchFn: FetchFn | null = null
  private debounceMs = DEFAULT_DEBOUNCE_MS
  private generation = 0

  constructor() {
    if (typeof window !== 'undefined') {
      // Re-attempt a flush when prefix mappings change — this is the ONLY
      // wake-up source for entries that were unresolvable at enqueue time.
      useResourceStore.subscribe(
        (s) => s.definitionIdByPrefix,
        () => {
          if (this.pendingByKey.size > 0) this.scheduleFlush()
        }
      )
    }
  }

  /**
   * Set the fetch function (called once when tRPC client is available).
   */
  setFetchFn(fn: FetchFn) {
    this.fetchFn = fn
    if (this.pendingByKey.size > 0) this.scheduleFlush()
  }

  /**
   * Configure debounce delay.
   */
  setDebounceMs(ms: number) {
    this.debounceMs = ms
  }

  /**
   * Cancel pending work and invalidate in-flight requests. Called from
   * `clearResourceCaches()` on logout/org switch, BEFORE stores are cleared.
   */
  reset() {
    if (this.timeoutId) {
      clearTimeout(this.timeoutId)
      this.timeoutId = null
    }
    this.pendingByKey.clear()
    this.generation++
  }

  /**
   * Queue a fetch request. Will be batched and deduplicated automatically.
   * Returns true if the request was queued, false if already loading/cached.
   * For computed fields (CALC, NAME), queues source fields instead since values are computed client-side.
   */
  queueFetch(rawRecordId: RecordId, rawFieldRef: FieldReference): boolean {
    // Canonicalize BOTH halves (no-op for unresolvable prefixes pre-hydration;
    // the flush drain re-keys those before they ever hit the network).
    const {
      recordId,
      fieldRef: normalizedRef,
      key,
    } = buildCanonicalFieldValueKey(rawRecordId, rawFieldRef)

    // Check if this is a computed field (CALC, NAME) — decompose into source fields
    if (
      typeof normalizedRef === 'string' &&
      computedFieldRegistry.isComputed(normalizedRef as ResourceFieldId)
    ) {
      const config = computedFieldRegistry.getConfig(normalizedRef as ResourceFieldId)
      if (config) {
        // Queue source fields instead of the computed field itself
        let queued = false
        for (const sourceFieldId of Object.values(config.sourceFields)) {
          if (this.queueFetch(recordId, sourceFieldId)) {
            queued = true
          }
        }
        // Nothing queued means no source arrival will ever trigger a compute
        // (zero-source literal formula, or every source already cached) —
        // compute now from store state. ensureCalcValue no-ops while sources
        // are still in flight from an earlier batch.
        if (!queued) {
          this.ensureComputedValue(recordId, normalizedRef as ResourceFieldId)
        }
        return queued
      }
    }

    const store = useFieldValueStore.getState()

    // Skip if already in store, already being fetched, or already pending
    if (key in store.values || store.isKeyFetching(key)) {
      return false
    }
    if (this.pendingByKey.has(key)) {
      return false
    }

    this.pendingByKey.set(key, { recordId, fieldRef: normalizedRef, key })

    // Mark as fetching immediately - this triggers skeleton in cells
    store.markFetching([key])

    this.scheduleFlush()
    return true
  }

  /**
   * Queue multiple fetch requests at once (more efficient than individual calls).
   * Decomposes computed fields (CALC, NAME) into their source field fetches.
   * Normalizes each unique RecordId and fieldRef ONCE per batch — cost scales
   * with unique inputs, not record×field combinations.
   */
  queueFetchBatch(
    requests: Array<{ recordId: RecordId; fieldRef: FieldReference }>
  ): FieldValueKey[] {
    const store = useFieldValueStore.getState()
    const queued: FieldValueKey[] = []

    // Per-batch normalization caches
    const recordIdCache = new Map<RecordId, RecordId>()
    const refCache = new Map<string, { ref: FieldReference; refKey: string }>()

    const normalizeRecordIdCached = (raw: RecordId): RecordId => {
      let normalized = recordIdCache.get(raw)
      if (normalized === undefined) {
        normalized = getNormalizedRecordId(raw)
        recordIdCache.set(raw, normalized)
      }
      return normalized
    }

    for (const { recordId: rawRecordId, fieldRef: rawFieldRef } of requests) {
      const recordId = normalizeRecordIdCached(rawRecordId)

      // Canonicalize the ref once per unique (recordId-independent) reference.
      // Plain FieldIds depend on the record prefix, so key those by record too.
      const rawRefKey =
        typeof rawFieldRef === 'string' && !isResourceFieldId(rawFieldRef)
          ? `${recordId}|${rawFieldRef}`
          : fieldRefToKey(rawFieldRef)
      let cached = refCache.get(rawRefKey)
      if (!cached) {
        const ref = canonicalizeFieldRef(normalizeFieldRef(recordId, rawFieldRef))
        cached = { ref, refKey: fieldRefToKey(ref) }
        refCache.set(rawRefKey, cached)
      }
      const normalizedRef = cached.ref

      // Decompose computed fields (CALC, NAME) into source fields
      if (
        typeof normalizedRef === 'string' &&
        computedFieldRegistry.isComputed(normalizedRef as ResourceFieldId)
      ) {
        const config = computedFieldRegistry.getConfig(normalizedRef as ResourceFieldId)
        if (config) {
          let queuedForCalc = false
          for (const sourceFieldId of Object.values(config.sourceFields)) {
            const sourceRef = normalizeFieldRef(recordId, sourceFieldId)
            const sourceKey = `${recordId}:${fieldRefToKey(sourceRef)}` as FieldValueKey
            if (sourceKey in store.values || store.isKeyFetching(sourceKey)) continue
            if (this.pendingByKey.has(sourceKey)) continue
            this.pendingByKey.set(sourceKey, {
              recordId,
              fieldRef: sourceRef,
              key: sourceKey,
            })
            queued.push(sourceKey)
            queuedForCalc = true
          }
          // No source arrival will trigger a compute — compute now from
          // store state (zero-source formula or all sources cached).
          if (!queuedForCalc) {
            this.ensureComputedValue(recordId, normalizedRef as ResourceFieldId)
          }
          continue // Skip the computed field itself
        }
      }

      const key = `${recordId}:${cached.refKey}` as FieldValueKey

      // Skip if already in store, already being fetched, or already pending
      if (key in store.values || store.isKeyFetching(key)) continue
      if (this.pendingByKey.has(key)) continue

      this.pendingByKey.set(key, { recordId, fieldRef: normalizedRef, key })
      queued.push(key)
    }

    if (queued.length > 0) {
      // Mark as fetching immediately - this triggers skeleton in cells
      store.markFetching(queued)
      this.scheduleFlush()
    }

    return queued
  }

  /**
   * Compute a CALC/NAME value directly from store state when decomposition
   * queued no source fetches — without this, zero-source formulas and
   * calc columns whose sources are already cached never get a value.
   */
  private ensureComputedValue(recordId: RecordId, calcFieldId: ResourceFieldId) {
    const key = buildFieldValueKey(recordId, calcFieldId)
    if (key in useFieldValueStore.getState().values) return
    ensureCalcValue(recordId, calcFieldId)
  }

  /**
   * Schedule a flush of the pending queue. Only ever one timer; wake-up
   * sources are: new entries, the prefix map changing, and setFetchFn.
   */
  private scheduleFlush() {
    if (this.timeoutId) {
      clearTimeout(this.timeoutId)
    }

    this.timeoutId = setTimeout(() => {
      this.timeoutId = null
      this.flush()
    }, this.debounceMs)
  }

  /**
   * Flush the pending queue - executes the batch fetch for every entry whose
   * RecordId prefix is resolvable. Unresolved entries stay pending (released
   * by the prefix-map subscription). Entries queued before their mapping
   * existed are re-keyed here — BOTH halves — in one pass.
   */
  private async flush() {
    if (!this.fetchFn || this.pendingByKey.size === 0) return

    const store = useFieldValueStore.getState()

    // Drain resolvable entries, re-keying pre-hydration aliases. Duplicates
    // introduced by re-keying collapse into the toFetch map.
    const toFetch = new Map<FieldValueKey, QueueEntry>()
    const staleKeys: FieldValueKey[] = []
    const rekeyedKeys: FieldValueKey[] = []

    for (const [key, entry] of this.pendingByKey) {
      const canonicalRecordId = tryNormalizeRecordId(entry.recordId)
      if (!canonicalRecordId) continue // unresolved — stays pending

      this.pendingByKey.delete(key)

      let next = entry
      if (canonicalRecordId !== entry.recordId) {
        // The prefix map learned this alias after enqueue — rewrite the
        // RecordId half AND the fieldRef definition segments.
        const fieldRef = canonicalizeFieldRef(normalizeFieldRef(canonicalRecordId, entry.fieldRef))
        const newKey = `${canonicalRecordId}:${fieldRefToKey(fieldRef)}` as FieldValueKey
        staleKeys.push(key)
        if (!(newKey in store.values)) rekeyedKeys.push(newKey)
        next = { recordId: canonicalRecordId, fieldRef, key: newKey }
      }

      // Merge duplicates; skip keys that already have a value in store
      // (arrived via realtime/hydration while queued) — clear their marker.
      if (next.key in store.values) {
        if (next === entry) staleKeys.push(key)
        continue
      }
      if (!toFetch.has(next.key)) toFetch.set(next.key, next)
    }

    // Swap stale alias markers for canonical ones in ONE store update.
    if (staleKeys.length > 0 || rekeyedKeys.length > 0) {
      store.replaceFetching(staleKeys, rekeyedKeys)
    }

    if (toFetch.size === 0) return

    await this.fetchEntries([...toFetch.values()])
  }

  /**
   * Force-refresh cells the store ALREADY holds — the realtime catch-up path.
   *
   * `queueFetch*` deliberately skips keys that are already cached, and the
   * subscriber hooks dedupe per key for the lifetime of the mount
   * (`requestedRef` in `useFieldCellState`, `queuedKeyRef` in `useFieldValues`),
   * so simply dropping values from the store does NOT get them re-fetched.
   * This bypasses both skips and overwrites in place via `setValues` — no
   * clearing, so no cell ever blanks to a skeleton while the refresh is in
   * flight.
   *
   * Computed refs (CALC/NAME) are decomposed into their source fields: the
   * server has no value for them, and the null-backfill below would otherwise
   * wipe a locally-computed value.
   */
  async refetch(requests: Array<{ recordId: RecordId; fieldRef: FieldReference }>): Promise<void> {
    if (!this.fetchFn || requests.length === 0) return

    const entries = new Map<FieldValueKey, QueueEntry>()

    for (const request of requests) {
      const { recordId, fieldRef, key } = buildCanonicalFieldValueKey(
        request.recordId,
        request.fieldRef
      )
      if (!tryNormalizeRecordId(recordId)) continue // unresolvable prefix — nothing to refresh
      if (
        typeof fieldRef === 'string' &&
        computedFieldRegistry.isComputed(fieldRef as ResourceFieldId)
      ) {
        const config = computedFieldRegistry.getConfig(fieldRef as ResourceFieldId)
        if (!config) continue
        for (const sourceFieldId of Object.values(config.sourceFields)) {
          const sourceRef = normalizeFieldRef(recordId, sourceFieldId as ResourceFieldId)
          const sourceKey = `${recordId}:${fieldRefToKey(sourceRef)}` as FieldValueKey
          entries.set(sourceKey, { recordId, fieldRef: sourceRef, key: sourceKey })
        }
        continue
      }
      entries.set(key, { recordId, fieldRef, key })
    }
    if (entries.size === 0) return

    await this.fetchEntries([...entries.values()], { silent: true })
  }

  /**
   * Run the network half for a resolved set of entries and merge the result.
   *
   * `silent` is the catch-up mode: no loading/fetching markers (the store
   * already has displayable values, so cells must not fall back to skeletons),
   * and the null-backfill applies even to keys that currently hold a value —
   * a cell cleared server-side while we were unsubscribed has to clear here too.
   */
  private async fetchEntries(
    entriesToFetch: QueueEntry[],
    { silent = false }: { silent?: boolean } = {}
  ) {
    const generation = this.generation
    const keys = entriesToFetch.map((e) => e.key)
    const batchId = generateId('batch')

    // Mark as loading
    if (!silent) useFieldValueStore.getState().startLoading(batchId, keys)

    // Group by unique recordIds and fieldRefs (stable keys, no JSON round-trip)
    const recordIds = [...new Set(entriesToFetch.map((e) => e.recordId))]
    const fieldRefsByKey = new Map<string, FieldReference>()
    for (const entry of entriesToFetch) {
      // entry.fieldRef is always normalized at enqueue — key it directly
      const refKey = fieldRefToKey(entry.fieldRef)
      if (!fieldRefsByKey.has(refKey)) fieldRefsByKey.set(refKey, entry.fieldRef)
    }
    const fieldRefs = [...fieldRefsByKey.values()]

    try {
      // Chunk recordIds to avoid API limits
      const chunks = this.chunkArray(recordIds, BATCH_SIZE)

      const results = await Promise.allSettled(
        chunks.map((chunkRecordIds) =>
          this.fetchFn!({
            recordIds: chunkRecordIds,
            fieldReferences: fieldRefs,
          })
        )
      )

      // Org switched while in flight — discard entirely; the new org's stores
      // must never receive this generation's values or markers.
      if (generation !== this.generation) return

      // Build entries map from results
      const entriesMap = new Map<FieldValueKey, StoredFieldValue>()
      const aiEntries: Array<{
        key: FieldValueKey
        aiStatus: AiStatus
        aiMetadata: AiValueMetadata | null
      }> = []
      // Contributing data-connector sync states to rehydrate (mirrors aiEntries).
      const syncByKey = new Map<FieldValueKey, CellSyncInfo>()
      for (const result of results) {
        if (result.status === 'fulfilled') {
          for (const v of result.value.values) {
            const key = buildFieldValueKey(v.recordId as RecordId, v.fieldRef)
            entriesMap.set(key, v.value)
            if (v.aiStatus != null) {
              aiEntries.push({ key, aiStatus: v.aiStatus, aiMetadata: v.aiMetadata ?? null })
            }
            if (v.sync != null) {
              syncByKey.set(key, v.sync)
            }
          }
        } else {
          console.warn('[FieldValueFetchQueue] Chunk fetch failed:', result.reason)
        }
      }

      // Compute all requested combinations (server evaluates the cross
      // product, so null-backfill must cover it too)
      const allRequestedCombinations = new Set<FieldValueKey>()
      for (const recordId of recordIds) {
        for (const fieldRef of fieldRefs) {
          allRequestedCombinations.add(buildFieldValueKey(recordId, fieldRef))
        }
      }

      // Merge results, preserving existing values
      const { values: currentValues } = useFieldValueStore.getState()
      const entries: Array<{ key: FieldValueKey; value: StoredFieldValue }> = []
      for (const key of allRequestedCombinations) {
        const apiValue = entriesMap.get(key)
        if (apiValue !== undefined) {
          entries.push({ key, value: apiValue })
        } else if (silent || !(key in currentValues) || currentValues[key] === undefined) {
          // Silent (catch-up) mode nulls a key the server no longer has a value
          // for — that IS the missed clear. The normal path skips keys that
          // already hold a value.
          entries.push({ key, value: null })
        }
      }

      useFieldValueStore.getState().setValues(entries)

      // Rehydrate AI markers so sparkle badges survive refresh.
      const setAiState = useFieldValueStore.getState().setAiState
      for (const entry of aiEntries) {
        setAiState(entry.key, entry.aiStatus, entry.aiMetadata)
      }

      // Rehydrate contributing data-connector sync states so the cell badge
      // survives refresh. The response is AUTHORITATIVE over the whole requested
      // cross product — the server emits `sync` even for cells with no stored
      // row — so a combination it stayed silent on clears its badge rather than
      // keeping a state the last sync run has since ended.
      const setManagedState = useFieldValueStore.getState().setManagedState
      for (const key of allRequestedCombinations) {
        setManagedState(key, syncByKey.get(key) ?? null)
      }
    } catch (error) {
      console.error('[FieldValueFetchQueue] Fetch failed:', error)
    } finally {
      if (!silent && generation === this.generation) {
        useFieldValueStore.getState().finishLoading(batchId)
      }
    }
  }

  /**
   * Split an array into chunks of specified size.
   */
  private chunkArray<T>(array: T[], size: number): T[][] {
    const chunks: T[][] = []
    for (let i = 0; i < array.length; i += size) {
      chunks.push(array.slice(i, i + size))
    }
    return chunks
  }
}

/** Singleton instance */
export const fieldValueFetchQueue = new FieldValueFetchQueue()
