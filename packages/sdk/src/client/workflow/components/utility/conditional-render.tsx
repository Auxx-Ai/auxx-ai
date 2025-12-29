// packages/sdk/src/client/workflow/components/utility/conditional-render.tsx

import type React from 'react'

/**
 * Props for ConditionalRender component
 */
export interface ConditionalRenderProps {
  /** Condition function that determines if children should render */
  when: (data: any) => boolean

  /** Content to render when condition is true */
  children: React.ReactNode

  /** Current data context (injected by useWorkflow) */
  data?: any
}

/**
 * ConditionalRender component for conditionally rendering content based on form data.
 * The `data` prop is automatically injected by useWorkflow.
 * Uses the Tag-based reconciler pattern for cross-iframe communication.
 * The condition is evaluated on the SDK side before serialization.
 */
export const ConditionalRenderInternal: React.FC<ConditionalRenderProps> = (props) => {
  const React = (window as any).React
  if (!React) {
    throw new Error('[auxx/client] React not available in window')
  }
  return React.createElement('auxxworkflowconditionalrender', {
    ...props,
    component: 'ConditionalRenderInternal',
  })
}
