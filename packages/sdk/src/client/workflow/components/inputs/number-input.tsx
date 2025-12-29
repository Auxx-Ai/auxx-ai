// packages/sdk/src/client/workflow/components/inputs/number-input.tsx

import type React from 'react'

/**
 * Props for NumberInput component
 */
export interface NumberInputProps {
  /** Field name from schema */
  name: string

  /** Current value */
  value?: number

  /** Change handler */
  onChange?: (value: number) => void

  /** Optional overrides */
  label?: string
  description?: string
  placeholder?: string
  disabled?: boolean

  /** Show slider for min/max fields */
  showSlider?: boolean

  /** Minimum value */
  min?: number

  /** Maximum value */
  max?: number

  /** Step value */
  step?: number

  /** Field orientation - defaults to vertical */
  orientation?: 'vertical' | 'horizontal' | 'responsive'
}

/**
 * Number input component for workflow forms.
 * Use this in your workflow configuration panels.
 */
export const NumberInput: React.FC<NumberInputProps> = (props) => {
  const React = (window as any).React
  if (!React) {
    throw new Error('[auxx/client] React not available in window')
  }
  return React.createElement('auxxworkflownumberinput', {
    name: props.name,
    value: props.value,
    onChange: props.onChange,
    label: props.label,
    description: props.description,
    placeholder: props.placeholder,
    disabled: props.disabled,
    showSlider: props.showSlider,
    min: props.min,
    max: props.max,
    step: props.step,
    orientation: props.orientation,
    component: 'NumberInputInternal',
  })
}
