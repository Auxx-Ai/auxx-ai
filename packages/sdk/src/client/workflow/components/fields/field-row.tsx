// packages/sdk/src/client/workflow/components/fields/field-row.tsx

import type React from 'react'

/**
 * FieldRow — a horizontal layout container for use inside VarFieldGroup.
 *
 * Places its children side-by-side in a single border row (same chrome as VarField).
 * Children with expand={true} fill remaining space; others shrink to content.
 * If no child has expand, the last child expands by default.
 */
export interface FieldRowProps {
  children?: React.ReactNode
}

export const FieldRow: React.FC<FieldRowProps> = ({ children }) => {
  const React = (window as any).React
  if (!React) {
    throw new Error('[auxx/client] React not available in window')
  }
  return React.createElement('auxxworkflowfieldrow', { component: 'WorkflowFieldRow' }, children)
}
