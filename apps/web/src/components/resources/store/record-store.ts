// apps/web/src/components/resources/store/record-store.ts

import '~/lib/immer-config' // Enables Map/Set support for immer
import type { ConditionGroup } from '@auxx/lib/conditions/client'
import { parseRecordId, type RecordId, toRecordId } from '@auxx/lib/resources/client'
import { create } from 'zustand'
import { subscribeWithSelector } from 'zustand/middleware'
import { immer } from 'zustand/middleware/immer'

// ─────────────────────────────────────────────────────────────────
// BATCHING CONSTANTS
// ─────────────────────────────────────────────────────────────────

const BATCH_DELAY = 50 // ms to wait before processing batch
const MAX_BATCH_SIZE = 100 // max records per batch request

/**
 * Record metadata from RecordPickerItem
 * Contains full resource data including display fields and database row
 */
export interface RecordMeta {
  id: string
  recordId?: RecordId
  displayName?: string
  secondaryInfo?: string
  avatarUrl?: string
  createdAt: string | Date
  updatedAt: string | Date
  /** Additional database fields from the specific resource table */
  [key: string]: unknown
}

/**
 * Cached list state
 */
interface ListCache {
  /** Ordered record IDs matching this filter/sort combo */
  ids: string[]
  /** Total count from server */
  total: number
  /** When this cache was created */
  fetchedAt: number
  /** Cursor for next page (encodes snapshotId + offset internally) */
  nextCursor: string | null
}

interface RecordStoreState {
  // ─────────────────────────────────────────────────────────────────
  // STATE
  // ─────────────────────────────────────────────────────────────────

  /** Record metadata cache: entityDefinitionId → id → metadata */
  records: Record<string, Map<string, RecordMeta>>

  /** List cache: listKey → cached state */
  lists: Record<string, ListCache>

  /** RecordIds pending fetch (unified across all resource types) */
  pendingFetchIds: Set<RecordId>

  /** RecordIds currently being fetched */
  loadingIds: Set<RecordId>

  /** RecordIds that were requested but not found (deleted/invalid) */
  notFoundIds: Set<RecordId>

  /** RecordIds we've attempted to load at least once (found or not-found). Distinguishes "never fetched" from "fetched, empty". */
  attemptedIds: Set<RecordId>

  /** Single batch timer for all resource types */
  batchTimer: ReturnType<typeof setTimeout> | null

  // ─────────────────────────────────────────────────────────────────
  // RECORD ACTIONS
  // ─────────────────────────────────────────────────────────────────

  /** Set multiple records (from list fetch) */
  setRecords: (entityDefinitionId: string, records: RecordMeta[]) => void

  /** Update a single record (optimistic update) */
  updateRecord: (entityDefinitionId: string, id: string, updates: Partial<RecordMeta>) => void

  /** Remove a record (after deletion) */
  removeRecord: (entityDefinitionId: string, id: string) => void

  // ─────────────────────────────────────────────────────────────────
  // LIST ACTIONS
  // ─────────────────────────────────────────────────────────────────

  /** Set list cache (from fetch) */
  setList: (key: string, cache: ListCache) => void

  /** Append IDs to list (for infinite scroll) */
  appendToList: (key: string, ids: string[], nextCursor: string | null) => void

  // ─────────────────────────────────────────────────────────────────
  // BATCHED RECORD FETCHING (unified across resource types)
  // ─────────────────────────────────────────────────────────────────

  /** Queue a record for batch fetching */
  requestRecord: (recordId: RecordId) => void

  /** Process all pending items into a batch (called by provider) */
  startBatch: () => RecordId[]

  /** Mark batch as complete */
  completeBatch: (recordIds: RecordId[]) => void

  /** Mark RecordIds as not found (deleted/invalid) */
  setNotFound: (recordIds: RecordId[]) => void

  // ─────────────────────────────────────────────────────────────────
  // HELPERS
  // ─────────────────────────────────────────────────────────────────

  /** Check if a record exists in cache */
  hasRecord: (recordId: RecordId) => boolean

  /** Check if a RecordId is loading */
  isLoading: (recordId: RecordId) => boolean

  /** Check if a RecordId was not found */
  isNotFound: (recordId: RecordId) => boolean

  /** Check if a RecordId has been fetched at least once (found or not-found) */
  hasLoadedOnce: (recordId: RecordId) => boolean

