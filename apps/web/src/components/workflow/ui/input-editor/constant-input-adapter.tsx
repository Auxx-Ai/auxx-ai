// apps/web/src/components/workflow/ui/input-editor/constant-input-adapter.tsx

import { cn } from '@auxx/ui/lib/utils'
import type React from 'react'
import { useState } from 'react'
import { BaseType } from '~/components/workflow/types'
import {
  type FieldOptions,
  getInputComponent,
  getSpecificPropsForType,
} from './get-input-component'

/**
 * Props for the ConstantInput component
 */
export interface ConstantInputProps {
  value: any // Supports string, number, object (for ADDRESS, CURRENCY, etc.)
  onChange: (content: string, value: any) => void
  varType?: BaseType
  placeholder?: string
  disabled?: boolean
  className?: string
  fieldOptions?: FieldOptions // Full field.options object for type-specific config (enum via fieldOptions.enum, fieldReference via fieldOptions.fieldReference)
}

/**
 * Adapter component that bridges ConstantInput interface to node-inputs components.
 * This eliminates ~300 lines of duplicated switch-case logic by reusing existing
 * node-input components (StringInput, BooleanInput, etc.)
 */
export const ConstantInputAdapter: React.FC<ConstantInputProps> = ({
  value,
  onChange,
  varType = BaseType.STRING,
  placeholder = 'Enter value',
  disabled = false,
  className,
  fieldOptions,
}) => {
  // Track validation errors from input components
  const [errors, setErrors] = useState<Record<string, string>>({})

  // Get input component for type (includes RelationInput for RELATION type)
  const InputComponent = getInputComponent(varType)

  /**
   * Adapter for onChange handler
   * Transforms node-input's onChange(name, value) to ConstantInput's onChange(content, value)
   */
  const handleChange = (name: string, val: any) => {
    // Serialize for content: JSON for objects, string for primitives
    let stringValue: string
    if (val === null || val === undefined) {
      stringValue = ''
    } else if (typeof val === 'object') {
      stringValue = JSON.stringify(val)
    } else {
      stringValue = String(val)
    }
    onChange(stringValue, val)
  }

  /**
   * Handler for validation errors from input components
   */
  const handleError = (name: string, error: string | null) => {
    setErrors((prev) => {
      if (error === null) {
        // Clear error immutably
        const next = { ...prev }
        delete next[name]
        return next
      }
      // Set error immutably
      return { ...prev, [name]: error }
    })
  }

  // Get component-specific props based on varType
  const specificProps = getSpecificPropsForType(varType, {
    placeholder,
    fieldOptions,
  })

  // Common props for all input components
  const commonProps = {
    inputs: { _value: value },
    errors: errors,
    onChange: handleChange,
    onError: handleError,
    isLoading: disabled,
    name: '_value',
    placeholder: placeholder,
  }

  return (
    <div className={cn('flex-1', className)}>
      <InputComponent {...commonProps} {...specificProps} />
    </div>
  )
}
