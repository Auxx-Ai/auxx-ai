// apps/web/src/components/workflow/store/selection-store.ts

import { create } from 'zustand'
import { subscribeWithSelector } from 'zustand/middleware'
import { storeEventBus } from './event-bus'
import type { SelectionState } from './types'

interface SelectionStore extends SelectionState {
  // Selection actions
  /**
   * @deprecated Use ReactFlow's node selection
   */
  selectNode: (nodeId: string, multi?: boolean) => void
  /**
   * @deprecated Use ReactFlow's edge selection
   */
  selectEdge: (edgeId: string, multi?: boolean) => void
  /**
   * @deprecated Use ReactFlow's node selection
   */
  selectNodes: (nodeIds: string[]) => void
  /**
   * @deprecated Use ReactFlow's edge selection
   */
  selectEdges: (edgeIds: string[]) => void

  // Deselection
  /**
   * @deprecated Use ReactFlow's node selection
   */
  deselectNode: (nodeId: string) => void
  /**
   * @deprecated Use ReactFlow's edge selection
   */
  deselectEdge: (edgeId: string) => void
  /**
   * @deprecated Use ReactFlow's selection API
   */
  deselectAll: () => void

  // Toggle selection
  toggleNodeSelection: (nodeId: string) => void
  toggleEdgeSelection: (edgeId: string) => void

  // Selection queries
  isNodeSelected: (nodeId: string) => boolean
  isEdgeSelected: (edgeId: string) => boolean
  getSelectedNodes: () => string[]
  getSelectedEdges: () => string[]
  hasSelection: () => boolean

  // Batch operations
  /**
   * @deprecated Use ReactFlow's selection API
   */
  // selectAll: () => void
  /**
   * @deprecated Use ReactFlow's selection API
   */
  invertSelection: () => void
}

/**
 * Create the selection store for managing selected elements
 */
export const useSelectionStore = create<SelectionStore>()(
  subscribeWithSelector((set, get) => ({
    /**
     * @deprecated Will be removed - use ReactFlow's getNodes().filter(n => n.selected)
     */
    nodes: new Set<string>(),
    /**
     * @deprecated Will be removed - use ReactFlow's getEdges().filter(e => e.selected)
     */
    edges: new Set<string>(),

    selectNode: (nodeId, multi = false) => {
      set((state) => {
        const nodes = multi ? new Set(state.nodes) : new Set<string>()
        nodes.add(nodeId)

        // Clear edge selection unless multi-selecting
        const edges = multi ? state.edges : new Set<string>()

        return { nodes, edges }
      })

      // Emit selection event
      storeEventBus.emit({
        type: 'selection:changed',
        data: { nodes: Array.from(get().nodes), edges: Array.from(get().edges) },
      })
    },

    selectEdge: (edgeId, multi = false) => {
      set((state) => {
        const edges = multi ? new Set(state.edges) : new Set<string>()
        edges.add(edgeId)

        // Clear node selection unless multi-selecting
        const nodes = multi ? state.nodes : new Set<string>()

        return { nodes, edges }
      })

      // Emit selection event
      storeEventBus.emit({
        type: 'selection:changed',
        data: { nodes: Array.from(get().nodes), edges: Array.from(get().edges) },
      })
    },

    selectNodes: (nodeIds) => {
      set({ nodes: new Set(nodeIds), edges: new Set<string>() })

      // Emit selection event
      storeEventBus.emit({ type: 'selection:changed', data: { nodes: nodeIds, edges: [] } })
    },

    selectEdges: (edgeIds) => {
      set({ nodes: new Set<string>(), edges: new Set(edgeIds) })

      // Emit selection event
      storeEventBus.emit({ type: 'selection:changed', data: { nodes: [], edges: edgeIds } })
    },

    deselectNode: (nodeId) => {
      set((state) => {
        const nodes = new Set(state.nodes)
        nodes.delete(nodeId)
        return { nodes }
      })

      // Emit selection event
      storeEventBus.emit({
        type: 'selection:changed',
        data: { nodes: Array.from(get().nodes), edges: Array.from(get().edges) },
      })
    },

    deselectEdge: (edgeId) => {
      set((state) => {
        const edges = new Set(state.edges)
        edges.delete(edgeId)
        return { edges }
      })

      // Emit selection event
      storeEventBus.emit({
        type: 'selection:changed',
        data: { nodes: Array.from(get().nodes), edges: Array.from(get().edges) },
      })
    },

    deselectAll: () => {
      const hadSelection = get().hasSelection()

      set({ nodes: new Set<string>(), edges: new Set<string>() })

      // Only emit if there was a selection
      if (hadSelection) {
        storeEventBus.emit({ type: 'selection:changed', data: { nodes: [], edges: [] } })
      }
    },

    toggleNodeSelection: (nodeId) => {
      const isSelected = get().nodes.has(nodeId)

      if (isSelected) {
        get().deselectNode(nodeId)
      } else {
        get().selectNode(nodeId, true)
      }
    },

    toggleEdgeSelection: (edgeId) => {
      const isSelected = get().edges.has(edgeId)

      if (isSelected) {
        get().deselectEdge(edgeId)
      } else {
        get().selectEdge(edgeId, true)
      }
    },

    isNodeSelected: (nodeId) => {
      return get().nodes.has(nodeId)
    },

    isEdgeSelected: (edgeId) => {
      return get().edges.has(edgeId)
    },

    getSelectedNodes: () => {
      return Array.from(get().nodes)
    },

    getSelectedEdges: () => {
      return Array.from(get().edges)
    },

    hasSelection: () => {
      const state = get()
      return state.nodes.size > 0 || state.edges.size > 0
    },

    // selectAll: () => {
    // This would need access to all nodes and edges
    // For now, we'll emit an event for the canvas to handle
    // window.dispatchEvent(new CustomEvent('workflow:selectAll'))
    // },

    invertSelection: () => {
      // This would need access to all nodes and edges
      // For now, we'll emit an event for the canvas to handle
      window.dispatchEvent(new CustomEvent('workflow:invertSelection'))
    },
  }))
)

// Listen for node/edge deletion to update selection
storeEventBus.on('node:deleted', ({ nodeId }) => {
  const store = useSelectionStore.getState()
  if (store.isNodeSelected(nodeId)) {
    store.deselectNode(nodeId)
  }
})

storeEventBus.on('edge:deleted', ({ edgeId }) => {
  const store = useSelectionStore.getState()
  if (store.isEdgeSelected(edgeId)) {
    store.deselectEdge(edgeId)
  }
})
