// packages/sdk/src/client/workflow/components/layout/separator.tsx

import type React from 'react'

/**
 * Props for Separator component
 */
export interface SeparatorProps {
  /** Additional className */
  className?: string

  /** Additional props */
  [key: string]: any
}

/**
 * Separator component for visual separation.
 */
export const Separator: React.FC<SeparatorProps> = (props) => {
  const React = (window as any).React
  if (!React) {
    throw new Error('[auxx/client] React not available in window')
  }
  return React.createElement('auxxworkflowseparator', {
    ...props,
    component: 'WorkflowSeparator',
  })
}
