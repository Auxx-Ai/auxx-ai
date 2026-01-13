// apps/web/src/components/resources/store/record-store.ts

import '~/lib/immer-config' // Enables Map/Set support for immer
import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'
import { subscribeWithSelector } from 'zustand/middleware'
import type { ConditionGroup } from '@auxx/lib/conditions/client'
import { parseResourceId, type ResourceId } from '@auxx/lib/resources/client'

// ─────────────────────────────────────────────────────────────────
// BATCHING CONSTANTS
// ─────────────────────────────────────────────────────────────────

const BATCH_DELAY = 50 // ms to wait before processing batch
const MAX_BATCH_SIZE = 100 // max records per batch request

/**
 * Record metadata from ResourcePickerItem
 * Contains full resource data including display fields and database row
 */
export interface RecordMeta {
  id: string
  resourceId?: string
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

  /** Record metadata cache: resourceType → id → metadata */
  records: Record<string, Map<string, RecordMeta>>

  /** List cache: listKey → cached state */
  lists: Record<string, ListCache>

  /** ResourceIds pending fetch (unified across all resource types) */
  pendingFetchIds: Set<ResourceId>

  /** ResourceIds currently being fetched */
  loadingIds: Set<ResourceId>

  /** ResourceIds that were requested but not found (deleted/invalid) */
  notFoundIds: Set<ResourceId>

  /** Single batch timer for all resource types */
  batchTimer: ReturnType<typeof setTimeout> | null

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
  // BATCHED RECORD FETCHING (unified across resource types)
  // ─────────────────────────────────────────────────────────────────

  /** Queue a record for batch fetching */
  requestRecord: (resourceId: ResourceId) => void

  /** Process all pending items into a batch (called by provider) */
  startBatch: () => ResourceId[]

  /** Mark batch as complete */
  completeBatch: (resourceIds: ResourceId[]) => void

  /** Mark ResourceIds as not found (deleted/invalid) */
  setNotFound: (resourceIds: ResourceId[]) => void

  // ─────────────────────────────────────────────────────────────────
  // HELPERS
  // ─────────────────────────────────────────────────────────────────

  /** Check if a record exists in cache */
  hasRecord: (resourceId: ResourceId) => boolean

  /** Check if a ResourceId is loading */
  isLoading: (resourceId: ResourceId) => boolean

  /** Check if a ResourceId was not found */
  isNotFound: (resourceId: ResourceId) => boolean

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
      pendingFetchIds: new Set<ResourceId>(),
      loadingIds: new Set<ResourceId>(),
      notFoundIds: new Set<ResourceId>(),
      batchTimer: null,

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

      // ─── BATCHED RECORD FETCHING (unified across resource types) ───

      requestRecord: (resourceId) => {
        const state = get()
        const { entityDefinitionId, entityInstanceId } = parseResourceId(resourceId)

        // Skip if already cached, pending, loading, or known not-found
        if (state.records[entityDefinitionId]?.has(entityInstanceId)) return
        if (state.pendingFetchIds.has(resourceId)) return
        if (state.loadingIds.has(resourceId)) return
        if (state.notFoundIds.has(resourceId)) return

        set((state) => {
          state.pendingFetchIds.add(resourceId)
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

        const resourceIds = Array.from(pending).slice(0, MAX_BATCH_SIZE)

        set((state) => {
          // Move from pending to loading
          for (const resourceId of resourceIds) {
            state.pendingFetchIds.delete(resourceId)
            state.loadingIds.add(resourceId)
          }
        })

        return resourceIds
      },

      completeBatch: (resourceIds) => {
        set((state) => {
          for (const resourceId of resourceIds) {
            state.loadingIds.delete(resourceId)
          }
        })
      },

      setNotFound: (resourceIds) => {
        set((state) => {
          for (const resourceId of resourceIds) {
            state.notFoundIds.add(resourceId)
            state.loadingIds.delete(resourceId)
          }
        })
      },

      // ─── HELPERS ───────────────────────────────────────────────────

      hasRecord: (resourceId) => {
        const { entityDefinitionId, entityInstanceId } = parseResourceId(resourceId)
        return get().records[entityDefinitionId]?.has(entityInstanceId) ?? false
      },

      isLoading: (resourceId) => {
        return get().loadingIds.has(resourceId) || get().pendingFetchIds.has(resourceId)
      },

      isNotFound: (resourceId) => {
        return get().notFoundIds.has(resourceId)
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
