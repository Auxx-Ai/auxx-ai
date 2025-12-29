// apps/web/src/components/workflow/store/edge-store.ts

import { create } from 'zustand'
import { subscribeWithSelector } from 'zustand/middleware'
import type { FlowEdge, EdgeUpdate } from './types'
import { historyManager } from './history-manager'
import { storeEventBus } from './event-bus'
import { applyEdgeChanges, type EdgeChange, type Connection } from '@xyflow/react'
import { useWorkflowStore } from './workflow-store'
// import { calculateEdgeZIndex } from '../utils/edge-utils'

export interface HistoryOptions {
  skipHistory?: boolean
}

interface EdgeStore {
  // State
  /**
   * @deprecated Will be removed - use ReactFlow's edges state
   */
  edges: FlowEdge[]
  /**
   * @deprecated Will be removed - use ReactFlow's edges
   */
  edgeMap: Map<string, FlowEdge>

  // CRUD operations
  /**
   * @deprecated Use useStoreApi() .setEdges instead
   */
  addEdge: (edge: FlowEdge, options?: HistoryOptions) => void
  /**
   * @deprecated Use useStoreApi() .setEdges instead (not implemented yet)
   */
  updateEdge: (id: string, updates: Partial<FlowEdge>, options?: HistoryOptions) => void
  /**
   * @deprecated Use useStoreApi() .setEdges instead
   */
  deleteEdge: (id: string, options?: HistoryOptions) => void

  // Batch operations
  /**
   * @deprecated Use useStoreApi() .setEdges instead
   */
  batchUpdate: (updates: EdgeUpdate[]) => void
  /**
   * @deprecated Use useStoreApi() .setEdges instead
   */
  batchUpdateStatuses: (updates: Array<{ id: string; data: any }>) => void
  /**
   * @deprecated Use ReactFlow's setEdges directly
   */
  setEdges: (edges: FlowEdge[]) => void
  /**
   * @deprecated Use useStoreApi() .setEdges instead
   */
  clearEdges: () => void

  // React Flow handlers
  /**
   * @deprecated ReactFlow handles this internally
   */
  onEdgesChange: (changes: EdgeChange[]) => void
  /**
   * @deprecated Use useStoreApi() .setEdges instead
   */
  onConnect: (connection: Connection) => void

  // Queries
  /**
   * @deprecated Use ReactFlow's edges.find()
   */
  getEdge: (id: string) => FlowEdge | undefined
  /**
   * @deprecated Use EdgeValidationService.getEdgesByNode() with ReactFlow edges
   */
  getEdgesByNode: (nodeId: string, type?: 'source' | 'target') => FlowEdge[]
  /**
   * @deprecated Use EdgeValidationService.getConnectedEdges() with ReactFlow edges
   */
  getConnectedEdges: (nodeId: string) => FlowEdge[]
  // Keep for business logic - move to EdgeValidationService
  isValidConnection: (connection: Connection) => boolean
  checkParallelLimit: (nodeId: string, nodeHandle?: string) => boolean

  // Validation
  validateEdge: (edgeId: string) => { isValid: boolean; errors: string[] }
  validateAllEdges: () => Map<string, { isValid: boolean; errors: string[] }>
}

/**
 * Create the edge store with Zustand
 */