  // ─────────────────────────────────────────────────────────────────
  // INVALIDATION
  // ─────────────────────────────────────────────────────────────────

  /** Invalidate a single record */
  invalidateRecord: (entityDefinitionId: string, id: string) => void

  /** Invalidate all lists for an entity definition (after create/delete) */
  invalidateLists: (entityDefinitionId: string) => void

  /** Invalidate specific list (after filter data changes) */
  invalidateList: (key: string) => void

  /** Invalidate all data for an entity definition */
  invalidateResourceType: (entityDefinitionId: string) => void

  /** Clear everything (logout, org switch) */
  clearAll: () => void
}

// ─────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────

/**
 * Create a stable key for list cache
 */
export function createListKey(
  entityDefinitionId: string,
  filters: ConditionGroup[],
  sorting: Array<{ id: string; desc: boolean }>
): string {
  const config = JSON.stringify({ f: filters, s: sorting })
  // Simple hash for shorter keys
  let hash = 5381
  for (let i = 0; i < config.length; i++) {
    hash = (hash * 33) ^ config.charCodeAt(i)
  }
  return `${entityDefinitionId}:${Math.abs(hash).toString(36)}`
}

/**
 * Check if cache is stale (5 minute TTL)
 */
export function isListStale(cache: ListCache | undefined): boolean {
  if (!cache) return true
  return Date.now() - cache.fetchedAt > 5 * 60 * 1000
}

// ─────────────────────────────────────────────────────────────────
// STABLE DEFAULTS (avoid infinite loops from new [] {} references)
// ─────────────────────────────────────────────────────────────────

export const EMPTY_FILTERS: ConditionGroup[] = []
export const EMPTY_SORTING: Array<{ id: string; desc: boolean }> = []

// ─────────────────────────────────────────────────────────────────
// STORE (with immer for structural sharing)
// ─────────────────────────────────────────────────────────────────

