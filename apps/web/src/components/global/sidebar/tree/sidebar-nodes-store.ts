// apps/web/src/components/global/sidebar/tree/sidebar-nodes-store.ts

import {
  type DehydratedSidebar,
  parseSidebarLayoutSnapshot,
  type ResolvedSidebarLayout,
  type ResourceNavEntry,
  resolveSidebarLayout,
  type SidebarLayoutSnapshot,
  type SidebarNodeEntity,
} from '@auxx/lib/sidebar-layout/client'
import { createStore } from 'zustand/vanilla'

export interface SidebarNodesState {
  /** Every SidebarNode row of the member (favorites and layout). */
  nodes: SidebarNodeEntity[]
  /** Def projection; null until known (entity rows render skeletons meanwhile). */
  resourceNav: ResourceNavEntry[] | null
  /** The org default layout (`sidebar.defaultLayout`), parsed. */
  snapshot: SidebarLayoutSnapshot | null
  /** Optimistic tree shown while layout mutations are in flight. */
  pendingLayout: ResolvedSidebarLayout | null
  /** Where a sidebar drag would land right now; beats `pendingLayout` until the drag ends. */
  dragLayout: ResolvedSidebarLayout | null

  setNodes: (nodes: SidebarNodeEntity[]) => void
  setResourceNav: (resourceNav: ResourceNavEntry[] | null) => void
  setSnapshot: (snapshot: SidebarLayoutSnapshot | null) => void
  setPendingLayout: (layout: ResolvedSidebarLayout | null) => void
  setDragLayout: (layout: ResolvedSidebarLayout | null) => void
  upsert: (node: SidebarNodeEntity) => void
  removeById: (id: string) => void
}

/** One store per app shell, seeded synchronously from the dehydrated `sidebar` so SSR and hydration agree. */
export function createSidebarNodesStore(
  initial?: DehydratedSidebar | null,
  defaultLayoutSetting?: unknown
) {
  return createStore<SidebarNodesState>()((set) => ({
    nodes: initial?.nodes ?? [],
    resourceNav: initial?.resourceNav ?? null,
    snapshot: parseSidebarLayoutSnapshot(defaultLayoutSetting),
    pendingLayout: null,
    dragLayout: null,

    setNodes: (nodes) => set({ nodes }),
    setResourceNav: (resourceNav) => set({ resourceNav }),
    setSnapshot: (snapshot) => set({ snapshot }),
    setPendingLayout: (pendingLayout) => set({ pendingLayout }),
    setDragLayout: (dragLayout) => set({ dragLayout }),
    upsert: (node) => set((s) => ({ nodes: [...s.nodes.filter((n) => n.id !== node.id), node] })),
    removeById: (id) =>
      set((s) => {
        const removed = s.nodes.find((n) => n.id === id)
        // A deleted folder's children move up to its parent (the server re-homes them).
        return {
          nodes: s.nodes
            .filter((n) => n.id !== id)
            .map((n) => (n.parentId === id ? { ...n, parentId: removed?.parentId ?? null } : n)),
        }
      }),
  }))
}

export type SidebarNodesStoreApi = ReturnType<typeof createSidebarNodesStore>

let lastInput: Pick<SidebarNodesState, 'nodes' | 'resourceNav' | 'snapshot'> | null = null
let lastLayout: ResolvedSidebarLayout | null = null

/** The layout to render: the drag preview, else the optimistic one, else resolved from rows. */
export function selectSidebarLayout(state: SidebarNodesState): ResolvedSidebarLayout {
  if (state.dragLayout) return state.dragLayout
  if (state.pendingLayout) return state.pendingLayout
  if (
    lastLayout &&
    lastInput?.nodes === state.nodes &&
    lastInput.resourceNav === state.resourceNav &&
    lastInput.snapshot === state.snapshot
  ) {
    return lastLayout
  }
  lastInput = { nodes: state.nodes, resourceNav: state.resourceNav, snapshot: state.snapshot }
  lastLayout = resolveSidebarLayout({
    nodes: state.nodes,
    snapshot: state.snapshot,
    resources: state.resourceNav ?? [],
  })
  return lastLayout
}
