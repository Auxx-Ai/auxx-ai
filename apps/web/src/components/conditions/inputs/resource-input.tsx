// apps/web/src/components/conditions/inputs/resource-input.tsx

'use client'

import { FieldInputMode, resolveFieldInputConfig } from '@auxx/lib/conditions/client'
import { useMemo } from 'react'
import {
  type AutoGrowOptions,
  FieldInputAdapter,
} from '~/components/fields/inputs/field-input-adapter'
import type { PickerTriggerOptions } from '~/components/ui/picker-trigger'
import type { Condition, FieldDefinition } from '../types'

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
  /** Trigger customization options for picker-based inputs */
  triggerProps?: PickerTriggerOptions
  /** Controlled open state for picker-based inputs */
  open?: boolean
  /** Callback when open state changes */
  onOpenChange?: (open: boolean) => void
  /** Enable auto-grow for text inputs */
  autoGrow?: AutoGrowOptions
  /** Callback to check if a dismiss event should be prevented. Return true to prevent closing. */
  shouldPreventDismiss?: (target: HTMLElement) => boolean
  /** Filter-builder context: allow selecting the viewer as the condition value */
  allowCurrentUser?: boolean
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
  triggerProps,
  open,
  onOpenChange,
  autoGrow,
  shouldPreventDismiss,
  allowCurrentUser = false,
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
      allowMultiple={inputConfig.allowMultiple}
      triggerProps={triggerProps}
      open={open}
      onOpenChange={onOpenChange}
      autoGrow={autoGrow}
      shouldPreventDismiss={shouldPreventDismiss}
      allowCurrentUser={allowCurrentUser}
    />
  )
}
