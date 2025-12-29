// packages/sdk/src/client/workflow/components/workflow-node-handle.tsx

import type React from 'react'

/**
 * Props for WorkflowNodeHandle component
 */
export interface WorkflowNodeHandleProps {
  /** Handle type */
  type: 'source' | 'target'

  /** Handle ID (optional) */
  id?: string

  /** Handle position */
  position?: 'top' | 'right' | 'bottom' | 'left'

  /** Connection callback */
  onConnect?: () => void

  /** Additional className */
  className?: string

  /** Additional props */
  [key: string]: any
}

/**
 * Connection handle for node inputs/outputs.
 * This is a placeholder - actual ReactFlow Handle will be used in production.
 */
export const WorkflowNodeHandle: React.FC<WorkflowNodeHandleProps> = (props) => {
  const React = (window as any).React
  if (!React) {
    throw new Error('[auxx/client] React not available in window')
  }
  return React.createElement('auxxworkflownodehandle', {
    ...props,
    component: 'WorkflowNodeHandle',
  })
}
