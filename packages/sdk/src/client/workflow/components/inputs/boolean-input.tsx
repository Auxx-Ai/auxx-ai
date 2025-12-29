// packages/sdk/src/client/workflow/components/inputs/boolean-input.tsx

import type React from 'react'

/**
 * Props for BooleanInput component
 */
export interface BooleanInputProps {
  /** Field name from schema */
  name: string

  /** Current value */
  value?: boolean

  /** Change handler */
  onChange?: (value: boolean) => void

  /** Optional overrides */
  label?: string
  description?: string
  disabled?: boolean

  /** Input variant */
  variant?: 'switch' | 'checkbox'

  /** Field orientation - defaults to vertical */
  orientation?: 'vertical' | 'horizontal' | 'responsive'
}

/**
 * Boolean input component for workflow forms.
 * Use this in your workflow configuration panels.
 */
export const BooleanInput: React.FC<BooleanInputProps> = (props) => {
  const React = (window as any).React
  if (!React) {
    throw new Error('[auxx/client] React not available in window')
  }
  return React.createElement('auxxworkflowbooleaninput', {
    name: props.name,
    value: props.value,
    onChange: props.onChange,
    label: props.label,
    description: props.description,
    disabled: props.disabled,
    variant: props.variant,
    orientation: props.orientation,
    component: 'BooleanInputInternal',
  })
}
