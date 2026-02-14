// apps/web/src/lib/extensions/components/workflow/inputs/string-input.tsx

import { Field, FieldContent, FieldDescription, FieldLabel } from '@auxx/ui/components/field'
import { Input } from '@auxx/ui/components/input'
import { Textarea } from '@auxx/ui/components/textarea'
import type React from 'react'
import { useEffect, useState } from 'react'
import { useDebouncedCallback } from './use-debounced-callback'

/**
 * StringInput component.
 * String input component for workflow forms.
 * Uses local state for immediate UI updates and debounces platform updates.
 */
export const StringInput = ({
  name,
  value = '',
  onChange,
  label,
  description,
  placeholder,
  disabled = false,
  multiline = false,
  rows = 3,
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

  // Debounced platform update (300ms)
  const debouncedUpdate = useDebouncedCallback(async (newValue: string) => {
    if (__onCallHandler && __instanceId && __hasOnChange) {
      await __onCallHandler(__instanceId, 'onChange', newValue)
    } else if (onChange) {
      onChange(newValue)
    }
  }, 300)

  // Handle user input - update local state immediately, debounce platform update
  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const newValue = e.target.value

    // Update local state immediately for smooth UX
    setLocalValue(newValue)

    // Debounce the platform update
    debouncedUpdate(newValue)
  }

  return (
    <Field data-invalid={false} orientation={orientation}>
      <FieldContent>{label && <FieldLabel htmlFor={name}>{label}</FieldLabel>}</FieldContent>
      {multiline ? (
        <Textarea
          id={name}
          name={name}
          value={localValue}
          onChange={handleChange}
          placeholder={placeholder}
          disabled={disabled}
          rows={rows}
        />
      ) : (
        <Input
          id={name}
          name={name}
          type='text'
          value={localValue}
          onChange={handleChange}
          placeholder={placeholder}
          disabled={disabled}
        />
      )}
      {description && <FieldDescription>{description}</FieldDescription>}
    </Field>
  )
}
