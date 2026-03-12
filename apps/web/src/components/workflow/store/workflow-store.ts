// apps/web/src/components/workflow/store/workflow-store.ts

import { type Workflow, WorkflowTriggerType } from '@auxx/lib/workflow-engine/client'
import type { Node } from '@xyflow/react'
import { create } from 'zustand'
import { subscribeWithSelector } from 'zustand/middleware'
import type { HelpLineHorizontalPosition, HelpLineVerticalPosition } from '../ui/helpline/types'
import { useCanvasStore } from './canvas-store'
// import { useNodeStore } from './node-store'
import { useEdgeStore } from './edge-store'
import { storeEventBus } from './event-bus'
import { historyManager } from './history-manager'
import type { DragState, WorkflowMetadata } from './types'
import { useVarStore } from './use-var-store'

interface ModelData {
  providers: any[]
  defaultModel: {
    provider: string
    model: string
    mode: 'chat' | 'completion'
    completionParams: Record<string, any>
  } | null
}

interface WorkflowStore extends DragState {
  // State
  workflow: Workflow | null
  workflowId: string | null
  metadata: WorkflowMetadata | null
  workflowAppId: string | null
  /** Whether the workflow has at least one published version */
  hasPublishedVersion: boolean
  isDirty: boolean
  isLoading: boolean
  isSaving: boolean
  error: string | null
  modelData: ModelData | null

  /** Whether in viewer mode (read-only public embed) */
  isViewerMode: boolean
  /** Set viewer mode state */
  setViewerMode: (isViewer: boolean) => void

  // Helpline state
  helpLineHorizontal: HelpLineHorizontalPosition | null
  helpLineVertical: HelpLineVerticalPosition | null

  // Clipboard state
  clipboardElements: Node[]
  setClipboardElements: (clipboardElements: Node[]) => void

  // Actions
  // loadWorkflow: (workflowId: string) => Promise<void>
  /**
   * @deprecated Use useWorkflowSave().save() instead
   */
  // saveWorkflow: () => Promise<void>
  updateMetadata: (updates: Partial<WorkflowMetadata>) => void
  setWorkflow: (workflow: Workflow | null) => void
  clearWorkflow: () => void
  updateTriggerType: (triggerType: WorkflowTriggerType | null) => void
  setWorkflowAppId: (workflowAppId: string | null) => void

  // State management
  markDirty: () => void
  markClean: () => void
  setError: (error: string | null) => void
  clearError: () => void

  // Workflow operations
  createWorkflow: (data: Partial<Workflow>) => Promise<Workflow>
  deleteWorkflow: (workflowId: string) => Promise<void>
  duplicateWorkflow: (workflowId: string) => Promise<Workflow>

  // Export/Import
  exportWorkflow: () => string
  importWorkflow: (data: string) => Promise<void>

  // Helpline actions
  setHelpLineHorizontal: (helpLine?: HelpLineHorizontalPosition) => void
  setHelpLineVertical: (helpLine?: HelpLineVerticalPosition) => void

  // Drag performance actions
  setDragging: (isDragging: boolean, nodeIds?: string[]) => void
  addDraggedNode: (nodeId: string) => void
  removeDraggedNode: (nodeId: string) => void
  clearDraggedNodes: () => void

  // Resize state
  isResizing: boolean
  setResizing: (isResizing: boolean) => void

  // Connection state
  connectingNodePayload?: {
    nodeId: string
    nodeType: string
    handleType: 'source' | 'target'
    handleId?: string
  }
  enteringNodePayload?: { nodeId: string; nodeType: string }

  // Connection actions
  setConnectingNodePayload: (payload?: {
    nodeId: string
    nodeType: string
    handleType: 'source' | 'target'
    handleId?: string
  }) => void
  setEnteringNodePayload: (payload?: { nodeId: string; nodeType: string }) => void

  // Context menu state
  nodeMenu: { top: number; left: number; nodeId: string } | undefined
  paneMenu: { top: number; left: number } | undefined

  // Context menu actions
  setNodeMenu: (menu: { top: number; left: number; nodeId: string } | undefined) => void
  setPaneMenu: (menu: { top: number; left: number } | undefined) => void
  clearAllMenus: () => void

  // Development helpers
  validateConsistency: () => void
}

/**
 * Development helper to validate workflowId consistency
 */
const validateWorkflowIdConsistency = (workflow: Workflow | null, workflowId: string | null) => {
  if (process.env.NODE_ENV === 'development') {
    const expectedId = workflow?.id || null
    if (expectedId !== workflowId) {
      console.error('WorkflowId inconsistency detected!', {
        workflow: workflow?.name,
        expectedId,
        actualWorkflowId: workflowId,
      })
    }
  }
}

