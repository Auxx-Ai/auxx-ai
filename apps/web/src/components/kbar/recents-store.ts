// apps/web/src/components/kbar/recents-store.ts
'use client'

import { create } from 'zustand'
import { persist } from 'zustand/middleware'

/** How many recent actions to keep. */
const MAX_RECENTS = 6

interface RecentsState {
  /** Most-recently-run action ids, newest first. */
  actionIds: string[]
  /** Record that an action ran (moves it to the front, de-duped, capped). */
  push: (actionId: string) => void
  clear: () => void
}

/**
 * localStorage-backed list of recently-run palette actions, surfaced on the
 * empty root query. Persisted per browser (not per-org) — action ids are stable
 * and harmless to share across orgs; absent ones simply don't resolve.
 */
export const useRecentsStore = create<RecentsState>()(
  persist(
    (set) => ({
      actionIds: [],
      push: (actionId) =>
        set((state) => ({
          actionIds: [actionId, ...state.actionIds.filter((id) => id !== actionId)].slice(
            0,
            MAX_RECENTS
          ),
        })),
      clear: () => set({ actionIds: [] }),
    }),
    { name: 'auxx.palette.recents' }
  )
)
