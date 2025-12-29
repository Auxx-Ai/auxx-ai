// apps/web/src/lib/extensions/components/workflow/inputs/number-input.tsx

import React, { useState, useEffect } from 'react'
import { Field, FieldContent, FieldDescription, FieldLabel } from '@auxx/ui/components/field'
import { useDebouncedCallback } from './use-debounced-callback'
import { Input } from '@auxx/ui/components/input'

/**
 * NumberInput component.
 * Number input component for workflow forms.
 * Uses local state for immediate UI updates and debounces platform updates.
 */
export const NumberInput = ({
  name,
  value,
  onChange,
  label,
  description,
  placeholder,
  disabled = false,
  className = '',
  showSlider = false,
  min,
  max,
  step = 1,
  orientation = 'vertical',
  __instanceId,
  __onCallHandler,
  __hasOnChange,
}: any) => {
  // Local state for immediate UI updates
  const [localValue, setLocalValue] = useState(value ?? '')

  // Sync local value when prop changes (from platform updates)
  useEffect(() => {
    setLocalValue(value ?? '')
  }, [value])

  // Debounced platform update (300ms)
  const debouncedUpdate = useDebouncedCallback(async (newValue: number) => {
    if (__onCallHandler && __instanceId && __hasOnChange) {
      await __onCallHandler(__instanceId, 'onChange', newValue)
    } else if (onChange) {
      onChange(newValue)
    }
  }, 300)

  // Handle user input - update local state immediately, debounce platform update
  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const stringValue = e.target.value
    setLocalValue(stringValue) // Update local state immediately with string

    // Parse and send to platform if valid
    if (stringValue !== '') {
      const numValue = parseFloat(stringValue)
      if (!isNaN(numValue)) {
        debouncedUpdate(numValue)
      }
    }
  }

  return (
    <Field data-invalid={false} className={className} orientation={orientation}>
      <FieldContent>{label && <FieldLabel htmlFor={name}>{label}</FieldLabel>}</FieldContent>
      {showSlider && min !== undefined && max !== undefined ? (
        <div className="flex items-center gap-3">
          <input
            id={name}
            name={name}
            type="range"
            value={localValue || min}
            onChange={handleChange}
            min={min}
            max={max}
            step={step}
            disabled={disabled}
            className="flex-1 h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
          />
          <span className="text-sm font-medium w-12 text-right">{localValue || min}</span>
        </div>
      ) : (
        <Input
          id={name}
          name={name}
          type="number"
          value={localValue}
          onChange={handleChange}
          placeholder={placeholder}
          disabled={disabled}
          min={min}
          max={max}
          step={step}
        />
      )}
      {description && <FieldDescription>{description}</FieldDescription>}
    </Field>
  )
}
