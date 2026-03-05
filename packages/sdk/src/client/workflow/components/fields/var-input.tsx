// packages/sdk/src/client/workflow/components/fields/var-input.tsx

import type React from 'react'

/**
 * Props for VarInput component.
 * The base component for all VarEditor-backed inputs.
 */
export interface VarInputProps {
  /** Field name from schema */
  name: string
  /** Field type: 'string' | 'number' | 'boolean' | 'select' */
  type: string
  /** Placeholder text */
  placeholder?: string
  /** Whether this field accepts variable references */
  acceptsVariables?: boolean
  /** Allowed variable types for filtering */
  variableTypes?: string[]
  /** Format hint (email, url, date, datetime, time) */
  format?: string
  /** Options for select fields */
  options?: readonly (string | { label: string; value: string })[]
  /** Use multiline mode for string type */
  multiline?: boolean
  /**
   * When inside a VarFieldGroup with layout="row", this child expands to fill
   * remaining space (flex-1). Other children shrink to fit their content.
   * If no child in the row has expand, the last child expands by default.
   */
  expand?: boolean
  /** Select trigger style variant (for select/options fields) */
  variant?: string
  /** Show loading skeleton while options are being fetched */
  loading?: boolean
}

/**
 * VarInput — the base component for all VarEditor-backed inputs in extension workflows.
 *
 * Creates a custom element that the reconciler serializes to the host,
 * where VarInputInternal renders the appropriate VarEditor.
 */
export const VarInput: React.FC<VarInputProps> = (props) => {
  const React = (window as any).React
  if (!React) {
    throw new Error('[auxx/client] React not available in window')
  }
  return React.createElement('auxxworkflowvarinput', {
    ...props,
    component: 'VarInputInternal',
  })
}
