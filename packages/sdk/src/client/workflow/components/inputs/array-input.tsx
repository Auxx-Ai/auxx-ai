// packages/sdk/src/client/workflow/components/inputs/array-input.tsx

import type React from 'react'

/**
 * Props for ArrayInput component
 */
export interface ArrayInputProps {
  /** Field name from schema (must point to a Workflow.array field) */
  name: string

  /** Override label (defaults to schema label) */
  label?: string

  /** Minimum number of items */
  minItems?: number

  /** Maximum number of items */
  maxItems?: number

  /** Label for the add button (default: "Add Item") */
  addLabel?: string

  /** Position of the add button (default: "bottom") */
  addPosition?: 'top' | 'bottom'

  /** Enable drag-and-drop reordering (default: false) */
  canReorder?: boolean

  /** Item template — rendered once per array item */
  children: React.ReactNode
}

/**
 * Array input component for workflow forms.
 * Renders a repeatable list of structured fields using JSX children as the item template.
 */
export const ArrayInput: React.FC<ArrayInputProps> = ({
  name,
  label,
  minItems,
  maxItems,
  addLabel,
  addPosition,
  canReorder,
  children,
}) => {
  const React = (window as any).React
  if (!React) {
    throw new Error('[auxx/client] React not available in window')
  }
  return React.createElement(
    'auxxworkflowarrayinput',
    {
      component: 'ArrayInputInternal',
      name,
      label,
      minItems,
      maxItems,
      addLabel,
      addPosition,
      canReorder,
    },
    children
  )
}
