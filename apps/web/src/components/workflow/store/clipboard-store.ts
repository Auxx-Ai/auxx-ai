// apps/web/src/components/workflow/store/clipboard-store.ts

import { create } from 'zustand'
import { subscribeWithSelector } from 'zustand/middleware'
import type { FlowNode, FlowEdge } from './types'
import { storeEventBus } from './event-bus'
import { cloneDeep } from '@auxx/utils'

/**
 * Clipboard data structure containing copied nodes and their relationships
 */
export interface ClipboardData {
  nodes: FlowNode[]
  edges: FlowEdge[]
  copiedAt: Date
  originalPositions: { nodeId: string; position: { x: number; y: number } }[]
}

interface ClipboardStore {
  // State
  data: ClipboardData | null

  // Actions
  copyNodes: (nodes: FlowNode[], edges: FlowEdge[]) => void
  clear: () => void
  isEmpty: () => boolean
  hasContent: () => boolean

  // Getters
  getClipboardData: () => ClipboardData | null
  getNodeCount: () => number
  getEdgeCount: () => number
}

/**
 * Store for managing clipboard operations in the workflow editor
 */
export const useClipboardStore = create<ClipboardStore>()(
  subscribeWithSelector((set, get) => ({
    data: null,

    copyNodes: (nodes, edges) => {
      if (nodes.length === 0) {
        console.warn('No nodes to copy')
        return
      }

      // Deep clone nodes and edges to prevent reference sharing
      const clonedNodes = cloneDeep(nodes)
      const clonedEdges = cloneDeep(edges)

      // Store original positions for smart paste positioning
      const originalPositions = nodes.map((node) => ({
        nodeId: node.id,
        position: { ...node.position },
      }))

      const clipboardData: ClipboardData = {
        nodes: clonedNodes,
        edges: clonedEdges,
        copiedAt: new Date(),
        originalPositions,
      }

      set({ data: clipboardData })

      // Emit event
      storeEventBus.emit({
        type: 'clipboard:copied',
        data: {
          nodeCount: nodes.length,
          edgeCount: edges.length,
        },
      })
    },

    clear: () => {
      const hadContent = get().hasContent()

      set({ data: null })

      if (hadContent) {
        storeEventBus.emit({
          type: 'clipboard:cleared',
          data: {},
        })
      }
    },

    isEmpty: () => {
      return get().data === null
    },

    hasContent: () => {
      return get().data !== null && get().data.nodes.length > 0
    },

    getClipboardData: () => {
      return get().data
    },

    getNodeCount: () => {
      const data = get().data
      return data ? data.nodes.length : 0
    },

    getEdgeCount: () => {
      const data = get().data
      return data ? data.edges.length : 0
    },
  }))
)
