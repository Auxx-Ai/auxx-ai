// apps/web/src/lib/extensions/components/workflow/inputs/select-input.tsx

import { Field, FieldContent, FieldDescription, FieldLabel } from '@auxx/ui/components/field'
import { Label } from '@auxx/ui/components/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@auxx/ui/components/select'
import React, { useEffect, useState } from 'react'

/**
 * SelectInput component.
 * Select input component for workflow forms.
 * Uses local state for immediate UI updates.
 */
export const SelectInput = ({
  name,
  value = '',
  onChange,
  options = [],
  label,
  description,
  placeholder,
  disabled = false,
  orientation = 'vertical',
  __instanceId,
  __onCallHandler,
  __hasOnChange,
}: any) => {
  // Local state for immediate UI updates
  const [localValue, setLocalValue] = useState(value)

  // Sync local value when prop changes (from platform updates)
  useEffect(() => {
    setLocalValue(value)
  }, [value])

  /**
   * Handle value change from Select.
   * Accepts the new value string directly.
   */
  const handleValueChange = async (newValue: string) => {
    // Update local state immediately
    setLocalValue(newValue)

    // Send to platform
    if (__onCallHandler && __instanceId && __hasOnChange) {
      await __onCallHandler(__instanceId, 'onChange', newValue)
    } else if (onChange) {
      onChange(newValue)
    }
  }

  return (
    <Field data-invalid={false} className='' orientation={orientation}>
      <FieldContent>{label && <FieldLabel htmlFor={name}>{label}</FieldLabel>}</FieldContent>
      <Select value={localValue} onValueChange={handleValueChange} disabled={disabled}>
        <SelectTrigger className='w-auto'>
          <SelectValue placeholder={placeholder || 'Select...'} />
        </SelectTrigger>
        <SelectContent>
          {options.map((option: string | { label: string; value: string }) => {
            const optionValue = typeof option === 'string' ? option : option.value
            const optionLabel = typeof option === 'string' ? option : option.label
            return (
              <SelectItem key={optionValue} value={optionValue}>
                {optionLabel}
              </SelectItem>
            )
          })}
        </SelectContent>
      </Select>
      {description && <FieldDescription>{description}</FieldDescription>}
    </Field>
  )
}
