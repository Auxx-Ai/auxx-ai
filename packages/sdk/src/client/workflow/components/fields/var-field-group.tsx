// packages/sdk/src/client/workflow/components/fields/var-field-group.tsx

import type React from 'react'

/**
 * Props for VarFieldGroup component.
 */
export interface VarFieldGroupProps {
  /** Layout orientation for label vs content within each row */
  orientation?: 'horizontal' | 'vertical'
  /** Validation error message */
  validationError?: string
  /** Validation error type */
  validationType?: 'error' | 'warning'
  /** Child VarField components */
  children?: React.ReactNode
}

/**
 * VarFieldGroup — container providing VarEditorField chrome (rounded border, background).
 */
export const VarFieldGroup: React.FC<VarFieldGroupProps> = ({
  orientation,
  validationError,
  validationType,
  children,
}) => {
  const React = (window as any).React
  if (!React) {
    throw new Error('[auxx/client] React not available in window')
  }
  return React.createElement(
    'auxxworkflowvarfieldgroup',
    {
      component: 'WorkflowVarFieldGroup',
      orientation,
      validationError,
      validationType,
    },
    children
  )
}
