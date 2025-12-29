// apps/web/src/components/data-import/value-review/editing-input.tsx

'use client'

import { useState, useMemo } from 'react'
import { Button } from '@auxx/ui/components/button'
import { Input } from '@auxx/ui/components/input'
import { ComboPicker, type Option } from '~/components/pickers/combo-picker'
import type { ColumnFieldConfig, OverrideValue } from '../types'

export interface EditingInputProps {
  fieldConfig: ColumnFieldConfig | null
  rawValue: string
  resolvedValue: string | null
  isOverridden: boolean
  overrideValues: OverrideValue[] | null
  hasCustomOverride: boolean
  onSave: (overrideValues: OverrideValue[] | null) => void
}

/**
 * Component for editing value overrides.
 * Renders different input types based on field configuration.
 * Saves on blur for text inputs, on selection for enum pickers.
 */
export function EditingInput({
  fieldConfig,
  rawValue,
  resolvedValue,
  isOverridden,
  overrideValues,
  hasCustomOverride,
  onSave,
}: EditingInputProps) {
  // Check if currently skipped
  const isSkipped = isOverridden && overrideValues?.[0]?.type === 'skip'

  // Initialize value from existing override or resolved value or raw value
  // If skipped, use resolved/raw value (not the skip value)
  const initialValue = useMemo(() => {
    if (isSkipped) {
      return resolvedValue ?? rawValue
    }
    if (isOverridden && overrideValues?.[0]) {
      return overrideValues[0].value
    }
    return resolvedValue ?? rawValue
  }, [isOverridden, isSkipped, overrideValues, resolvedValue, rawValue])

  const [editValue, setEditValue] = useState(initialValue)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [selectedOptions, setSelectedOptions] = useState<Option[]>(() => {
    // Initialize selected options for enum fields
    if (fieldConfig?.type === 'enum' && fieldConfig.enumValues) {
      // If skipped, use resolved value (not skip value)
      if (isSkipped) {
        const matchedEnum = fieldConfig.enumValues.find((e) => e.dbValue === resolvedValue)
        if (matchedEnum) {
          return [{ value: matchedEnum.dbValue, label: matchedEnum.label }]
        }
        return []
      }
      // If overridden with values, use those
      if (isOverridden && overrideValues) {
        return overrideValues
          .filter((ov) => ov.type !== 'skip')
          .map((ov) => {
            const enumVal = fieldConfig.enumValues?.find((e) => e.dbValue === ov.value)
            return enumVal ? { value: enumVal.dbValue, label: enumVal.label } : null
          })
          .filter((x): x is Option => x !== null)
      }
      // Try to match resolved value to enum
      const matchedEnum = fieldConfig.enumValues.find((e) => e.dbValue === resolvedValue)
      if (matchedEnum) {
        return [{ value: matchedEnum.dbValue, label: matchedEnum.label }]
      }
    }
    return []
  })

  // Determine editor type based on field config
  const resolutionType = fieldConfig?.resolutionType ?? 'text:value'
  const isEnumType =
    resolutionType.startsWith('select:') || resolutionType.startsWith('multiselect:')
  const isMultiSelect = resolutionType.startsWith('multiselect:')

  // Build options for enum picker
  const enumOptions: Option[] = useMemo(() => {
    if (!fieldConfig?.enumValues) return []
    return fieldConfig.enumValues.map((e) => ({
      value: e.dbValue,
      label: e.label,
    }))
  }, [fieldConfig?.enumValues])

  /** The original (non-overridden) value */
  const originalValue = resolvedValue ?? rawValue

  /** Handle text input blur - save the value */
  const handleTextBlur = () => {
    // No change from current state
    if (editValue === initialValue) {
      return
    }
    // Changed back to original - trigger revert
    if (editValue === originalValue) {
      onSave(null)
      return
    }
    // Save as override
    onSave([{ type: 'value', value: editValue }])
  }

  /** Handle enum selection - save immediately on single select */
  const handleEnumChange = (val: Option | Option[] | null) => {
    if (isMultiSelect) {
      setSelectedOptions(val as Option[])
    } else {
      const newOptions = val ? [val as Option] : []
      setSelectedOptions(newOptions)
      // Save immediately for single select
      if (newOptions.length > 0) {
        const values: OverrideValue[] = newOptions.map((opt) => ({
          type: 'value' as const,
          value: opt.value,
        }))
        onSave(values)
      }
      setPickerOpen(false)
    }
  }

  /** Handle enum picker close for multiselect - save on close */
  const handleEnumClose = () => {
    setPickerOpen(false)
    if (isMultiSelect && selectedOptions.length > 0) {
      const values: OverrideValue[] = selectedOptions.map((opt) => ({
        type: 'value' as const,
        value: opt.value,
      }))
      onSave(values)
    }
  }

  // Render enum picker
  if (isEnumType && enumOptions.length > 0) {
    return (
      <ComboPicker
        options={enumOptions}
        selected={isMultiSelect ? selectedOptions : (selectedOptions[0] ?? null)}
        multi={isMultiSelect}
        open={pickerOpen}
        onOpen={() => setPickerOpen(true)}
        onClose={handleEnumClose}
        onChange={handleEnumChange}>
        <Button variant="outline" size="sm" className="h-7 min-w-[120px] justify-start">
          {selectedOptions.length > 0
            ? selectedOptions.map((o) => o.label).join(', ')
            : 'Select value...'}
        </Button>
      </ComboPicker>
    )
  }

  // Default text input for all other types
  return (
    <Input
      value={editValue}
      onChange={(e) => setEditValue(e.target.value)}
      className="h-7"
      variant="transparent"
      size="sm"
      onBlur={handleTextBlur}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.currentTarget.blur() // Trigger blur to save
        }
      }}
    />
  )
}
