// packages/sdk/src/client/workflow/components/utility/badge.tsx

import type React from 'react'

/**
 * Props for Badge component
 */
export interface BadgeProps {
  /** Badge variant */
  variant?: 'default' | 'secondary' | 'destructive' | 'outline'

  /** Badge content */
  children: React.ReactNode

  /** Additional className */
  className?: string

  /** Additional props */
  [key: string]: any
}

/**
 * Badge component for displaying small labels or status.
 * Uses the Tag-based reconciler pattern for cross-iframe communication.
 */
export const Badge: React.FC<BadgeProps> = (props) => {
  const React = (window as any).React
  if (!React) {
    throw new Error('[auxx/client] React not available in window')
  }
  return React.createElement('auxxworkflowbadge', {
    ...props,
    component: 'WorkflowBadge',
  })
}
