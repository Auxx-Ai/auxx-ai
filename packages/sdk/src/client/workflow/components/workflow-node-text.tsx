// packages/sdk/src/client/workflow/components/workflow-node-text.tsx

import type React from 'react'

/**
 * Props for WorkflowNodeText component
 */
export interface WorkflowNodeTextProps {
  /** Text content */
  children: React.ReactNode

  /** Additional className */
  className?: string

  /** Additional props */
  [key: string]: any
}

/**
 * Text content within a workflow node.
 */
export const WorkflowNodeText: React.FC<WorkflowNodeTextProps> = (props) => {
  const React = (window as any).React
  if (!React) {
    throw new Error('[auxx/client] React not available in window')
  }
  return React.createElement('auxxworkflownodetext', {
    ...props,
    component: 'WorkflowNodeText',
  })
}
