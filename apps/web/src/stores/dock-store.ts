// apps/web/src/stores/dock-store.ts
import { create } from 'zustand'
import { persist } from 'zustand/middleware'

/** Layout mode when multiple panels are open */
type DockLayoutMode = 'auto' | 'tabbed' | 'side-by-side'

/**
 * State for managing drawer dock mode preferences
 */
interface DockState {
  /** Whether the drawer is docked or overlaying */
  isDocked: boolean
  /** Width of the primary docked panel in pixels */
  dockedWidth: number
  /** Width of the secondary panel when in side-by-side mode */
  secondaryWidth: number
  /** Layout mode when multiple panels are open */
  layoutMode: DockLayoutMode
  /** Minimum width for docked panels */
  minWidth: number
  /** Maximum width for docked panels */
  maxWidth: number
  /** Breakpoint for auto mode to switch between tabbed/side-by-side */
  autoBreakpoint: number
  /** Toggle dock state */
  toggleDock: () => void
  /** Set dock state directly */
  setDocked: (docked: boolean) => void
  /** Set primary panel width */
  setDockedWidth: (width: number) => void
  /** Set secondary panel width */
  setSecondaryWidth: (width: number) => void
  /** Set layout mode */
  setLayoutMode: (mode: DockLayoutMode) => void
}

/**
 * Store for managing drawer dock preferences with localStorage persistence
 */
export const useDockStore = create<DockState>()(
  persist(
    (set) => ({
      isDocked: false,
      dockedWidth: 450,
      secondaryWidth: 400,
      layoutMode: 'auto',
      minWidth: 350,
      maxWidth: 800,
      autoBreakpoint: 1600,
      toggleDock: () => set((state) => ({ isDocked: !state.isDocked })),
      setDocked: (isDocked) => set({ isDocked }),
      setDockedWidth: (dockedWidth) => set({ dockedWidth }),
      setSecondaryWidth: (secondaryWidth) => set({ secondaryWidth }),
      setLayoutMode: (layoutMode) => set({ layoutMode }),
    }),
    {
      name: 'dock-preferences',
      partialize: (state) => ({
        isDocked: state.isDocked,
        dockedWidth: state.dockedWidth,
        secondaryWidth: state.secondaryWidth,
        layoutMode: state.layoutMode,
      }),
    }
  )
)

export type { DockLayoutMode }