/**
 * Create the main workflow store
 */
export const useWorkflowStore = create<WorkflowStore>()(
  subscribeWithSelector((set, get) => ({
    workflow: null,
    workflowId: null,
    metadata: null,
    workflowAppId: null,
    hasPublishedVersion: false,
    isDirty: false,
    isLoading: false,
    isSaving: false,
    error: null,
    modelData: null,

    // Viewer mode (read-only public embed)
    isViewerMode: false,
    setViewerMode: (isViewer) => set({ isViewerMode: isViewer }),

    // Helpline initial state
    helpLineHorizontal: null,
    helpLineVertical: null,

    // Clipboard state
    clipboardElements: [],
    setClipboardElements: (clipboardElements) => {
      set({ clipboardElements })
    },

    // Drag state initial values
    isDragging: false,
    draggedNodes: new Set<string>(),
    dragStartTime: undefined,
    dragMode: null,

    // Resize state
    isResizing: false,

    // Connection state
    connectingNodePayload: undefined,
    enteringNodePayload: undefined,

    setConnectingNodePayload: (payload) => set({ connectingNodePayload: payload }),
    setEnteringNodePayload: (payload) => set({ enteringNodePayload: payload }),

    // Context menu state
    nodeMenu: undefined,
    paneMenu: undefined,

    // Context menu actions
    setNodeMenu: (menu) => set({ nodeMenu: menu }),
    setPaneMenu: (menu) => set({ paneMenu: menu }),
    clearAllMenus: () => set({ nodeMenu: undefined, paneMenu: undefined }),

    updateMetadata: (updates) => {
      const metadata = get().metadata
      if (!metadata) return

      set({ metadata: { ...metadata, ...updates }, isDirty: true })

      // Update workflow object as well
      const workflow = get().workflow
      if (workflow) {
        set({
          workflow: {
            ...workflow,
            name: updates.name || workflow.name,
            description:
              updates.description !== undefined ? updates.description : workflow.description,
          },
        })
      }
    },

    setWorkflow: (workflow) => {
      // Extract the correct workflowId - API responses have workflowId field,
      // while direct Workflow objects use id field
      const newWorkflowId = (workflow as any)?.workflowId || workflow?.id || null
      const newWorkflowAppId = (workflow as any)?.workflowAppId || null

      // Development-mode validation
      if (process.env.NODE_ENV === 'development') {
        const currentState = get()
        if (
          currentState.workflowId !== newWorkflowId &&
          currentState.workflowId !== null &&
          newWorkflowId !== null
        ) {
          console.warn('WorkflowId consistency warning:', {
            oldWorkflowId: currentState.workflowId,
            newWorkflowId,
            workflow: workflow?.name,
          })
        }
      }

      const updates: any = {
        workflow,
        workflowId: newWorkflowId,
        isDirty: true,
      }

      // Update workflowAppId if present in the workflow response
      if (newWorkflowAppId !== null) {
        updates.workflowAppId = newWorkflowAppId
      }

      set(updates)
    },

    clearWorkflow: () => {
      set({
        workflow: null,
        workflowId: null,
        metadata: null,
        hasPublishedVersion: false,
        isDirty: false,
      })
    },

    updateTriggerType: (triggerType) => {
      const workflow = get().workflow
      if (!workflow) return

      set((state) => ({ workflow: { ...state.workflow!, triggerType }, isDirty: true }))
    },

    setWorkflowAppId: (workflowAppId) => {
      set({ workflowAppId })
    },

    markDirty: () => {
      set({ isDirty: true })
    },

    markClean: () => {
      set({ isDirty: false })
    },

    setError: (error) => {
      set({ error })
    },

    clearError: () => {
      set({ error: null })
    },

    createWorkflow: async (data) => {
      set({ isLoading: true, error: null })

      try {
        const response = await fetch('/api/workflows', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: data.name || 'New Workflow',
            description: data.description || '',
            enabled: data.enabled || false,
            triggerType: data.triggerType || WorkflowTriggerType.MESSAGE_RECEIVED,
            triggerConfig: data.triggerConfig || {},
            nodes: [],
          }),
        })

        if (!response.ok) {
          const error = await response.json()
          throw new Error(error.error || 'Failed to create workflow')
        }

        const workflow = await response.json()
        set({ isLoading: false })

        return workflow as any
      } catch (error) {
        set({
          error: error instanceof Error ? error.message : 'Failed to create workflow',
          isLoading: false,
        })
        throw error
      }
    },

    deleteWorkflow: async (workflowId) => {
      set({ isLoading: true, error: null })

      try {
        const response = await fetch(`/api/workflows/${workflowId}`, { method: 'DELETE' })

        if (!response.ok) {
          const error = await response.json()
          throw new Error(error.error || 'Failed to delete workflow')
        }

        // Clear stores
        set({ workflow: null, workflowId: null, metadata: null, isDirty: false, isLoading: false })
        // useNodeStore.getState().clearNodes()
        useEdgeStore.getState().clearEdges()
        historyManager.clear()
      } catch (error) {
        set({
          error: error instanceof Error ? error.message : 'Failed to delete workflow',
          isLoading: false,
        })
        throw error
      }
    },

    duplicateWorkflow: async (workflowId) => {
      set({ isLoading: true, error: null })

      try {
        // TODO: Replace with actual API call
        const response = await fetch(`/api/workflows/${workflowId}/duplicate`, { method: 'POST' })

        if (!response.ok) throw new Error('Failed to duplicate workflow')

        const workflow = await response.json()

        set({ isLoading: false })

        return workflow
      } catch (error) {
        set({
          error: error instanceof Error ? error.message : 'Failed to duplicate workflow',
          isLoading: false,
        })
        throw error
      }
    },

    exportWorkflow: () => {
      const { workflow, metadata } = get()

      if (!workflow || !metadata) {
        throw new Error('No workflow to export')
      }

      // Get current nodes and edges from stores
      // const nodes = useNodeStore.getState().nodes
      const edges = useEdgeStore.getState().edges
      const envVariables = Array.from(useVarStore.getState().environmentVariables.values())
      const viewport = useCanvasStore.getState().viewport

      const exportData = {
        id: metadata.id,
        envVars: envVariables,
        graph: { nodes, edges, viewport },
      }

      return JSON.stringify(exportData, null, 2)
    },

    importWorkflow: async (data) => {
      set({ isLoading: true, error: null })

      try {
        const importData = JSON.parse(data)

        if (!importData.workflow) {
          throw new Error('Invalid workflow data')
        }

        // Create new workflow from imported data
        const workflow = await get().createWorkflow({
          ...importData.workflow,
          name: `${importData.workflow.name} (Imported)`,
          id: undefined, // Let the server generate new ID
        })

        set({
          workflow,
          workflowId: workflow.id,
          metadata: { ...importData.metadata, id: workflow.id, lastModified: new Date() },
          isLoading: false,
        })
      } catch (error) {
        set({
          error: error instanceof Error ? error.message : 'Failed to import workflow',
          isLoading: false,
        })
        throw error
      }
    },

    setHelpLineHorizontal: (helpLine) => {
      set({ helpLineHorizontal: helpLine ?? null })
    },

    setHelpLineVertical: (helpLine) => {
      set({ helpLineVertical: helpLine ?? null })
    },

    // Drag performance methods
    setDragging: (isDragging, nodeIds = []) => {
      const dragStartTime = isDragging ? Date.now() : undefined
      const draggedNodes = new Set(nodeIds)
      const dragMode = nodeIds.length > 1 ? 'multi' : nodeIds.length === 1 ? 'single' : null

      set({ isDragging, draggedNodes, dragStartTime, dragMode })

      // Emit drag events
      if (isDragging) {
        storeEventBus.emit({ type: 'drag:started', data: { nodeIds } })
      } else {
        const duration = get().dragStartTime ? Date.now() - get().dragStartTime! : 0
        storeEventBus.emit({ type: 'drag:ended', data: { nodeIds, duration } })
      }
    },

    addDraggedNode: (nodeId) => {
      const state = get()
      if (!state.isDragging) return

      const draggedNodes = new Set(state.draggedNodes)
      draggedNodes.add(nodeId)

      set({ draggedNodes, dragMode: draggedNodes.size > 1 ? 'multi' : 'single' })
    },

    removeDraggedNode: (nodeId) => {
      const state = get()
      const draggedNodes = new Set(state.draggedNodes)
      draggedNodes.delete(nodeId)

      set({
        draggedNodes,
        dragMode: draggedNodes.size > 1 ? 'multi' : draggedNodes.size === 1 ? 'single' : null,
      })
    },

    clearDraggedNodes: () => {
      set({ draggedNodes: new Set(), dragMode: null })
    },

    setResizing: (isResizing) => {
      set({ isResizing })
      console.log('WorkflowStore: setResizing', isResizing)
    },

    validateConsistency: () => {
      const state = get()
      validateWorkflowIdConsistency(state.workflow, state.workflowId)
    },
  }))
)
