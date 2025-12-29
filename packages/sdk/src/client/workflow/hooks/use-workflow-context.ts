// packages/sdk/src/client/workflow/hooks/use-workflow-context.ts

'use client'

import { createContext, useContext } from 'react'

/**
 * Workflow context data provided to components
 */
export interface WorkflowContextData<TData = any> {
  /** Current node ID */
  nodeId: string

  /** Current node data/configuration */
  data: TData

  /** Update node data (merges with existing data) */
  updateData: (updates: Partial<TData>) => void

  /** Whether the workflow is in read-only mode */
  isReadOnly: boolean
}

/**
 * React context for workflow data
 */
export const WorkflowContext = createContext<WorkflowContextData | null>(null)

/**
 * Access workflow context including node ID and data management.
 *
 * This hook provides access to the current node's context within a workflow.
 * It must be used within a WorkflowContext.Provider.
 *
 * @example
 * ```typescript
 * export function CustomPanel() {
 *   const { nodeId, data, updateData } = useWorkflowContext<CustomNodeData>()
 *
 *   return (
 *     <div>
 *       <input
 *         value={data.name || ''}
 *         onChange={(e) => updateData({ name: e.target.value })}
 *       />
 *     </div>
 *   )
 * }
 * ```
 */
export function useWorkflowContext<TData = any>(): WorkflowContextData<TData> {
  const context = useContext(WorkflowContext)

  if (!context) {
    throw new Error(
      'useWorkflowContext must be used within a WorkflowContext.Provider'
    )
  }

  return context as WorkflowContextData<TData>
}
