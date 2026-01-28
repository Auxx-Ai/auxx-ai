// apps/web/src/components/conditions/inputs/resource-input.tsx

'use client'

import { useMemo } from 'react'
import { FieldInputAdapter } from '~/components/fields/inputs/field-input-adapter'
import { resolveFieldInputConfig, FieldInputMode } from '@auxx/lib/conditions/client'
import type { FieldDefinition, Condition } from '../types'

/**
 * Props for ResourceInput component
 */
interface ResourceInputProps {
  /** The condition being edited */
  condition: Condition
  /** Field definition with type and options */
  field: FieldDefinition
  /** Current value */
  value: unknown
  /** Callback when value changes */
  onChange: (value: unknown) => void
  /** Whether input is disabled */
  disabled?: boolean
  /** Placeholder text */
  placeholder?: string
  /** Additional className */
  className?: string
}

/**
 * Input component for resource-based conditions.
 * Uses FieldInputAdapter directly - no VarEditor, no manual fieldOptions building.
 */
export function ResourceInput({
  condition,
  field,
  value,
  onChange,
  disabled = false,
  placeholder,
  className,
}: ResourceInputProps) {
  // Resolve input configuration based on field type and operator
  const inputConfig = useMemo(() => {
    return resolveFieldInputConfig(field.fieldType ?? 'TEXT', condition.operator)
  }, [field.fieldType, condition.operator])

  // Skip rendering if no input needed (empty, exists operators)
  if (inputConfig.mode === FieldInputMode.NONE) {
    return null
  }

  return (
    <FieldInputAdapter
      fieldType={inputConfig.fieldType ?? field.fieldType ?? 'TEXT'}
      fieldOptions={field.options}
      value={value}
      onChange={onChange}
      disabled={disabled}
      placeholder={placeholder ?? inputConfig.placeholder ?? field.placeholder}
      className={className}
      allowMultiple={inputConfig.allowMultiple}
    />
  )
}
