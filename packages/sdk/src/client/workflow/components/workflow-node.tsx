// packages/sdk/src/client/workflow/components/workflow-node.tsx

import type React from 'react'

/**
 * Props for WorkflowNode component
 */
export interface WorkflowNodeProps {
  /** Node content */
  children?: React.ReactNode

  /** Additional className */
  className?: string

  /** Additional props */
  [key: string]: any
}

/**
 * Container for node visualization on canvas.
 * Used to wrap node content in workflow visualizations.
 */
export const WorkflowNode: React.FC<WorkflowNodeProps> = (props) => {
  const React = (window as any).React
  if (!React) {
    throw new Error('[auxx/client] React not available in window')
  }
  return React.createElement('auxxworkflownode', {
    ...props,
    component: 'WorkflowNode',
  })
}
