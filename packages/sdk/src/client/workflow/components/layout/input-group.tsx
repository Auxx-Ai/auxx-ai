// packages/sdk/src/client/workflow/components/layout/input-group.tsx

import type React from 'react'

/**
 * Props for InputGroup component
 */
export interface InputGroupProps {
  /** Input group content */
  children?: React.ReactNode

  /** Gap size between inputs */
  gap?: 'sm' | 'md' | 'lg'

  /** Additional className */
  className?: string

  /** Additional props */
  [key: string]: any
}

/**
 * InputGroup component for laying out inputs horizontally.
 */
export const InputGroup: React.FC<InputGroupProps> = (props) => {
  const React = (window as any).React
  if (!React) {
    throw new Error('[auxx/client] React not available in window')
  }
  return React.createElement('auxxworkflowinputgroup', {
    ...props,
    component: 'WorkflowInputGroup',
  })
}
