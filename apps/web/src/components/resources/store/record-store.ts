// apps/web/src/components/resources/stores/record-store.ts

import '~/lib/immer-config' // Enables Map/Set support for immer
import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'
import { subscribeWithSelector } from 'zustand/middleware'
import type { ConditionGroup } from '@auxx/lib/conditions/client'

// ─────────────────────────────────────────────────────────────────
// BATCHING CONSTANTS
// ─────────────────────────────────────────────────────────────────

const BATCH_DELAY = 50 // ms to wait before processing batch
const MAX_BATCH_SIZE = 100 // max records per batch request

/**
 * Lightweight record metadata - field values stored separately in customFieldValueStore
 */
export interface RecordMeta {
  id: string
  createdAt: string
  updatedAt: string
  /** For contacts: status, email, etc. For entities: entityDefinitionId */
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

  /** Record metadata cache: resourceType → id → metadata */
  records: Record<string, Map<string, RecordMeta>>

  /** List cache: listKey → cached state */
  lists: Record<string, ListCache>

  /** IDs pending fetch: resourceType → Set of IDs */
  pendingFetchIds: Map<string, Set<string>>

  /** IDs currently being fetched: resourceType → Set of IDs */
  loadingIds: Map<string, Set<string>>

  /** Batch timers: resourceType → timeout ID */
  batchTimers: Map<string, ReturnType<typeof setTimeout>>

  // ─────────────────────────────────────────────────────────────────
  // RECORD ACTIONS
  // ─────────────────────────────────────────────────────────────────

  /** Set multiple records (from list fetch) */
  setRecords: (resourceType: string, records: RecordMeta[]) => void

  /** Update a single record (optimistic update) */
  updateRecord: (resourceType: string, id: string, updates: Partial<RecordMeta>) => void

  /** Remove a record (after deletion) */
  removeRecord: (resourceType: string, id: string) => void

  // ─────────────────────────────────────────────────────────────────
  // LIST ACTIONS
  // ─────────────────────────────────────────────────────────────────

  /** Set list cache (from fetch) */
  setList: (key: string, cache: ListCache) => void

  /** Append IDs to list (for infinite scroll) */
  appendToList: (key: string, ids: string[], nextCursor: string | null) => void

  // ─────────────────────────────────────────────────────────────────
  // BATCHED RECORD FETCHING
  // ─────────────────────────────────────────────────────────────────

  /** Queue a record for batch fetching */
  requestRecord: (resourceType: string, id: string) => void

  /** Process pending batch for a resource type (called by provider) */
  startBatch: (resourceType: string) => string[]

  /** Mark batch as complete */
  completeBatch: (resourceType: string, ids: string[]) => void

  // ─────────────────────────────────────────────────────────────────
  // INVALIDATION
  // ─────────────────────────────────────────────────────────────────

  /** Invalidate a single record */
  invalidateRecord: (resourceType: string, id: string) => void

  /** Invalidate all lists for a resource type (after create/delete) */
  invalidateLists: (resourceType: string) => void

  /** Invalidate specific list (after filter data changes) */
  invalidateList: (key: string) => void

  /** Invalidate all data for a resource type */
  invalidateResourceType: (resourceType: string) => void

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
  resourceType: string,
  filters: ConditionGroup[],
  sorting: Array<{ id: string; desc: boolean }>
): string {
  const config = JSON.stringify({ f: filters, s: sorting })
  // Simple hash for shorter keys
  let hash = 5381
  for (let i = 0; i < config.length; i++) {
    hash = (hash * 33) ^ config.charCodeAt(i)
  }
  return `${resourceType}:${Math.abs(hash).toString(36)}`
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
      pendingFetchIds: new Map(),
      loadingIds: new Map(),
      batchTimers: new Map(),

      // ─── RECORD ACTIONS ────────────────────────────────────────────
      // With immer: direct mutations, structural sharing preserved

      setRecords: (resourceType, records) => {
        set((state) => {
          if (!state.records[resourceType]) {
            state.records[resourceType] = new Map()
          }
          const map = state.records[resourceType]
          for (const record of records) {
            map.set(record.id, record)
          }
        })
      },

      updateRecord: (resourceType, id, updates) => {
        set((state) => {
          const record = state.records[resourceType]?.get(id)
          if (record) {
            // Direct mutation - immer handles immutability
            Object.assign(record, updates)
          }
        })
      },

      removeRecord: (resourceType, id) => {
        set((state) => {
          // Remove from records
          state.records[resourceType]?.delete(id)

          // Remove from all lists for this resource type
          for (const [key, cache] of Object.entries(state.lists)) {
            if (key.startsWith(`${resourceType}:`)) {
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

      // ─── BATCHED RECORD FETCHING ─────────────────────────────────────
      // Similar pattern to relationship store batching

      requestRecord: (resourceType, id) => {
        const state = get()

        // Skip if already cached, pending, or loading
        if (state.records[resourceType]?.has(id)) return
        if (state.pendingFetchIds.get(resourceType)?.has(id)) return
        if (state.loadingIds.get(resourceType)?.has(id)) return

        set((state) => {
          if (!state.pendingFetchIds.has(resourceType)) {
            state.pendingFetchIds.set(resourceType, new Set())
          }
          state.pendingFetchIds.get(resourceType)!.add(id)
        })

        // Schedule batch processing
        const existingTimer = get().batchTimers.get(resourceType)
        if (!existingTimer) {
          const timer = setTimeout(() => {
            set((state) => {
              state.batchTimers.delete(resourceType)
            })
            // Provider will pick up via subscription
          }, BATCH_DELAY)

          set((state) => {
            state.batchTimers.set(resourceType, timer)
          })
        }
      },

      startBatch: (resourceType) => {
        const pending = get().pendingFetchIds.get(resourceType)
        if (!pending || pending.size === 0) return []

        const ids = Array.from(pending).slice(0, MAX_BATCH_SIZE)

        set((state) => {
          // Move from pending to loading
          for (const id of ids) {
            state.pendingFetchIds.get(resourceType)?.delete(id)
          }
          if (!state.loadingIds.has(resourceType)) {
            state.loadingIds.set(resourceType, new Set())
          }
          for (const id of ids) {
            state.loadingIds.get(resourceType)!.add(id)
          }
        })

        return ids
      },

      completeBatch: (resourceType, ids) => {
        set((state) => {
          for (const id of ids) {
            state.loadingIds.get(resourceType)?.delete(id)
          }
        })
      },

      // ─── INVALIDATION ──────────────────────────────────────────────

      invalidateRecord: (resourceType, id) => {
        set((state) => {
          state.records[resourceType]?.delete(id)
        })
      },

      invalidateLists: (resourceType) => {
        set((state) => {
          const prefix = `${resourceType}:`
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

      invalidateResourceType: (resourceType) => {
        set((state) => {
          delete state.records[resourceType]
          const prefix = `${resourceType}:`
          for (const key of Object.keys(state.lists)) {
            if (key.startsWith(prefix)) {
              delete state.lists[key]
            }
          }
        })
      },

      clearAll: () => {
        // Clear any pending timers
        const timers = Array.from(get().batchTimers.values())
        for (const timer of timers) {
          clearTimeout(timer)
        }
        set((state) => {
          state.records = {}
          state.lists = {}
          state.pendingFetchIds.clear()
          state.loadingIds.clear()
          state.batchTimers.clear()
        })
      },
    }))
  )
)

// ─────────────────────────────────────────────────────────────────
// IMPERATIVE ACCESS (for mutations outside React)
// ─────────────────────────────────────────────────────────────────

export const getRecordStoreState = () => useRecordStore.getState()
