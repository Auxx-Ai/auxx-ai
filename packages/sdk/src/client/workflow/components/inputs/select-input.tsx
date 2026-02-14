// packages/sdk/src/client/workflow/components/inputs/select-input.tsx

import type React from 'react'
import type { SelectOption } from '../../../forms/types.js'
// import type { SelectOption } from '../../../root/schema/select-node.js'

/**
 * Props for SelectInput component
 */
export interface SelectInputProps {
  /** Field name from schema */
  name: string

  /** Current value */
  value?: string

  /** Change handler */
  onChange?: (value: string) => void

  /** Select options - supports both string[] and { label, value }[] */
  options?: readonly SelectOption[] | SelectOption[]

  /** Optional overrides */
  label?: string
  description?: string
  placeholder?: string
  disabled?: boolean

  /** Field orientation - defaults to vertical */
  orientation?: 'vertical' | 'horizontal' | 'responsive'
}

/**
 * Select input component for workflow forms.
 * Use this in your workflow configuration panels.
 */
export const SelectInput: React.FC<SelectInputProps> = (props) => {
  const React = (window as any).React
  if (!React) {
    throw new Error('[auxx/client] React not available in window')
  }
  return React.createElement('auxxworkflowselectinput', {
    name: props.name,
    value: props.value,
    onChange: props.onChange,
    options: props.options,
    label: props.label,
    description: props.description,
    placeholder: props.placeholder,
    disabled: props.disabled,
    orientation: props.orientation,
    component: 'SelectInputInternal',
  })
}
