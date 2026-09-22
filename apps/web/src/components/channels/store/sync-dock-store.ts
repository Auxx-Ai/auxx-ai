// apps/web/src/components/channels/store/sync-dock-store.ts

import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'

/** `docking` / `undocking` are the in-flight morphs between the floating card and the sidebar item. */
export type SyncDockPhase = 'floating' | 'docking' | 'docked' | 'undocking'

interface SyncDockState {
  phase: SyncDockPhase
  /** Auth-error channel ids at dock time; a channel not in this list pops the card back out. */
  dockedAuthIds: string[]
  /** The sidebar slot the card morphs into, registered by `SyncStatusSidebarItem`. */
  target: HTMLElement | null
  setDockTarget: (el: HTMLElement | null) => void
  dock: (authIds: string[]) => void
  undock: () => void
  /** Ends a morph; a no-op outside `docking` / `undocking`, so it is safe to call twice. */
  settle: () => void
  reset: () => void
}

export const useSyncDockStore = create<SyncDockState>()(
  persist(
    (set, get) => ({
      phase: 'floating',
      dockedAuthIds: [],
      target: null,
      setDockTarget: (target) => set({ target }),
      dock: (dockedAuthIds) => set({ phase: 'docking', dockedAuthIds }),
      undock: () => set({ phase: 'undocking' }),
      settle: () => {
        const { phase } = get()
        if (phase === 'docking') set({ phase: 'docked' })
        else if (phase === 'undocking') set({ phase: 'floating' })
      },
      reset: () => set({ phase: 'floating', dockedAuthIds: [] }),
    }),
    {
      name: 'channel-sync-dock',
      storage: createJSONStorage(() => sessionStorage),
      // Only resting states are persisted; a reload mid-morph would otherwise strand the card.
      partialize: (state) => ({
        phase: (state.phase === 'docked' || state.phase === 'docking'
          ? 'docked'
          : 'floating') as SyncDockPhase,
        dockedAuthIds: state.dockedAuthIds,
      }),
    }
  )
)