export const useEdgeStore = create<EdgeStore>()(
  subscribeWithSelector((set, get) => ({
    edges: [],
    edgeMap: new Map(),

    addEdge: (edge, options = {}) => {
      const state = get()

      // Check if edge already exists
      if (state.edgeMap.has(edge.id)) {
        console.warn(`Edge with id ${edge.id} already exists`)
        return
      }

      // Check for duplicate connections
      const existingEdge = state.edges.find(
        (e) =>
          e.source === edge.source &&
          e.target === edge.target &&
          e.sourceHandle === edge.sourceHandle &&
          e.targetHandle === edge.targetHandle
      )

      if (existingEdge) {
        console.warn('Duplicate edge connection')
        return
      }

      // Update state
      set((state) => {
        const edges = [...state.edges, edge]
        const edgeMap = new Map(state.edgeMap)
        edgeMap.set(edge.id, edge)

        return { edges, edgeMap }
      })

      // Record in history and mark workflow dirty
      if (!options.skipHistory) {
        historyManager.record({
          action: 'addEdge',
          store: 'edge',
          data: edge,
          label: `Connect nodes`,
        })

        // Mark workflow as dirty
        useWorkflowStore.getState().markDirty()
      }

      // Emit event
      storeEventBus.emit({ type: 'edge:added', data: { edge } })
    },

    updateEdge: (id, updates, options = {}) => {
      const oldEdge = get().edgeMap.get(id)
      if (!oldEdge) {
        console.warn(`Edge with id ${id} not found`)
        return
      }

      // Update state
      set((state) => {
        const edgeIndex = state.edges.findIndex((e) => e.id === id)
        if (edgeIndex === -1) return state

        const updatedEdge = { ...oldEdge, ...updates }
        const edges = [...state.edges]
        edges[edgeIndex] = updatedEdge

        const edgeMap = new Map(state.edgeMap)
        edgeMap.set(id, updatedEdge)

        return { edges, edgeMap }
      })

      // Record in history and mark workflow dirty
      if (!options.skipHistory) {
        historyManager.record({
          action: 'updateEdge',
          store: 'edge',
          data: { id, old: oldEdge, new: updates },
          label: `Update connection`,
        })

        // Mark workflow as dirty
        useWorkflowStore.getState().markDirty()
      }

      // Emit event
      storeEventBus.emit({ type: 'edge:updated', data: { edgeId: id, updates } })
    },

    deleteEdge: (id, options = {}) => {
      const edgeToDelete = get().edgeMap.get(id)
      if (!edgeToDelete) {
        console.warn(`Edge with id ${id} not found`)
        return
      }

      // Update state
      set((state) => {
        const edges = state.edges.filter((e) => e.id !== id)
        const edgeMap = new Map(state.edgeMap)
        edgeMap.delete(id)

        return { edges, edgeMap }
      })

      // Record in history and mark workflow dirty
      if (!options.skipHistory) {
        historyManager.record({
          action: 'deleteEdge',
          store: 'edge',
          data: edgeToDelete,
          label: `Delete connection`,
        })

        // Mark workflow as dirty
        useWorkflowStore.getState().markDirty()
      }

      // Emit event
      storeEventBus.emit({ type: 'edge:deleted', data: { edgeId: id } })
    },

    batchUpdate: (updates) => {
      historyManager.startBatch('Batch update edges')

      updates.forEach(({ id, updates }) => {
        get().updateEdge(id, updates)
      })

      historyManager.endBatch()
    },

    batchUpdateStatuses: (updates) => {
      // Optimized batch update for status changes only
      // Doesn't trigger history or dirty state
      set((state) => {
        const edges = [...state.edges]
        const edgeMap = new Map(state.edgeMap)

        updates.forEach(({ id, data }) => {
          const edgeIndex = edges.findIndex((e) => e.id === id)
          if (edgeIndex !== -1) {
            const edge = edges[edgeIndex]
            const updatedEdge = { ...edge, data }
            edges[edgeIndex] = updatedEdge
            edgeMap.set(id, updatedEdge)
          }
        })

        return { edges, edgeMap }
      })
    },

    setEdges: (edges) => {
      const edgeMap = new Map(edges.map((edge) => [edge.id, edge]))
      set({ edges, edgeMap })
    },

    clearEdges: () => {
      set({ edges: [], edgeMap: new Map() })
    },

    onEdgesChange: (changes) => {
      set((state) => {
        const edges = applyEdgeChanges(changes, state.edges)
        const edgeMap = new Map(edges.map((edge) => [edge.id, edge]))
        return { edges, edgeMap }
      })

      // Handle specific change types
      changes.forEach((change) => {
        if (change.type === 'remove') {
          storeEventBus.emit({ type: 'edge:deleted', data: { edgeId: change.id } })
        }
      })
    },

    onConnect: (connection) => {
      // Validate connection first
      if (!get().isValidConnection(connection)) {
        console.warn('Invalid connection')
        return
      }

      // Get node types for edge data
      // Use lazy import to avoid circular dependency
      const getNodeStore = () => {
        const nodeStoreModule = require('./node-store')
        return nodeStoreModule.useNodeStore.getState()
      }

      let sourceNode: any = null
      let targetNode: any = null
      try {
        const nodeStore = getNodeStore()
        sourceNode = nodeStore.getNode(connection.source!)
        targetNode = nodeStore.getNode(connection.target!)
      } catch (error) {
        console.warn('Could not access node store for edge creation:', error)
      }

      // Create new edge with unique ID
      const edgeId = [
        connection.source,
        connection.sourceHandle || 'default',
        connection.target,
        connection.targetHandle || 'default',
        Date.now(),
      ].join('-')

      // Determine if this is a loop back edge
      const isLoopBackEdge = targetNode?.type === 'loop' && connection.targetHandle === 'loop-back'

      // Import graph utils for loop detection
      const { isNodeInLoop, getContainingLoopId } = require('../utils/graph-utils')

      // Get all nodes for loop detection
      let nodes: any[] = []
      try {
        const nodeStore = getNodeStore()
        nodes = nodeStore.nodes || []
      } catch (error) {
        console.warn('Could not access nodes for loop detection:', error)
      }

      // Determine loop context
      const sourceLoopId = getContainingLoopId(connection.source!, nodes)
      const targetLoopId = getContainingLoopId(connection.target!, nodes)
      const loopId = sourceLoopId || targetLoopId

      const newEdge: FlowEdge = {
        id: edgeId,
        source: connection.source!,
        target: connection.target!,
        sourceHandle: connection.sourceHandle || undefined,
        targetHandle: connection.targetHandle || undefined,
        type: isLoopBackEdge ? 'loop' : 'default',
        data: {
          sourceType: sourceNode?.data?.type || '',
          targetType: targetNode?.data?.type || '',
          isInLoop: Boolean(loopId),
          isLoopBackEdge,
          loopId: loopId || undefined,
        },
      }

      get().addEdge(newEdge)
    },

    getEdge: (id) => {
      return get().edgeMap.get(id)
    },

    getEdgesByNode: (nodeId, type) => {
      const edges = get().edges

      if (type === 'source') {
        return edges.filter((edge) => edge.source === nodeId)
      } else if (type === 'target') {
        return edges.filter((edge) => edge.target === nodeId)
      }

      return edges.filter((edge) => edge.source === nodeId || edge.target === nodeId)
    },

    getConnectedEdges: (nodeId) => {
      return get().edges.filter((edge) => edge.source === nodeId || edge.target === nodeId)
    },

    isValidConnection: (connection) => {
      // Basic validation
      if (!connection.source || !connection.target) {
        return false
      }

      // Prevent self-connections
      if (connection.source === connection.target) {
        return false
      }

      // Check for duplicate connections
      const existingEdge = get().edges.find(
        (edge) =>
          edge.source === connection.source &&
          edge.target === connection.target &&
          edge.sourceHandle === connection.sourceHandle &&
          edge.targetHandle === connection.targetHandle
      )

      if (existingEdge) {
        return false
      }

      // Note: Advanced validation (node types, cycles, parallel limits) is now handled
      // by ReactFlow's isValidConnection prop in the canvas component

      return true
    },

    checkParallelLimit: (nodeId: string, nodeHandle = 'source') => {
      // This method is kept for backwards compatibility
      // Actual validation is now handled by the connection-validation utility
      const { edges } = get()
      const connectedEdges = edges.filter(
        (edge) => edge.source === nodeId && edge.sourceHandle === nodeHandle
      )
      // Use a default limit of 10 for backwards compatibility
      return connectedEdges.length < 10
    },

    validateEdge: (edgeId) => {
      const edge = get().edgeMap.get(edgeId)
      if (!edge) {
        return { isValid: false, errors: ['Edge not found'] }
      }

      const errors: string[] = []

      // Basic validation
      if (!edge.source || !edge.target) {
        errors.push('Edge must have source and target')
      }

      // Type-specific validation would go here
      // This would use the node registry to check connection compatibility

      return { isValid: errors.length === 0, errors }
    },

    validateAllEdges: () => {
      const results = new Map<string, { isValid: boolean; errors: string[] }>()

      get().edges.forEach((edge) => {
        results.set(edge.id, get().validateEdge(edge.id))
      })

      return results
    },
  }))
)

// Register store with history manager
historyManager.registerStore('edge', useEdgeStore.getState())

// Listen for node deletions to clean up connected edges
storeEventBus.on('node:deleted', ({ nodeId }) => {
  const store = useEdgeStore.getState()
  const connectedEdges = store.getConnectedEdges(nodeId)

  // Delete all edges connected to the deleted node
  connectedEdges.forEach((edge) => {
    store.deleteEdge(edge.id, { skipHistory: true })
  })
})
