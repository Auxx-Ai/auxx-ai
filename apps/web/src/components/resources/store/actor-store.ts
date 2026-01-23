// apps/web/src/components/resources/store/actor-store.ts

'use client'

import { create } from 'zustand'
import { subscribeWithSelector } from 'zustand/middleware'
import { immer } from 'zustand/middleware/immer'
import type { Actor, ActorId, ActorType } from '@auxx/types/actor'
import { parseActorId } from '@auxx/types/actor'
import type { GroupMember } from '@auxx/types/groups'

/** Batch configuration */
const BATCH_DELAY = 50
const MAX_BATCH_SIZE = 50

// ============================================================================
// Store State Interface
// ============================================================================

interface ActorStoreState {
  // ─────────────────────────────────────────────────────────────────
  // STATE
  // ─────────────────────────────────────────────────────────────────

  /** Actor cache: ActorId → Actor */
  actors: Map<ActorId, Actor>

  /** Group members cache: groupId → GroupMember[] */
  groupMembers: Map<string, GroupMember[]>

  /** Initial load completed */
  initialized: boolean

  /** Loading initial data */
  loading: boolean

  /** ActorIds pending fetch (for lazy loading) */
  pendingIds: Set<ActorId>

  /** ActorIds currently being fetched */
  loadingIds: Set<ActorId>

  /** ActorIds that were not found */
  notFoundIds: Set<ActorId>

  /** Batch timer reference */
  batchTimer: ReturnType<typeof setTimeout> | null

  // ─────────────────────────────────────────────────────────────────
  // ACTIONS: Initial Load
  // ─────────────────────────────────────────────────────────────────

  /** Set actors from initial load */
  setActors: (actors: Actor[]) => void

  /** Set loading state */
  setLoading: (loading: boolean) => void

  /** Mark as initialized */
  setInitialized: (initialized: boolean) => void

  // ─────────────────────────────────────────────────────────────────
  // ACTIONS: Lazy Loading (for batch resolution)
  // ─────────────────────────────────────────────────────────────────

  /** Request an actor to be fetched */
  requestActor: (actorId: ActorId) => void

  /** Request multiple actors to be fetched */
  requestActors: (actorIds: ActorId[]) => void

  /** Start a batch fetch (called by provider) - returns ActorIds to fetch */
  startBatch: () => ActorId[]

  /** Complete batch with resolved actors */
  completeBatch: (actors: Actor[], requestedIds: ActorId[]) => void

  // ─────────────────────────────────────────────────────────────────
  // ACTIONS: Group Members
  // ─────────────────────────────────────────────────────────────────

  /** Set group members */
  setGroupMembers: (groupId: string, members: GroupMember[]) => void

  /** Clear group members (on invalidation) */
  clearGroupMembers: (groupId: string) => void

  // ─────────────────────────────────────────────────────────────────
  // ACTIONS: Updates
  // ─────────────────────────────────────────────────────────────────

  /** Update a single actor */
  updateActor: (actorId: ActorId, updates: Partial<Actor>) => void

  /** Remove an actor */
  removeActor: (actorId: ActorId) => void

  /** Clear all data */
  reset: () => void

  // ─────────────────────────────────────────────────────────────────
  // SELECTORS (for use outside React)
  // ─────────────────────────────────────────────────────────────────

  /** Get actor by ActorId */
  getActor: (actorId: ActorId) => Actor | undefined

  /** Get all actors of a specific type */
  getActorsByType: (type: ActorType) => Actor[]

  /** Check if actor is loading */
  isActorLoading: (actorId: ActorId) => boolean
}

// ============================================================================
// Store Implementation
// ============================================================================

export const useActorStore = create<ActorStoreState>()(
  subscribeWithSelector(
    immer((set, get) => ({
      actors: new Map(),
      groupMembers: new Map(),
      initialized: false,
      loading: true,
      pendingIds: new Set(),
      loadingIds: new Set(),
      notFoundIds: new Set(),
      batchTimer: null,

      // ─── Initial Load ──────────────────────────────────────────────

      setActors: (actors) =>
        set((state) => {
          for (const actor of actors) {
            state.actors.set(actor.actorId, actor)
          }
        }),

      setLoading: (loading) => set({ loading }),

      setInitialized: (initialized) => set({ initialized }),

      // ─── Lazy Loading ──────────────────────────────────────────────

      requestActor: (actorId) => {
        const state = get()

        // Skip if already have it or pending/loading/not found
        if (state.actors.has(actorId)) return
        if (state.pendingIds.has(actorId)) return
        if (state.loadingIds.has(actorId)) return
        if (state.notFoundIds.has(actorId)) return

        set((state) => {
          state.pendingIds.add(actorId)
        })

        // Schedule batch (handled by provider)
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

      requestActors: (actorIds) => {
        for (const actorId of actorIds) {
          get().requestActor(actorId)
        }
      },

      startBatch: () => {
        const pending = get().pendingIds
        if (pending.size === 0) return []

        const actorIds = Array.from(pending).slice(0, MAX_BATCH_SIZE) as ActorId[]

        set((state) => {
          for (const actorId of actorIds) {
            state.pendingIds.delete(actorId)
            state.loadingIds.add(actorId)
          }
        })

        return actorIds
      },

      completeBatch: (actors, requestedIds) =>
        set((state) => {
          // Add resolved actors
          for (const actor of actors) {
            state.actors.set(actor.actorId, actor)
            state.loadingIds.delete(actor.actorId)
          }

          // Mark missing as not found
          const resolvedIds = new Set(actors.map((a) => a.actorId))
          for (const actorId of requestedIds) {
            if (!resolvedIds.has(actorId)) {
              state.notFoundIds.add(actorId)
            }
            state.loadingIds.delete(actorId)
          }
        }),

      // ─── Group Members ─────────────────────────────────────────────

      setGroupMembers: (groupId, members) =>
        set((state) => {
          state.groupMembers.set(groupId, members)
        }),

      clearGroupMembers: (groupId) =>
        set((state) => {
          state.groupMembers.delete(groupId)
        }),

      // ─── Updates ───────────────────────────────────────────────────

      updateActor: (actorId, updates) =>
        set((state) => {
          const actor = state.actors.get(actorId)
          if (actor) {
            Object.assign(actor, updates)
          }
        }),

      removeActor: (actorId) =>
        set((state) => {
          state.actors.delete(actorId)
          // If it's a group, also clear its members
          try {
            const { type, id } = parseActorId(actorId)
            if (type === 'group') {
              state.groupMembers.delete(id)
            }
          } catch {
            // Invalid ActorId, skip
          }
        }),

      reset: () => {
        const timer = get().batchTimer
        if (timer) clearTimeout(timer)

        set((state) => {
          state.actors.clear()
          state.groupMembers.clear()
          state.initialized = false
          state.loading = true
          state.pendingIds.clear()
          state.loadingIds.clear()
          state.notFoundIds.clear()
          state.batchTimer = null
        })
      },

      // ─── Selectors ─────────────────────────────────────────────────

      getActor: (actorId) => get().actors.get(actorId),

      getActorsByType: (type) =>
        Array.from(get().actors.values()).filter((a) => a.type === type),

      isActorLoading: (actorId) =>
        get().loadingIds.has(actorId) || get().pendingIds.has(actorId),
    }))
  )
)

/**
 * Get the actor store state directly (for use outside React components).
 */
export function getActorStoreState(): ActorStoreState {
  return useActorStore.getState()
}
