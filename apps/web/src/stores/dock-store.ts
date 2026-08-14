// apps/web/src/stores/dock-store.ts
import { create } from 'zustand'
import { persist } from 'zustand/middleware'

/**
 * State for managing drawer dock mode preferences
 */
interface DockState {
  /** Whether the drawer is docked or overlaying */
  isDocked: boolean
  /** Width of the docked panel in pixels */
  dockedWidth: number
  /** Minimum width for docked panels */
  minWidth: number
  /** Maximum width for docked panels */
  maxWidth: number
  /** Toggle dock state */
  toggleDock: () => void
  /** Set dock state directly */
  setDocked: (docked: boolean) => void
  /** Set panel width */
  setDockedWidth: (width: number) => void
}

/**
 * Store for managing drawer dock preferences with localStorage persistence.
 *
 * The persisted key is versioned: v1 carried `secondaryWidth`/`layoutMode` for
 * the retired side-by-side docking model, and a stored `layoutMode: 'tabbed'`
 * would otherwise linger with nothing to read it.
 */
export const useDockStore = create<DockState>()(
  persist(
    (set) => ({
      isDocked: false,
      dockedWidth: 450,
      minWidth: 350,
      maxWidth: 800,
      toggleDock: () => set((state) => ({ isDocked: !state.isDocked })),
      setDocked: (isDocked) => set({ isDocked }),
      setDockedWidth: (dockedWidth) => set({ dockedWidth }),
    }),
    {
      name: 'dock-preferences-v2',
      partialize: (state) => ({
        isDocked: state.isDocked,
        dockedWidth: state.dockedWidth,
      }),
    }
  )
)
