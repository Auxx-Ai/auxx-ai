// apps/web/src/components/resources/store/record-store.ts

import '~/lib/immer-config' // Enables Map/Set support for immer
import type { Rung } from '@auxx/database/enums'
import type { ConditionGroup } from '@auxx/lib/conditions/client'
import {
  parseRecordId,
  type RecordId,
  type RecordSourceChip,
  toRecordId,
} from '@auxx/lib/resources/client'
import { create } from 'zustand'
import { subscribeWithSelector } from 'zustand/middleware'
import { immer } from 'zustand/middleware/immer'
import {
  getNormalizedDefinitionId,
  getNormalizedRecordId,
  tryNormalizeRecordId,
} from '../utils/normalize-record-id'

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
  /**
   * App-origin identity chips derived from the `RecordIdentity` index. Drives
   * the record-grain "Synced from <app>" source badge. Absent for records with
   * no app identity.
   */
  sources?: RecordSourceChip[]
  /**
   * **The row-effective access rung** (plan v3/03 §5.2) — `max(def level, max
   * rung across the member's grant rows on THIS row)`, resolved server-side in
   * the same query that produced the row.
   *
   * This is what makes edit/delete/share affordances per-ROW instead of per-def.
   * A member can hold `edit` on one row of a definition they otherwise cannot
   * see at all, and the def-level `canEditEntity` has no right answer for that
   * row — see `useRecordAccess` / `useRecordDrawerReadOnly`.
   *
   * **Absent means "unknown", never "allowed".** It is absent on rows that
   * arrived from a lane that does not stamp (`record.listAll`, the realtime
   * `record:created` payload, an optimistic seed), so every reader must decide
   * its own fallback explicitly rather than treating `undefined` as a rung.
   */
  _access?: Rung
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
  /** Presence marker for "more pages exist" (the real cursor is the page offset) */
  nextCursor: string | null
}

export interface RecordStoreState {
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

  /**
   * Append a single freshly-created record's id to a cached list (the phantom
   * draft "no refresh()" path) — bumps `total`, leaves `nextCursor` untouched.
   * No-ops if the list isn't cached yet (a subsequent fetch will include it
   * naturally) or the id is already present.
   */
  appendCreatedRecord: (key: string, id: string) => void

  // ─────────────────────────────────────────────────────────────────
  // BATCHED RECORD FETCHING (unified across resource types)
  // ─────────────────────────────────────────────────────────────────

  /** Queue a record for batch fetching */
  requestRecord: (recordId: RecordId) => void

