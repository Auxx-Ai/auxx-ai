// packages/sdk/src/client/workflow/components/workflow-panel.tsx

import type React from 'react'

/**
 * Props for WorkflowPanel component
 */
export interface WorkflowPanelProps {
  /** Panel content */
  children?: React.ReactNode

  /** Additional className */
  className?: string

  /** Additional props */
  [key: string]: any
}

/**
 * Container for configuration panel.
 * Used to wrap panel content in workflow configuration views.
 */
export const WorkflowPanel: React.FC<WorkflowPanelProps> = (props) => {
  const React = (window as any).React
  if (!React) {
    throw new Error('[auxx/client] React not available in window')
  }
  return React.createElement('auxxworkflowpanel', {
    ...props,
    component: 'WorkflowPanel',
  })
}