export const useRecordStore = create<RecordStoreState>()(
  subscribeWithSelector(
    immer((set, get) => ({
      records: {},
      lists: {},
      pendingFetchIds: new Set<RecordId>(),
      loadingIds: new Set<RecordId>(),
      notFoundIds: new Set<RecordId>(),
      attemptedIds: new Set<RecordId>(),
      batchTimer: null,

      // ─── RECORD ACTIONS ────────────────────────────────────────────
      // With immer: direct mutations, structural sharing preserved

      setRecords: (entityDefinitionId, records) => {
        set((state) => {
          if (!state.records[entityDefinitionId]) {
            state.records[entityDefinitionId] = new Map()
          }
          const map = state.records[entityDefinitionId]
          for (const record of records) {
            map.set(record.id, record)
            state.attemptedIds.add(toRecordId(entityDefinitionId, record.id))
          }
        })
      },

      updateRecord: (entityDefinitionId, id, updates) => {
        set((state) => {
          const record = state.records[entityDefinitionId]?.get(id)
          if (record) {
            // Direct mutation - immer handles immutability
            Object.assign(record, updates)
          }
        })
      },

      removeRecord: (entityDefinitionId, id) => {
        const recordId = toRecordId(entityDefinitionId, id)
        set((state) => {
          // Remove from records
          state.records[entityDefinitionId]?.delete(id)

          // Mark as resolved-and-gone so future useRecord() calls don't re-fetch
          state.attemptedIds.add(recordId)
          state.notFoundIds.add(recordId)

          // Remove from all lists for this entity definition
          for (const [key, cache] of Object.entries(state.lists)) {
            if (key.startsWith(`${entityDefinitionId}:`)) {
              const idx = cache.ids.indexOf(id)
              if (idx !== -1) {
                cache.ids.splice(idx, 1)
                cache.total--
              }
            }
          }
        })
      },

      // ─── LIST ACTIONS ──────────────────────────────────────────────

      setList: (key, cache) => {
        set((state) => {
          state.lists[key] = cache
        })
      },

      appendToList: (key, ids, nextCursor) => {
        set((state) => {
          const cache = state.lists[key]
          if (cache) {
            cache.ids.push(...ids)
            cache.nextCursor = nextCursor
          }
        })
      },

      // ─── BATCHED RECORD FETCHING (unified across resource types) ───

      requestRecord: (recordId) => {
        const state = get()
        const { entityDefinitionId, entityInstanceId } = parseRecordId(recordId)

        // Skip if already cached, pending, loading, or known not-found
        if (state.records[entityDefinitionId]?.has(entityInstanceId)) return
        if (state.pendingFetchIds.has(recordId)) return
        if (state.loadingIds.has(recordId)) return
        if (state.notFoundIds.has(recordId)) return

        set((state) => {
          state.pendingFetchIds.add(recordId)
        })

        // Schedule batch processing (single timer for all types)
        if (!get().batchTimer) {
          const timer = setTimeout(() => {
            set((state) => {
              state.batchTimer = null
            })
            // Provider will pick up via subscription to pendingFetchIds.size
          }, BATCH_DELAY)

          set((state) => {
            state.batchTimer = timer
          })
        }
      },

      startBatch: () => {
        const pending = get().pendingFetchIds
        if (pending.size === 0) return []

        const recordIds = Array.from(pending).slice(0, MAX_BATCH_SIZE)

        set((state) => {
          // Move from pending to loading
          for (const recordId of recordIds) {
            state.pendingFetchIds.delete(recordId)
            state.loadingIds.add(recordId)
          }
        })

        return recordIds
      },

      completeBatch: (recordIds) => {
        set((state) => {
          for (const recordId of recordIds) {
            state.loadingIds.delete(recordId)
            state.attemptedIds.add(recordId)
          }
        })
      },

      setNotFound: (recordIds) => {
        set((state) => {
          for (const recordId of recordIds) {
            state.notFoundIds.add(recordId)
            state.loadingIds.delete(recordId)
            state.attemptedIds.add(recordId)
          }
        })
      },

      // ─── HELPERS ───────────────────────────────────────────────────

      hasRecord: (recordId) => {
        const { entityDefinitionId, entityInstanceId } = parseRecordId(recordId)
        return get().records[entityDefinitionId]?.has(entityInstanceId) ?? false
      },

      isLoading: (recordId) => {
        return get().loadingIds.has(recordId) || get().pendingFetchIds.has(recordId)
      },

      isNotFound: (recordId) => {
        return get().notFoundIds.has(recordId)
      },

      hasLoadedOnce: (recordId) => {
        return get().attemptedIds.has(recordId)
      },

      // ─── INVALIDATION ──────────────────────────────────────────────

      invalidateRecord: (entityDefinitionId, id) => {
        const recordId = toRecordId(entityDefinitionId, id)
        set((state) => {
          state.records[entityDefinitionId]?.delete(id)
          state.attemptedIds.delete(recordId)
          state.notFoundIds.delete(recordId)
        })
      },

      invalidateLists: (entityDefinitionId) => {
        set((state) => {
          const prefix = `${entityDefinitionId}:`
          for (const key of Object.keys(state.lists)) {
            if (key.startsWith(prefix)) {
              delete state.lists[key]
            }
          }
        })
      },

      invalidateList: (key) => {
        set((state) => {
          delete state.lists[key]
        })
      },

      invalidateResourceType: (entityDefinitionId) => {
        set((state) => {
          delete state.records[entityDefinitionId]
          const prefix = `${entityDefinitionId}:` as const
          for (const key of Object.keys(state.lists)) {
            if (key.startsWith(prefix)) {
              delete state.lists[key]
            }
          }
          const toDropAttempted = [...state.attemptedIds].filter((rid) => rid.startsWith(prefix))
          for (const rid of toDropAttempted) state.attemptedIds.delete(rid)
          const toDropNotFound = [...state.notFoundIds].filter((rid) => rid.startsWith(prefix))
          for (const rid of toDropNotFound) state.notFoundIds.delete(rid)
        })
      },

      clearAll: () => {
        // Clear any pending timer
        const timer = get().batchTimer
        if (timer) {
          clearTimeout(timer)
        }
        set((state) => {
          state.records = {}
          state.lists = {}
          state.pendingFetchIds.clear()
          state.loadingIds.clear()
          state.notFoundIds.clear()
          state.attemptedIds.clear()
          state.batchTimer = null
        })
      },
    }))
  )
)

// ─────────────────────────────────────────────────────────────────
// IMPERATIVE ACCESS (for mutations outside React)
// ─────────────────────────────────────────────────────────────────

export const getRecordStoreState = () => useRecordStore.getState()
