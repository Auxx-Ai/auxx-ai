// apps/web/src/components/workflow/store/index.ts

// Export all types and utilities
export * from './types'
export * from './event-bus'
export * from './history-manager'

// Export all stores (this already exports the hooks)
export * from './node-store'
export * from './edge-store'
// export * from './variable-store' // DEPRECATED
// export * from './unified-variable-store' // DEPRECATED - use use-var-store
export * from './use-var-store'
export * from './workflow-store'
export * from './canvas-store'
export * from './selection-store'
export * from './panel-store'
// resource-field-store removed - use stores from ~/components/resources

// Import stores for internal use
// import { useEdgeStore } from './edge-store'
import { useVarStore } from './use-var-store'
import { useWorkflowStore } from './workflow-store'
import { useCanvasStore } from './canvas-store'
import { useSelectionStore } from './selection-store'
import { usePanelStore } from './panel-store'
// System and environment variables are now initialized in var store

/**
 * Combined store interface for easy access to all stores
 */
export interface WorkflowStores {
  // edgeStore: ReturnType<typeof useEdgeStore.getState>
  varStore: ReturnType<typeof useVarStore.getState>
  workflowStore: ReturnType<typeof useWorkflowStore.getState>
  canvasStore: ReturnType<typeof useCanvasStore.getState>
  selectionStore: ReturnType<typeof useSelectionStore.getState>
  panelStore: ReturnType<typeof usePanelStore.getState>
}

/**
 * Singleton instance of workflow stores for stable reference
 * Only created once on first access
 */
let workflowStoresInstance: WorkflowStores | null = null

/**
 * Get all workflow stores
 *
 * Note: This creates a new object on each call, but it's safe because:
 * 1. It's only used in non-render contexts (effects, callbacks)
 * 2. The provider memoizes it with useMemo
 * 3. The store states themselves are stable references
 *
 * If you need to use this in a render context, wrap it with useMemo
 */
export function getWorkflowStores(): WorkflowStores {
  return {
    varStore: useVarStore.getState(),
    workflowStore: useWorkflowStore.getState(),
    canvasStore: useCanvasStore.getState(),
    selectionStore: useSelectionStore.getState(),
    panelStore: usePanelStore.getState(),
  }
}

/**
 * Get a singleton instance of workflow stores
 * Use this when you need a stable reference across renders
 */
export function getWorkflowStoresSingleton(): WorkflowStores {
  if (!workflowStoresInstance) {
    workflowStoresInstance = getWorkflowStores()
  }
  return workflowStoresInstance
}

/**
 * Initialize workflow stores with data
 */
export function initializeStores(workflowId?: string) {
  // Clear all stores
  const stores = getWorkflowStores()
  console.log('Initializing WORKFLOW STORES...')
  // stores.nodeStore.clearNodes()
  // stores.edgeStore.clearEdges()
  // Variables are cleared by var store initialization
  // stores.selectionStore.deselectAll()

  // Variables are initialized by the var store

  // Load workflow if ID provided and not 'new'
  // if (workflowId && workflowId !== 'new') {
  //   stores.workflowStore.loadWorkflow(workflowId)
  // }
}

/**
 * Reset all stores to initial state
 */
export function resetStores() {
  const stores = getWorkflowStores()
  console.log('RESETTING WORKFLOW STORES...')

  // Check if we're in the middle of dragging or resizing
  const workflowStore = stores.workflowStore
  if (workflowStore.isDragging || workflowStore.isResizing) {
    console.warn('Skipping resetStores during drag/resize operation')
    return
  }

  stores.nodeStore.clearNodes()
  // stores.edgeStore.clearEdges()
  // Variables are cleared by var store initialization
  stores.selectionStore.deselectAll()
  stores.canvasStore.resetView()
  stores.panelStore.closePanel()
  stores.panelStore.closeModal()
}
