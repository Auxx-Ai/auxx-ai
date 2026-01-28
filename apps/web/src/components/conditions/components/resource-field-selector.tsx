// apps/web/src/components/conditions/components/resource-field-selector.tsx

'use client'

import { useState, useMemo, useCallback } from 'react'
import { Variable } from 'lucide-react'
import { Popover, PopoverContent, PopoverTrigger } from '@auxx/ui/components/popover'
import { MultiSelectPicker } from '~/components/pickers/multi-select-picker'
import type { FieldSelectorProps, FieldDefinition } from '../types'
import type { SelectOption } from '@auxx/types/custom-field'
import { VAR_TYPE_ICON_MAP } from '~/components/workflow/utils'

/**
 * Props for ResourceFieldSelector, extends base FieldSelectorProps with available fields
 */
export interface ResourceFieldSelectorProps
  extends Omit<FieldSelectorProps, 'popoverWidth' | 'popoverHeight'> {
  availableFields: FieldDefinition[]
  /** Custom render function for trigger - when provided, uses custom trigger instead of default */
  renderTrigger?: (props: { isOpen: boolean; onClick: () => void }) => React.ReactNode
  /** Controlled open state */
  open?: boolean
  /** Controlled open state handler */
  onOpenChange?: (open: boolean) => void
}

/**
 * Field selector for resource-based systems (like find/filter nodes)
 * Uses MultiSelectPicker with single-select mode for field selection
 * Supports custom trigger via renderTrigger prop
 */
const ResourceFieldSelector = ({
  value,
  onChange,
  disabled,
  placeholder = 'Select field',
  className,
  availableFields,
  renderTrigger,
  open: controlledOpen,
  onOpenChange: controlledOnOpenChange,
}: ResourceFieldSelectorProps) => {
  // Internal state for uncontrolled mode
  const [internalOpen, setInternalOpen] = useState(false)
  const isOpen = controlledOpen !== undefined ? controlledOpen : internalOpen
  const setIsOpen = controlledOnOpenChange || setInternalOpen

  /** Convert FieldDefinition[] to SelectOption[] for MultiSelectPicker */
  const options: SelectOption[] = useMemo(
    () =>
      availableFields.map((field) => ({
        value: field.id,
        label: field.label,
        icon: VAR_TYPE_ICON_MAP[field.type], // EntityIcon will display the type icon
      })),
    [availableFields]
  )

  /** Handle selection change from MultiSelectPicker */
  const handleChange = useCallback(
    (selected: string[]) => {
      if (selected.length > 0) {
        onChange(selected[0])
      }
    },
    [onChange]
  )

  /** Handle single select - close popover after selection */
  const handleSelectSingle = useCallback(
    (selectedValue: string) => {
      onChange(selectedValue)
      setIsOpen(false)
    },
    [onChange, setIsOpen]
  )

  /** Get selected field label for default trigger display */
  const selectedField = availableFields.find((f) => f.id === value)

  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <PopoverTrigger asChild>
        {renderTrigger ? (
          renderTrigger({ isOpen, onClick: () => setIsOpen(!isOpen) })
        ) : (
          <div className="cursor-pointer">
            {value && selectedField ? (
              <div className="flex justify-start">
                <div className="inline-flex h-6 max-w-full items-center rounded-md border-[0.5px] border-border bg-background px-1.5 text-primary-500 shadow-xs">
                  <Variable className="size-3.5 shrink-0 text-accent-500" />
                  <div className="ml-0.5 truncate text-xs font-medium">{selectedField.label}</div>
                </div>
              </div>
            ) : (
              <span className="text-muted-foreground">{placeholder}</span>
            )}
          </div>
        )}
      </PopoverTrigger>
      <PopoverContent className="min-w-[200px] p-0" align="start">
        <MultiSelectPicker
          options={options}
          value={value ? [value] : []}
          onChange={handleChange}
          onSelectSingle={handleSelectSingle}
          multi={false}
          canManage={false}
          canAdd={false}
          placeholder="Search fields..."
          disabled={disabled}
        />
      </PopoverContent>
    </Popover>
  )
}

export default ResourceFieldSelector
