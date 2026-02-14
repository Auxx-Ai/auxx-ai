// apps/web/src/lib/extensions/components/workflow/workflow-node-context.tsx

import type { Node } from '@xyflow/react'
import { createContext, useContext } from 'react'

/** Context value for WorkflowNode providing node data to child components */
interface WorkflowNodeContextValue {
  /** Node ID from React Flow */
  nodeId: string
  /** Node type (e.g., 'start', 'end', 'conditional') */
  nodeType: string
  /** Node data including custom properties and connection state */
  nodeData: Node['data']
  /** Node position on canvas */
  position: { x: number; y: number }
}

/** Context for accessing node data within WorkflowNode children */
const WorkflowNodeContext = createContext<WorkflowNodeContextValue | null>(null)

/** Provider component for WorkflowNodeContext */
export const WorkflowNodeProvider = WorkflowNodeContext.Provider

/**
 * Hook to access WorkflowNode context.
 * Throws error if used outside WorkflowNodeProvider.
 */
export function useWorkflowNodeContext() {
  const context = useContext(WorkflowNodeContext)
  if (!context) {
    throw new Error('useWorkflowNodeContext must be used within WorkflowNodeProvider')
  }
  return context
}

/**
 * Optional hook to access WorkflowNode context.
 * Returns null if used outside WorkflowNodeProvider (for backward compatibility).
 */
export function useWorkflowNodeContextOptional() {
  return useContext(WorkflowNodeContext)
}
