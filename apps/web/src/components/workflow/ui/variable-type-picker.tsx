// apps/web/src/components/workflow/ui/variable-type-picker.tsx

'use client'

import React, { useState, useMemo } from 'react'
import { Popover, PopoverContent, PopoverTrigger } from '@auxx/ui/components/popover'
import {
  Command,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandItem,
} from '@auxx/ui/components/command'
import { Switch } from '@auxx/ui/components/switch'
import { Label } from '@auxx/ui/components/label'
import { Button } from '@auxx/ui/components/button'
import { Check, ChevronDown } from 'lucide-react'
import { VarTypeIcon, getVarTypeName } from '~/components/workflow/utils/icon-helper'
import { BaseType } from '~/components/workflow/types/unified-types'
import { cn } from '@auxx/ui/lib/utils'

/**
 * Value format for variable type picker
 */
export interface VariableTypeValue {
  baseType: BaseType
  isArray: boolean
}

/**
 * Props for VariableTypePicker component
 */
export interface VariableTypePickerProps {
  // Core
  value: VariableTypeValue
  onChange: (value: VariableTypeValue) => void

  // UI Options
  placeholder?: string
  align?: 'start' | 'center' | 'end'
  side?: 'top' | 'right' | 'bottom' | 'left'
  popoverWidth?: number
  popoverHeight?: number
  disabled?: boolean
  className?: string

  // Controlled State
  open?: boolean
  onOpenChange?: (open: boolean) => void

  // Filtering
  excludeTypes?: BaseType[]
  includeArrayToggle?: boolean // Default: true

  // Customization
  showIcons?: boolean // Default: true
  showSearch?: boolean // Default: true
  compact?: boolean // Use smaller trigger button
}

/**
 * VariableTypePicker component
 * A unified, reusable variable type picker using Popover + Command interface
 */
export const VariableTypePicker: React.FC<VariableTypePickerProps> = ({
  value,
  onChange,
  placeholder = 'Search types...',
  align = 'start',
  side = 'bottom',
  popoverWidth = 200,
  popoverHeight = 600,
  disabled = false,
  className,
  open: controlledOpen,
  onOpenChange: controlledOnOpenChange,
  excludeTypes = [],
  includeArrayToggle = true,
  showIcons = true,
  showSearch = true,
  compact = false,
}) => {
  const [internalOpen, setInternalOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')

  const open = controlledOpen ?? internalOpen
  const onOpenChange = controlledOnOpenChange ?? setInternalOpen

  // Filter and sort types
  const availableTypes = useMemo(() => {
    return Object.values(BaseType)
      .filter((type) => !excludeTypes.includes(type))
      .filter((type) => type !== BaseType.ARRAY) // Array is handled by toggle
      .filter((type) => type !== BaseType.NULL) // Usually not user-selectable
      .filter((type) => {
        if (!searchQuery) return true
        const label = getVarTypeName(type)
        return label.toLowerCase().includes(searchQuery.toLowerCase())
      })
  }, [excludeTypes, searchQuery])

  const handleTypeSelect = (baseType: BaseType) => {
    onChange({ ...value, baseType })
    if (!includeArrayToggle) {
      onOpenChange(false)
    }
  }

  const handleArrayToggle = (isArray: boolean) => {
    onChange({ ...value, isArray })
  }

  const displayValue = useMemo(() => {
    const label = getVarTypeName(value.baseType)
    return value.isArray ? `Array (${label})` : label
  }, [value])

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          size="xs"
          aria-expanded={open}
          className={cn('justify-between', className)}
          disabled={disabled}>
          <div className="flex items-center gap-1.5">
            {showIcons && <VarTypeIcon type={value.baseType} className="size-3.5" />}
            {displayValue}
          </div>
          <ChevronDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="p-0"
        align={align}
        side={side}
        style={{ width: `${popoverWidth}px`, maxHeight: `${popoverHeight}px` }}>
        <Command>
          {showSearch && (
            <CommandInput
              placeholder={placeholder}
              value={searchQuery}
              onValueChange={setSearchQuery}
            />
          )}
          <CommandList className="p-0.5">
            <CommandEmpty>No type found.</CommandEmpty>

            {/* Flat list of all available types */}
            {availableTypes.map((type) => (
              <CommandItem key={type} value={type} onSelect={() => handleTypeSelect(type)}>
                <div className="flex items-center gap-2 flex-1">
                  {showIcons && (
                    <div className="rounded-full ring-1 shrink-0 ring-ring bg-secondary flex items-center justify-center size-4">
                      <VarTypeIcon type={type} className="size-3! text-blue-500" />
                    </div>
                  )}
                  {getVarTypeName(type)}
                </div>
                <Check
                  className={cn(
                    'ml-auto h-4 w-4',
                    value.baseType === type ? 'opacity-100' : 'opacity-0'
                  )}
                />
              </CommandItem>
            ))}
          </CommandList>

          {/* Array Toggle */}
          {includeArrayToggle && (
            <div className="border-t py-2 px-3">
              <div className="flex items-center justify-between">
                <Label htmlFor="array-toggle" className="text-sm font-medium">
                  Array
                </Label>
                <Switch
                  id="array-toggle"
                  checked={value.isArray}
                  onCheckedChange={handleArrayToggle}
                />
              </div>
            </div>
          )}
        </Command>
      </PopoverContent>
    </Popover>
  )
}

/**
 * Parse a type string into VariableTypeValue
 * Supports: "string", "array(string)", etc.
 */
export const parseTypeString = (typeString: string): VariableTypeValue => {
  const arrayMatch = typeString.match(/^array\((.+)\)$/)

  if (arrayMatch) {
    return {
      baseType: arrayMatch[1] as BaseType,
      isArray: true,
    }
  }

  return {
    baseType: typeString as BaseType,
    isArray: false,
  }
}

/**
 * Format VariableTypeValue into a type string
 * Returns: "string" or "array(string)"
 */
export const formatTypeString = (value: VariableTypeValue): string => {
  return value.isArray ? `array(${value.baseType})` : value.baseType
}

/**
 * Check if a type can be used in arrays
 * Most types can, but some like NULL shouldn't be
 */
export const canBeArrayType = (type: BaseType): boolean => {
  return ![BaseType.NULL, BaseType.ANY].includes(type)
}
