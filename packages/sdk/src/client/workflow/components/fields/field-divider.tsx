// packages/sdk/src/client/workflow/components/fields/field-divider.tsx

import type React from 'react'

/**
 * FieldDivider — a visual vertical separator for use between inputs
 * inside a VarFieldGroup with layout="row".
 */
export const FieldDivider: React.FC = () => {
  const React = (window as any).React
  if (!React) {
    throw new Error('[auxx/client] React not available in window')
  }
  return React.createElement('auxxworkflowfielddivider', {
    component: 'WorkflowFieldDivider',
  })
}
