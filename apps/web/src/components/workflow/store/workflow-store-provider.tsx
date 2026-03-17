// apps/web/src/components/workflow/store/workflow-store-provider.tsx

import type { Viewport } from '@xyflow/react'
import type React from 'react'
import { createContext, useContext, useEffect, useMemo } from 'react'
import { useCanvasStore } from './canvas-store'
import { historyManager } from './history-manager'
import { getWorkflowStores, initializeStores, resetStores, type WorkflowStores } from './index'

interface WorkflowStoreContextValue {
  stores: WorkflowStores
  historyManager: typeof historyManager
}

const WorkflowStoreContext = createContext<WorkflowStoreContextValue | null>(null)

interface WorkflowStoreProviderProps {
  children: React.ReactNode
  workflowId?: string
  initialViewport?: Viewport | null
}

// Track which workflows have been initialized to prevent re-initialization
const initializedWorkflows = new Set<string>()

/**
 * Provider component that makes workflow stores available to child components
 */
export const WorkflowStoreProvider: React.FC<WorkflowStoreProviderProps> = ({
  children,
  workflowId,
  initialViewport,
}) => {
  // Get all stores
  const stores = useMemo(() => getWorkflowStores(), [])

  // Initialize stores in useEffect to avoid setState during render
  // Using useMemo for side effects causes "Cannot update a component while rendering" errors
  useEffect(() => {
    const workflowKey = workflowId || 'default'

    // Only initialize if not already initialized for this workflow
    // This prevents re-initialization when component remounts
    if (!initializedWorkflows.has(workflowKey)) {
      console.log('First time initializing stores for workflow:', workflowKey)
      initializeStores(workflowId)
      initializedWorkflows.add(workflowKey)
    }

    // Initialize viewport from loaded workflow data
    if (initialViewport) {
      useCanvasStore.getState().setViewport(initialViewport)
    }
  }, [workflowId, initialViewport])

  // Cleanup on unmount
  useEffect(() => {
    const workflowKey = workflowId || 'default'

    return () => {
      // Remove from initialized set on unmount to allow re-initialization
      // This is important for switching between workflows
      initializedWorkflows.delete(workflowKey)
      console.log('Cleaning up workflow:', workflowKey)

      // Reset stores when switching workflows
      resetStores()
      historyManager.clear()
    }
  }, [workflowId])

  // Note: Keyboard shortcuts have been moved to use-workflow-shortcuts.ts for centralized management

  const value = useMemo(() => ({ stores, historyManager }), [stores])

  return <WorkflowStoreContext.Provider value={value}>{children}</WorkflowStoreContext.Provider>
}

/**
 * Hook to access workflow stores
 */
export function useWorkflowStores() {
  const context = useContext(WorkflowStoreContext)

  if (!context) {
    throw new Error('useWorkflowStores must be used within a WorkflowStoreProvider')
  }

  return context.stores
}

/**
 * No-op history manager for read-only contexts (viewer mode)
 */
const noopHistoryManager = {
  record: () => {},
  undo: () => {},
  redo: () => {},
  clear: () => {},
  canUndo: () => false,
  canRedo: () => false,
  getHistory: () => [],
  getCurrent: () => null,
}

/**
 * Hook to access history manager
 * Returns no-op implementation when used outside WorkflowStoreProvider (e.g., in viewer)
 */
export function useHistoryManager() {
  const context = useContext(WorkflowStoreContext)

  // Return no-op history manager for read-only contexts (viewer mode)
  // This allows node components to render without throwing errors
  if (!context) {
    return noopHistoryManager as typeof historyManager
  }

  return context.historyManager
}
