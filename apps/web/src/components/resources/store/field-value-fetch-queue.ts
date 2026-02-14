// apps/web/src/components/resources/store/field-value-fetch-queue.ts

import type { RecordId } from '@auxx/lib/resources/client'
import type { ResourceFieldId } from '@auxx/types/field'
import { generateId } from '@auxx/utils/generateId'
import { computedFieldRegistry } from './computed-field-registry'
import {
  buildFieldValueKey,
  type FieldReference,
  type FieldValueKey,
  normalizeFieldRef,
  type StoredFieldValue,
  useFieldValueStore,
} from './field-value-store'

const BATCH_SIZE = 100
const DEFAULT_DEBOUNCE_MS = 50

/**
 * Function signature for the batch fetch API call.
 */
type FetchFn = (params: { recordIds: RecordId[]; fieldReferences: FieldReference[] }) => Promise<{
  values: Array<{ recordId: string; fieldRef: FieldReference; value: StoredFieldValue }>
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
 */
class FieldValueFetchQueue {
  private pending: QueueEntry[] = []
  private timeoutId: ReturnType<typeof setTimeout> | null = null
  private fetchFn: FetchFn | null = null
  private debounceMs = DEFAULT_DEBOUNCE_MS

  /**
   * Set the fetch function (called once when tRPC client is available).
   */
  setFetchFn(fn: FetchFn) {
    this.fetchFn = fn
  }

  /**
   * Configure debounce delay.
   */
  setDebounceMs(ms: number) {
    this.debounceMs = ms
  }

  /**
   * Queue a fetch request. Will be batched and deduplicated automatically.
   * Returns true if the request was queued, false if already loading/cached.
   * For CALC fields, queues source fields instead since CALC values are computed client-side.
   */
  queueFetch(recordId: RecordId, fieldRef: FieldReference): boolean {
    // Check if this is a CALC field (only for string fieldRefs, not paths)
    if (
      typeof fieldRef === 'string' &&
      computedFieldRegistry.isComputed(fieldRef as ResourceFieldId)
    ) {
      const config = computedFieldRegistry.getConfig(fieldRef as ResourceFieldId)
      if (config) {
        // Queue source fields instead of the CALC field itself
        let queued = false
        for (const sourceFieldId of Object.values(config.sourceFields)) {
          if (this.queueFetch(recordId, sourceFieldId)) {
            queued = true
          }
        }
        return queued
      }
    }

    const key = buildFieldValueKey(recordId, fieldRef)
    const store = useFieldValueStore.getState()

    // Skip if already in store or already being fetched
    if (key in store.values || store.isKeyFetching(key)) {
      return false
    }

    // Skip if already in pending queue
    if (this.pending.some((e) => e.key === key)) {
      return false
    }

    // Normalize fieldRef to ResourceFieldId or FieldPath for API
    const normalizedRef = normalizeFieldRef(recordId, fieldRef)
    this.pending.push({ recordId, fieldRef: normalizedRef, key })

    // Mark as fetching immediately - this triggers skeleton in cells
    store.markFetching([key])

    this.scheduleFlush()
    return true
  }

  /**
   * Queue multiple fetch requests at once (more efficient than individual calls).
   */
  queueFetchBatch(
    requests: Array<{ recordId: RecordId; fieldRef: FieldReference }>
  ): FieldValueKey[] {
    const store = useFieldValueStore.getState()
    const queued: FieldValueKey[] = []

    for (const { recordId, fieldRef } of requests) {
      const key = buildFieldValueKey(recordId, fieldRef)

      // Skip if already in store or already being fetched
      if (key in store.values || store.isKeyFetching(key)) continue
      if (this.pending.some((e) => e.key === key)) continue

      // Normalize fieldRef to ResourceFieldId or FieldPath for API
      const normalizedRef = normalizeFieldRef(recordId, fieldRef)
      this.pending.push({ recordId, fieldRef: normalizedRef, key })
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
   * Schedule a flush of the pending queue.
   */
  private scheduleFlush() {
    if (this.timeoutId) {
      clearTimeout(this.timeoutId)
    }

    this.timeoutId = setTimeout(() => {
      this.flush()
    }, this.debounceMs)
  }

  /**
   * Flush the pending queue - executes the batch fetch.
   */
  private async flush() {
    if (!this.fetchFn || this.pending.length === 0) return

    // Take current pending and clear
    const toFetch = [...this.pending]
    this.pending = []
    this.timeoutId = null

    const keys = toFetch.map((e) => e.key)
    const batchId = generateId('batch')

    // Mark as loading
    useFieldValueStore.getState().startLoading(batchId, keys)

    // Group by unique recordIds and fieldRefs
    const recordIds = [...new Set(toFetch.map((e) => e.recordId))]
    const fieldRefs = [...new Set(toFetch.map((e) => JSON.stringify(e.fieldRef)))].map(
      (s) => JSON.parse(s) as FieldReference
    )

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

      // Build entries map from results
      const entriesMap = new Map<FieldValueKey, StoredFieldValue>()
      for (const result of results) {
        if (result.status === 'fulfilled') {
          for (const v of result.value.values) {
            const key = buildFieldValueKey(v.recordId as RecordId, v.fieldRef)
            entriesMap.set(key, v.value)
          }
        } else {
          console.warn('[FieldValueFetchQueue] Chunk fetch failed:', result.reason)
        }
      }

      // Compute all requested combinations
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
        } else if (!(key in currentValues) || currentValues[key] === undefined) {
          entries.push({ key, value: null })
        }
        // Skip keys that already have values in store
      }

      useFieldValueStore.getState().setValues(entries)
    } catch (error) {
      console.error('[FieldValueFetchQueue] Fetch failed:', error)
    } finally {
      useFieldValueStore.getState().finishLoading(batchId)
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
