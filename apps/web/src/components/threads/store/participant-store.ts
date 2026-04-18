// apps/web/src/components/threads/store/participant-store.ts

import '~/lib/immer-config'
import { create } from 'zustand'
import { subscribeWithSelector } from 'zustand/middleware'
import { immer } from 'zustand/middleware/immer'

/** Batching configuration */
const BATCH_DELAY = 50
const MAX_BATCH_SIZE = 50

/** Identifier type for participants */
export type ParticipantIdentifierType = 'EMAIL' | 'PHONE'

/**
 * ParticipantMeta - email/phone participant for display.
 * Matches the backend ParticipantMeta type from packages/lib/src/participants/client.ts
 */
export interface ParticipantMeta {
  id: string
  name: string | null
  identifier: string
  identifierType: ParticipantIdentifierType
  displayName: string
  initials: string
  avatarUrl: string | null
  /** Reference to EntityInstance (contact entity type) */
  entityInstanceId: string | null
  isSpammer: boolean
  /** True when the participant's identifier is on the organization's own domain. */
  isInternal: boolean
}

/**
 * Participant store state interface.
 */
interface ParticipantStoreState {
  participants: Map<string, ParticipantMeta>
  pendingIds: Set<string>
  loadingIds: Set<string>
  notFoundIds: Set<string>
  batchTimer: ReturnType<typeof setTimeout> | null
  initialized: boolean

  setParticipants: (participants: ParticipantMeta[]) => void
  updateParticipant: (id: string, updates: Partial<ParticipantMeta>) => void
  removeParticipant: (id: string) => void

  requestParticipant: (id: string) => void
  startBatch: () => string[]
  completeBatch: (participants: ParticipantMeta[], notFoundIds: string[]) => void

  getParticipant: (id: string) => ParticipantMeta | undefined
  isParticipantLoading: (id: string) => boolean

  reset: () => void
}

/**
 * Zustand store for participant metadata caching and batched lazy-loading.
 */
export const useParticipantStore = create<ParticipantStoreState>()(
  subscribeWithSelector(
    immer((set, get) => ({
      participants: new Map(),
      pendingIds: new Set(),
      loadingIds: new Set(),
      notFoundIds: new Set(),
      batchTimer: null,
      initialized: false,

      setParticipants: (participants) =>
        set((state) => {
          for (const p of participants) {
            state.participants.set(p.id, p)
            state.pendingIds.delete(p.id)
            state.loadingIds.delete(p.id)
            state.notFoundIds.delete(p.id)
          }
        }),

      updateParticipant: (id, updates) =>
        set((state) => {
          const existing = state.participants.get(id)
          if (existing) {
            state.participants.set(id, { ...existing, ...updates })
          }
        }),

      removeParticipant: (id) =>
        set((state) => {
          state.participants.delete(id)
        }),

      requestParticipant: (id) => {
        const state = get()
        if (
          state.participants.has(id) ||
          state.loadingIds.has(id) ||
          state.pendingIds.has(id) ||
          state.notFoundIds.has(id)
        ) {
          return
        }

        set((s) => {
          s.pendingIds.add(id)
        })

        if (!state.batchTimer) {
          const timer = setTimeout(() => {
            set((s) => {
              s.batchTimer = null
            })
          }, BATCH_DELAY)
          set((s) => {
            s.batchTimer = timer
          })
        }
      },

      startBatch: () => {
        const state = get()
        const batch = Array.from(state.pendingIds).slice(0, MAX_BATCH_SIZE)

        set((s) => {
          for (const id of batch) {
            s.pendingIds.delete(id)
            s.loadingIds.add(id)
          }
        })

        return batch
      },

      completeBatch: (participants, notFoundIds) =>
        set((state) => {
          for (const p of participants) {
            state.participants.set(p.id, p)
            state.loadingIds.delete(p.id)
          }
          for (const id of notFoundIds) {
            state.loadingIds.delete(id)
            state.notFoundIds.add(id)
          }
        }),

      getParticipant: (id) => get().participants.get(id),

      isParticipantLoading: (id) => get().loadingIds.has(id) || get().pendingIds.has(id),

      reset: () => {
        const timer = get().batchTimer
        if (timer) clearTimeout(timer)

        set((state) => {
          state.participants.clear()
          state.pendingIds.clear()
          state.loadingIds.clear()
          state.notFoundIds.clear()
          state.initialized = false
          state.batchTimer = null
        })
      },
    }))
  )
)

/**
 * Get store state outside of React.
 */
export const getParticipantStoreState = () => useParticipantStore.getState()
