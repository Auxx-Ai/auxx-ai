// packages/sdk/src/client/workflow/components/workflow-node-row.tsx

import type React from 'react'

/**
 * Props for WorkflowNodeRow component
 */
export interface WorkflowNodeRowProps {
  /** Row label */
  label: string

  /** Visual variant */
  variant?: 'default' | 'success' | 'error' | 'warning'

  /** Optional handle component */
  children?: React.ReactNode

  /** Additional className */
  className?: string

  /** Additional props */
  [key: string]: any
}

/**
 * A row within a workflow node with label and optional handle.
 */
export const WorkflowNodeRow: React.FC<WorkflowNodeRowProps> = (props) => {
  const React = (window as any).React
  if (!React) {
    throw new Error('[auxx/client] React not available in window')
  }
  return React.createElement('auxxworkflownoderow', {
    ...props,
    component: 'WorkflowNodeRow',
  })
}
