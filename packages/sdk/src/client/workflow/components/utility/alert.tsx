// packages/sdk/src/client/workflow/components/utility/alert.tsx

import type React from 'react'

/**
 * Props for Alert component
 */
export interface AlertProps {
  /** Alert variant */
  variant?: 'info' | 'warning' | 'error' | 'success'

  /** Alert title */
  title?: string

  /** Alert content */
  children: React.ReactNode

  /** Additional className */
  className?: string

  /** Additional props */
  [key: string]: any
}

/**
 * Alert component for displaying informational messages.
 * Uses the Tag-based reconciler pattern for cross-iframe communication.
 */
export const Alert: React.FC<AlertProps> = (props) => {
  const React = (window as any).React
  if (!React) {
    throw new Error('[auxx/client] React not available in window')
  }
  return React.createElement('auxxworkflowalert', {
    ...props,
    component: 'WorkflowAlert',
  })
}
