// apps/web/src/lib/extensions/components/workflow/inputs/boolean-input.tsx

import { Checkbox } from '@auxx/ui/components/checkbox'
import { Field, FieldContent, FieldDescription, FieldLabel } from '@auxx/ui/components/field'
import { Switch } from '@auxx/ui/components/switch'
import { useEffect, useState } from 'react'

/**
 * BooleanInput component.
 * Boolean input component for workflow forms.
 * Uses local state for immediate UI updates.
 */
export const BooleanInput = ({
  name,
  value = false,
  onChange,
  label,
  description,
  disabled = false,
  variant = 'switch',
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

  const handleChange = async (newValue: boolean) => {
    // Update local state immediately
    setLocalValue(newValue)

    // Send to platform
    if (__onCallHandler && __instanceId && __hasOnChange) {
      await __onCallHandler(__instanceId, 'onChange', newValue)
    } else if (onChange) {
      onChange(newValue)
    }
  }

  if (variant === 'switch') {
    return (
      <Field data-invalid={false} className='' orientation={orientation}>
        <FieldContent>
          {label && <FieldLabel htmlFor={name}>{label}</FieldLabel>}
          {description && <FieldDescription>{description}</FieldDescription>}
        </FieldContent>
        <div>
          <Switch
            id={name}
            checked={localValue}
            onCheckedChange={handleChange}
            disabled={disabled}
          />
        </div>
      </Field>
    )
  }

  // Checkbox variant
  return (
    <Field data-invalid={false} className='' orientation={orientation}>
      <FieldContent>{label && <FieldLabel htmlFor={name}>{label}</FieldLabel>}</FieldContent>
      <div>
        <Checkbox
          id={name}
          checked={localValue}
          onCheckedChange={handleChange}
          disabled={disabled}
        />
      </div>
      {description && <FieldDescription>{description}</FieldDescription>}
    </Field>
  )
}
