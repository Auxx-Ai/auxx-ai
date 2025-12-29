// packages/sdk/src/client/workflow/components/inputs/string-input.tsx

import type React from 'react'

/**
 * Props for StringInput component
 */
export interface StringInputProps {
  /** Field name from schema */
  name: string

  /** Current value */
  value?: string

  /** Change handler */
  onChange?: (value: string) => void

  /** Optional overrides */
  label?: string
  description?: string
  placeholder?: string
  disabled?: boolean

  /** Use textarea instead of input */
  multiline?: boolean

  /** Number of rows for multiline */
  rows?: number

  /** Field orientation - defaults to vertical */
  orientation?: 'vertical' | 'horizontal' | 'responsive'
}

/**
 * String input component for workflow forms.
 * Use this in your workflow configuration panels.
 */
export const StringInput: React.FC<StringInputProps> = (props) => {
  const React = (window as any).React
  if (!React) {
    throw new Error('[auxx/client] React not available in window')
  }
  return React.createElement('auxxworkflowstringinput', {
    name: props.name,
    value: props.value,
    onChange: props.onChange,
    label: props.label,
    description: props.description,
    placeholder: props.placeholder,
    disabled: props.disabled,
    multiline: props.multiline,
    rows: props.rows,
    orientation: props.orientation,
    component: 'StringInputInternal',
  })
}
