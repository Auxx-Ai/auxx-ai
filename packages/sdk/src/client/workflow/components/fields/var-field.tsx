// packages/sdk/src/client/workflow/components/fields/var-field.tsx

import type React from 'react'

/**
 * Props for VarField component.
 * All metadata props are optional — resolved from child's name + schema lookup on the host.
 */
export interface VarFieldProps {
  /** Override which field to look up (defaults to child's name prop) */
  name?: string
  /** Override label (defaults to schema._metadata.label ?? name) */
  title?: string
  /** Override description (defaults to schema._metadata.description) */
  description?: string
  /** Override required (defaults to schema._metadata.required) */
  required?: boolean
  /** Override BaseType for icon (defaults to schema field type) */
  type?: string
  /** Show/hide type icon (defaults to true) */
  showIcon?: boolean
  /** Child input component(s) */
  children?: React.ReactNode
}

/**
 * VarField — wrapper providing VarEditorFieldRow chrome (title, description, type icon, clear button).
 */
export const VarField: React.FC<VarFieldProps> = ({
  name,
  title,
  description,
  required,
  type,
  showIcon,
  children,
}) => {
  const React = (window as any).React
  if (!React) {
    throw new Error('[auxx/client] React not available in window')
  }
  return React.createElement(
    'auxxworkflowvarfield',
    {
      component: 'WorkflowVarField',
      name,
      title,
      description,
      required,
      type,
      showIcon,
    },
    children
  )
}
