// apps/web/src/components/fields/inputs/select-input-field.tsx
'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { usePropertyContext } from '../property-provider'
import { useFieldNavigationOptional } from '../field-navigation-context'
import { MultiSelectPicker } from '~/components/pickers/multi-select-picker'
import { Popover, PopoverContent, PopoverTrigger } from '@auxx/ui/components/popover'
import { Button } from '@auxx/ui/components/button'
import { ChevronDown, X } from 'lucide-react'
import { cn } from '@auxx/ui/lib/utils'
import { TagsView } from '~/components/ui/tags-view'
import { FieldType } from '@auxx/database/enums'
import type { SelectOption } from '@auxx/types/custom-field'
import { toResourceFieldId } from '@auxx/types/field'
import { parseRecordId } from '@auxx/lib/resources/client'
import { useCustomFieldMutations } from '~/components/custom-fields/hooks/use-custom-field-mutations'

/**
 * Configuration for select-type fields based on field type
 */
export interface SelectConfig {
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
export function getSelectConfig(fieldType: string): SelectConfig {
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
 *
 * Uses onBeforeClose hook to flush pending debounced saves when popover closes.
 */
export function SelectInputField() {
  const { value, field, recordId, commitValue, close, onBeforeClose } = usePropertyContext()
  const nav = useFieldNavigationOptional()
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null)

  // Parse recordId to get entityDefinitionId for constructing ResourceFieldId
  const { entityDefinitionId } = parseRecordId(recordId)

  // Get configuration based on field type
  const config = getSelectConfig(field?.fieldType || field?.type)

  // Local selected state for debouncing (multi-select only)
  const [localSelected, setLocalSelected] = useState<string[]>(() => {
    const options = field?.options?.options || []
    const optionValues = new Set(options.map((opt: SelectOption) => opt.value))
    // Normalize value to array (SINGLE_SELECT stores string, MULTI_SELECT/TAGS store string[])
    const valueArray = Array.isArray(value) ? value : value ? [value] : []
    return valueArray.filter((v: string) => optionValues.has(v))
  })

  // Ref to track current local value (for onBeforeClose handler)
  const localSelectedRef = useRef<string[]>(localSelected)
  useEffect(() => {
    localSelectedRef.current = localSelected
  }, [localSelected])

  // Use centralized mutations hook with optimistic updates for field options
  const { update: updateField } = useCustomFieldMutations({ entityDefinitionId })

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

  // Register onBeforeClose handler to flush pending saves when popover closes
  useEffect(() => {
    if (!config.multi) return // Only needed for multi-select

    onBeforeClose.current = () => {
      console.log(
        'SelectInputField: onBeforeClose - flushing debounced save',
        saveTimeoutRef.current,
        localSelectedRef.current
      )
      // Flush pending debounced save immediately
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current)
        saveTimeoutRef.current = null
        commitValue(localSelectedRef.current)
      }
    }

    return () => {
      onBeforeClose.current = undefined
    }
  }, [onBeforeClose, commitValue, config.multi])

  // Cleanup timeout on unmount (onBeforeClose already handled the save if needed)
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
        resourceFieldId: toResourceFieldId(entityDefinitionId, field.id),
        options: newOptions,
      })
    },
    [config.canManage, updateField, entityDefinitionId, field.id]
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

// ─────────────────────────────────────────────────────────────────
// SelectFieldInput - Standalone input (used by FieldInputAdapter)
// ─────────────────────────────────────────────────────────────────

/**
 * Props for SelectFieldInput (standalone usage)
 */
export interface SelectFieldInputProps {
  /** Available options */
  options: SelectOption[]
  /** Current value - always string[] */
  value: string[]
  /** Change handler */
  onChange: (selected: unknown) => void
  /** Configuration from getSelectConfig() */
  config: SelectConfig
  /** Callback when options change (for TAGS management) */
  onOptionsChange?: (options: SelectOption[]) => void
  /** Placeholder text */
  placeholder?: string
  /** Disabled state */
  disabled?: boolean
  /** Additional className */
  className?: string
}

/**
 * SelectFieldInput
 * Standalone input for SINGLE_SELECT, MULTI_SELECT, and TAGS.
 * Uses TagsView for display, MultiSelectPicker for selection.
 */
export function SelectFieldInput({
  options = [],
  value,
  onChange,
  config,
  onOptionsChange,
  placeholder,
  disabled = false,
  className,
}: SelectFieldInputProps) {
  const [open, setOpen] = useState(false)

  /**
   * Handle selection changes from picker
   */
  const handleChange = useCallback(
    (selected: string[]) => {
      onChange(selected)
    },
    [onChange]
  )

  /**
   * Handle single-select completion (close popover)
   */
  const handleSelectSingle = useCallback(
    (_value: string) => {
      if (config.closeOnSelect) {
        setOpen(false)
      }
    },
    [config.closeOnSelect]
  )

  /**
   * Clear all selections
   */
  const handleClearAll = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation()
      onChange([])
    },
    [onChange]
  )

  const hasValue = value.length > 0

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="transparent"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className={cn(
            'w-full justify-between font-normal min-h-9 ps-0 pe-1',
            // !hasValue && 'text-muted-foreground',
            className
          )}>
          {hasValue ? (
            <TagsView value={value} options={options} className="flex-1" />
          ) : (
            <span className="text-primary-400 text-sm font-normal pointer-events-none">
              {placeholder ?? config.placeholder}
            </span>
          )}
          <div className="flex items-center gap-1 ml-2 shrink-0">
            {hasValue && config.multi && (
              <div
                className="size-4 flex items-center justify-center rounded-full bg-primary-500/30 text-primary-100 transition-colors hover:bg-bad-100 hover:text-bad-500"
                onClick={handleClearAll}>
                <X className="size-3!" />
              </div>
            )}
            <ChevronDown className="size-4 opacity-50" />
          </div>
        </Button>
      </PopoverTrigger>
      <PopoverContent className="min-w-[var(--radix-popover-trigger-width)] p-0" align="start">
        <MultiSelectPicker
          options={options}
          value={value}
          onChange={handleChange}
          onSelectSingle={config.closeOnSelect ? handleSelectSingle : undefined}
          onOptionsChange={config.canManage ? onOptionsChange : undefined}
          multi={config.multi}
          canAdd={config.canAdd}
          canManage={config.canManage}
          placeholder={config.placeholder}
          manageLabel={config.manageLabel}
          disabled={disabled}
        />
      </PopoverContent>
    </Popover>
  )
}
