// apps/web/src/components/fields/inputs/select-input-field.tsx
'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { usePropertyContext } from '../property-provider'
import { useFieldNavigationOptional } from '../field-navigation-context'
import { api } from '~/trpc/react'
import { MultiSelectPicker } from '~/components/pickers/multi-select-picker'
import { FieldType } from '@auxx/database/enums'
import type { SelectOption } from '@auxx/types/custom-field'

/**
 * Configuration for select-type fields based on field type
 */
interface SelectConfig {
  multi: boolean
  canManage: boolean
  canAdd: boolean
  placeholder: string
  manageLabel: string
  closeOnSelect: boolean
}

/**
 * Get configuration for select-type fields based on field type
 */
function getSelectConfig(fieldType: string): SelectConfig {
  switch (fieldType) {
    case FieldType.SINGLE_SELECT:
      return {
        multi: false,
        canManage: false,
        canAdd: false,
        placeholder: 'Search options...',
        manageLabel: 'Manage options',
        closeOnSelect: true,
      }
    case FieldType.MULTI_SELECT:
      return {
        multi: true,
        canManage: false,
        canAdd: false,
        placeholder: 'Search options...',
        manageLabel: 'Manage options',
        closeOnSelect: false,
      }
    case FieldType.TAGS:
    default:
      return {
        multi: true,
        canManage: true,
        canAdd: true,
        placeholder: 'Search tags...',
        manageLabel: 'Manage tags',
        closeOnSelect: false,
      }
  }
}

/**
 * SelectInputField
 * Unified input field for SINGLE_SELECT, MULTI_SELECT, and TAGS field types.
 * Configures MultiSelectPicker based on field type.
 *
 * - SINGLE_SELECT: Radio buttons, no management, closes after selection
 * - MULTI_SELECT: Checkboxes, no management, stays open
 * - TAGS: Checkboxes, full management (create/edit/delete), stays open
 */
export function SelectInputField() {
  const { value, field, commitValue, close } = usePropertyContext()
  const nav = useFieldNavigationOptional()
  const utils = api.useUtils()
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null)

  // Get configuration based on field type
  const config = getSelectConfig(field?.fieldType || field?.type)

  // Local selected state for debouncing (multi-select only)
  const [localSelected, setLocalSelected] = useState<string[]>(() => {
    const options = field?.options?.options || []
    const optionValues = new Set(options.map((opt: SelectOption) => opt.value))
    if (Array.isArray(value)) {
      return value.filter((v: string) => optionValues.has(v))
    }
    if (typeof value === 'string' && value) {
      return optionValues.has(value) ? [value] : []
    }
    return []
  })

  // Mutation to update field options (only for TAGS)
  const updateField = api.customField.update.useMutation({
    onSuccess: () => {
      utils.customField.getAll.invalidate()
      utils.customField.getByEntityDefinition.invalidate()
      utils.resource.getAllResourceTypes.invalidate()
    },
  })

  /**
   * Debounced save to server - waits for user to stop clicking (multi-select only)
   */
  const debouncedSave = useCallback(
    (newSelected: string[]) => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current)
      }
      saveTimeoutRef.current = setTimeout(() => {
        commitValue(config.multi ? newSelected : newSelected[0] || '')
      }, 300)
    },
    [commitValue, config.multi]
  )

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current)
      }
    }
  }, [])

  /**
   * Handle selection changes
   */
  const handleChange = useCallback(
    (selected: string[]) => {
      setLocalSelected(selected)
      if (config.multi) {
        // Multi-select: debounced save
        debouncedSave(selected)
      }
    },
    [config.multi, debouncedSave]
  )

  /**
   * Handle single-select completion (save and close)
   */
  const handleSelectSingle = useCallback(
    (selectedValue: string) => {
      // Immediate save for single select
      commitValue(selectedValue)
      // Close the popover
      if (config.closeOnSelect) {
        close()
      }
    },
    [commitValue, close, config.closeOnSelect]
  )

  /**
   * Handle options changes (create/edit/delete) - only for TAGS
   */
  const handleOptionsChange = useCallback(
    (newOptions: SelectOption[]) => {
      if (!config.canManage) return
      updateField.mutate({
        id: field.id,
        options: newOptions,
      })
    },
    [config.canManage, updateField, field.id]
  )

  /**
   * Handle capture state changes for field navigation
   */
  const handleCaptureChange = useCallback(
    (capturing: boolean) => {
      nav?.setPopoverCapturing(capturing)
    },
    [nav]
  )

  const options: SelectOption[] = field?.options?.options || []

  return (
    <MultiSelectPicker
      options={options}
      value={localSelected}
      onChange={handleChange}
      onSelectSingle={config.closeOnSelect ? handleSelectSingle : undefined}
      onOptionsChange={config.canManage ? handleOptionsChange : undefined}
      onCaptureChange={handleCaptureChange}
      placeholder={config.placeholder}
      manageLabel={config.manageLabel}
      canManage={config.canManage}
      canAdd={config.canAdd}
      multi={config.multi}
    />
  )
}

/** @deprecated Use SelectInputField instead */
export { SelectInputField as TagsInputField }
