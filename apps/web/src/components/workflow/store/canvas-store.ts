// apps/web/src/components/workflow/store/canvas-store.ts

import type { Viewport } from '@xyflow/react'
import { create } from 'zustand'
import { subscribeWithSelector } from 'zustand/middleware'
import type { CanvasViewport } from './types'

interface WorkflowVersion {
  id: string
  title: string // This will be mapped from 'name' field in API response
  version: number
  createdAt: Date
  isPublished: boolean // This will be mapped from 'enabled' field in API response
  isDraft: boolean
}

interface CanvasStore {
  // Viewport state
  viewport: CanvasViewport
  isInteractive: boolean

  // Canvas settings
  snapToGrid: boolean
  gridSize: number
  showGrid: boolean
  showMinimap: boolean

  // Canvas state
  isConnecting: boolean
  connectionStartPoint: { x: number; y: number } | null
  isPanning: boolean
  isSelecting: boolean
  selectionBox: { x: number; y: number; width: number; height: number } | null

  // Version management
  showVersions: boolean
  readOnly: boolean
  selectedVersion: string | null
  versionPreviewData: WorkflowVersion | null

  // UI state
  blockSelectorOpen: boolean

  // Actions
  /**
   * @deprecated Use ReactFlow's setViewport()
   */
  setViewport: (viewport: Viewport) => void
  /**
   * @deprecated Use ReactFlow's fitView()
   */
  fitView: () => void
  /**
   * @deprecated Use ReactFlow's zoomIn()
   */
  zoomIn: () => void
  /**
   * @deprecated Use ReactFlow's zoomOut()
   */
  zoomOut: () => void
  resetView: () => void

  // Canvas settings
  toggleSnapToGrid: () => void
  setGridSize: (size: number) => void
  toggleGrid: () => void
  toggleMinimap: () => void

  // Interaction state
  setInteractive: (interactive: boolean) => void
  startConnection: (point: { x: number; y: number }) => void
  endConnection: () => void
  startPanning: () => void
  endPanning: () => void
  startSelection: (point: { x: number; y: number }) => void
  updateSelection: (endPoint: { x: number; y: number }) => void
  endSelection: () => void

  // Version management actions
  toggleVersions: () => void
  setReadOnly: (readOnly: boolean) => void
  selectVersion: (versionId: string | null) => void
  setVersionPreviewData: (data: WorkflowVersion | null) => void

  // UI actions
  setBlockSelectorOpen: (open: boolean) => void
  toggleBlockSelector: () => void

  // Utilities
  screenToCanvas: (screenX: number, screenY: number) => { x: number; y: number }
  canvasToScreen: (canvasX: number, canvasY: number) => { x: number; y: number }
}

/**
 * Create the canvas store for managing viewport and interaction state
 */
export const useCanvasStore = create<CanvasStore>()(
  subscribeWithSelector((set, get) => ({
    viewport: { x: 0, y: 0, zoom: 0.7 },
    isInteractive: true,

    snapToGrid: false,
    gridSize: 20,
    showGrid: true,
    showMinimap: true,

    isConnecting: false,
    connectionStartPoint: null,
    isPanning: false,
    isSelecting: false,
    selectionBox: null,

    // Version management initial state
    showVersions: false,
    readOnly: false,
    selectedVersion: null,
    versionPreviewData: null,

    // UI state initial values
    blockSelectorOpen: false,

    setViewport: (viewport) => {
      set({ viewport: { x: viewport.x, y: viewport.y, zoom: viewport.zoom } })
    },

    fitView: () => {
      // Emit an event for the canvas to handle with React Flow
      window.dispatchEvent(new CustomEvent('workflow:fitView'))
    },

    zoomIn: () => {
      // Emit an event for the canvas to handle with React Flow
      window.dispatchEvent(new CustomEvent('workflow:zoomIn'))
    },

    zoomOut: () => {
      // Emit an event for the canvas to handle with React Flow
      window.dispatchEvent(new CustomEvent('workflow:zoomOut'))
    },

    resetView: () => {
      set({ viewport: { x: 0, y: 0, zoom: 0.7 } })
    },

    toggleSnapToGrid: () => {
      set((state) => ({ snapToGrid: !state.snapToGrid }))
    },

    setGridSize: (size) => {
      set({ gridSize: Math.max(5, Math.min(50, size)) })
    },

    toggleGrid: () => {
      set((state) => ({ showGrid: !state.showGrid }))
    },

    toggleMinimap: () => {
      set((state) => ({ showMinimap: !state.showMinimap }))
    },

    setInteractive: (interactive) => {
      set({ isInteractive: interactive })
    },

    startConnection: (point) => {
      set({ isConnecting: true, connectionStartPoint: point })
    },

    endConnection: () => {
      set({ isConnecting: false, connectionStartPoint: null })
    },

    startPanning: () => {
      set({ isPanning: true })
    },

    endPanning: () => {
      set({ isPanning: false })
    },

    startSelection: (point) => {
      set({ isSelecting: true, selectionBox: { x: point.x, y: point.y, width: 0, height: 0 } })
    },

    updateSelection: (endPoint) => {
      const { selectionBox } = get()
      if (!selectionBox) return

      const width = endPoint.x - selectionBox.x
      const height = endPoint.y - selectionBox.y

      set({
        selectionBox: {
          x: width < 0 ? endPoint.x : selectionBox.x,
          y: height < 0 ? endPoint.y : selectionBox.y,
          width: Math.abs(width),
          height: Math.abs(height),
        },
      })
    },

    endSelection: () => {
      set({ isSelecting: false, selectionBox: null })
    },

    screenToCanvas: (screenX, screenY) => {
      const { viewport } = get()
      return {
        x: (screenX - viewport.x) / viewport.zoom,
        y: (screenY - viewport.y) / viewport.zoom,
      }
    },

    canvasToScreen: (canvasX, canvasY) => {
      const { viewport } = get()
      return { x: canvasX * viewport.zoom + viewport.x, y: canvasY * viewport.zoom + viewport.y }
    },

    // Version management actions
    toggleVersions: () => {
      set((state) => ({ showVersions: !state.showVersions }))
    },

    setReadOnly: (readOnly) => {
      set({ readOnly })
    },

    selectVersion: (versionId) => {
      set({ selectedVersion: versionId })
    },

    setVersionPreviewData: (data) => {
      set({ versionPreviewData: data })
    },

    // UI actions
    setBlockSelectorOpen: (open) => {
      set({ blockSelectorOpen: open })
    },

    toggleBlockSelector: () => {
      set((state) => ({ blockSelectorOpen: !state.blockSelectorOpen }))
    },
  }))
)