  /** Process all pending items into a batch (called by provider) */
  /**
   * Re-queue every LOADED record so its `_access` stamp is recomputed.
   *
   * 🔴 **`_access` is the one field on a row that can go stale without the row
   * itself changing.** It is not a property of the record — it is the viewer's
   * row-effective rung, folded server-side per query
   * (`foldRecordAccess(defRung, grantRank)`), and this store is the ONLY cache
   * of that fold anywhere in the system (the server deliberately keeps none —
   * plan v3/03 §4). So when a share, an approved access request, a role change
   * or a seat change moves a member's access, every already-loaded row keeps
   * the rung it was stamped with at first fetch.
   *
   * Nothing else recovers from that: `requestRecord` returns early for a row
   * already in `records`, `record.getByIds` is `staleTime: Infinity`, and
   * `capabilities:changed` refetches the capabilities BLOB only — which is why
   * def-level surfaces (nav, New) updated live while the drawer and the grid
   * stayed read-only until a full reload.
   *
   * Skips rows already pending/loading; leaves the existing rows in place so
   * the UI never blanks mid-refresh. Caller must invalidate the
   * `record.getByIds` query cache first — see `useRecordAccessRefresh`.
   */
  requestAccessRefresh: () => void

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
 * Create a stable key for list cache.
 *
 * `search` is part of the key, not decoration: it is a separate query axis from
 * `filters` (plan decision 0.3), so leaving it out would let a searched list and
 * the unsearched list of the same definition collide on one cache entry — the
 * table would render whichever landed first.
 */
export function createListKey(
  entityDefinitionId: string,
  filters: ConditionGroup[],
  sorting: Array<{ id: string; desc: boolean }>,
  search?: string
): string {
  const config = JSON.stringify({ f: filters, s: sorting, q: search ?? '' })
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
      //
      // Every action canonicalizes its definition prefix / RecordId at entry
      // (UUID | entityType | apiSlug → EntityDefinition UUID) so alias-form
      // callers can never create or miss a cache slot. No-op before a
      // translation source exists — the batch flush gate covers that window.

      setRecords: (rawEntityDefinitionId, records) => {
        const entityDefinitionId = getNormalizedDefinitionId(rawEntityDefinitionId)
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

      updateRecord: (rawEntityDefinitionId, id, updates) => {
        const entityDefinitionId = getNormalizedDefinitionId(rawEntityDefinitionId)
        set((state) => {
          const record = state.records[entityDefinitionId]?.get(id)
          if (record) {
            // Direct mutation - immer handles immutability
            Object.assign(record, updates)
          }
        })
      },

      removeRecord: (rawEntityDefinitionId, id) => {
        const entityDefinitionId = getNormalizedDefinitionId(rawEntityDefinitionId)
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

      appendCreatedRecord: (key, id) => {
        set((state) => {
          const cache = state.lists[key]
          if (!cache || cache.ids.includes(id)) return
          cache.ids.push(id)
          cache.total += 1
        })
      },

      // ─── BATCHED RECORD FETCHING (unified across resource types) ───

      requestRecord: (rawRecordId) => {
        // Canonicalize BEFORE the dedupe checks so post-hydration callers
        // dedupe against the canonical slot. Pre-hydration this is a no-op;
        // the flush gate + startBatch normalization cover that window.
        const recordId = getNormalizedRecordId(rawRecordId)
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

      requestAccessRefresh: () => {
        // Every LOADED row, re-queued past `requestRecord`'s presence dedupe.
        // The rows stay in the store while the refetch is in flight, so nothing
        // blanks and no consumer sees an intermediate `_access: undefined`.
        const state = get()
        const stale: RecordId[] = []
        for (const [entityDefinitionId, map] of Object.entries(state.records)) {
          for (const entityInstanceId of map.keys()) {
            const recordId = toRecordId(entityDefinitionId, entityInstanceId)
            if (state.pendingFetchIds.has(recordId)) continue
            if (state.loadingIds.has(recordId)) continue
            stale.push(recordId)
          }
        }
        if (stale.length === 0) return

        set((state) => {
          for (const recordId of stale) state.pendingFetchIds.add(recordId)
        })

        if (!get().batchTimer) {
          const timer = setTimeout(() => {
            set((state) => {
              state.batchTimer = null
            })
          }, BATCH_DELAY)
          set((state) => {
            state.batchTimer = timer
          })
        }
      },

      startBatch: () => {
        const pending = get().pendingFetchIds
        if (pending.size === 0) return []

        // Single authority for draining canonicalizable records (per-id gate):
        // normalize each queued id ONCE, select up to MAX_BATCH_SIZE unique
        // canonical ids (dedupe BEFORE capacity so `work_order:X` + `<uuid>:X`
        // never consume two slots), drain every queued form that maps to a
        // selected id, and leave unresolved prefixes pending — they release
        // when the prefix map changes.
        const canonicalByQueued = new Map<RecordId, RecordId | null>()
        for (const queuedId of pending) {
          canonicalByQueued.set(queuedId, tryNormalizeRecordId(queuedId))
        }

        const recordIds: RecordId[] = []
        const selected = new Set<RecordId>()
        for (const canonicalId of canonicalByQueued.values()) {
          if (!canonicalId || selected.has(canonicalId)) continue
          if (recordIds.length >= MAX_BATCH_SIZE) break
          selected.add(canonicalId)
          recordIds.push(canonicalId)
        }
        if (recordIds.length === 0) return []

        set((state) => {
          // Drain every queued alias/canonical form of a selected id; move
          // only canonical ids into loadingIds and the request.
          for (const [queuedId, canonicalId] of canonicalByQueued) {
            if (canonicalId && selected.has(canonicalId)) {
              state.pendingFetchIds.delete(queuedId)
            }
          }
          for (const recordId of recordIds) {
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

      hasRecord: (rawRecordId) => {
        const { entityDefinitionId, entityInstanceId } = parseRecordId(
          getNormalizedRecordId(rawRecordId)
        )
        return get().records[entityDefinitionId]?.has(entityInstanceId) ?? false
      },

      isLoading: (rawRecordId) => {
        const recordId = getNormalizedRecordId(rawRecordId)
        return get().loadingIds.has(recordId) || get().pendingFetchIds.has(recordId)
      },

      isNotFound: (rawRecordId) => {
        return get().notFoundIds.has(getNormalizedRecordId(rawRecordId))
      },

      hasLoadedOnce: (rawRecordId) => {
        return get().attemptedIds.has(getNormalizedRecordId(rawRecordId))
      },

      // ─── INVALIDATION ──────────────────────────────────────────────

      invalidateRecord: (rawEntityDefinitionId, id) => {
        const entityDefinitionId = getNormalizedDefinitionId(rawEntityDefinitionId)
        const recordId = toRecordId(entityDefinitionId, id)
        set((state) => {
          state.records[entityDefinitionId]?.delete(id)
          state.attemptedIds.delete(recordId)
          state.notFoundIds.delete(recordId)
        })
      },

      invalidateLists: (rawEntityDefinitionId) => {
        const entityDefinitionId = getNormalizedDefinitionId(rawEntityDefinitionId)
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

      invalidateResourceType: (rawEntityDefinitionId) => {
        const entityDefinitionId = getNormalizedDefinitionId(rawEntityDefinitionId)
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
