// apps/web/src/components/dispatch/stores/dispatch-sidebar-store.ts

import { create } from 'zustand'
import { persist } from 'zustand/middleware'

interface DispatchSidebarState {
  /** Whole module sidebar, open/closed. Default open. */
  open: boolean
  /** Per-group collapse state, keyed by group id (`'workers' | 'tags' | 'backlog' | 'routes' |
   * 'routes:<userId>'`). Missing key = open (all groups default expanded). */
  groupOpen: Record<string, boolean>
  /** Inverse of worker visibility — `[]` = every worker (and Unassigned) visible, the default.
   * Persisting the hidden set (not the selected set) means a newly added worker defaults to
   * visible without needing a migration. May contain the `UNASSIGNED_RESOURCE_ID` sentinel
   * (`board/types.ts`) for the Unassigned row. */
  hiddenWorkerIds: string[]
  /** `null` = every tag visible (map mode only). */
  selectedTags: string[] | null
  setOpen: (open: boolean) => void
  setGroupOpen: (key: string, open: boolean) => void
  toggleWorkerHidden: (workerId: string) => void
  setSelectedTags: (tags: string[] | null) => void
}

/**
 * Dispatch module sidebar persistence (v3 sidebar plan §1.1) — localStorage, following
 * `dock-store.ts`'s shape. Consumers must use selectors (`useDispatchSidebarStore((s) => s.x)`),
 * never destructure the whole store, per the project's Zustand convention.
 */
export const useDispatchSidebarStore = create<DispatchSidebarState>()(
  persist(
    (set) => ({
      open: true,
      groupOpen: {},
      hiddenWorkerIds: [],
      selectedTags: null,
      setOpen: (open) => set({ open }),
      setGroupOpen: (key, open) =>
        set((state) => ({ groupOpen: { ...state.groupOpen, [key]: open } })),
      toggleWorkerHidden: (workerId) =>
        set((state) => {
          const hidden = new Set(state.hiddenWorkerIds)
          if (hidden.has(workerId)) hidden.delete(workerId)
          else hidden.add(workerId)
          return { hiddenWorkerIds: Array.from(hidden) }
        }),
      setSelectedTags: (tags) => set({ selectedTags: tags }),
    }),
    { name: 'dispatch-sidebar' }
  )
)
