// apps/web/src/components/workflow/nodes/shared/node-inputs/multi-select-input.tsx

'use client'

import { getColorSwatch } from '@auxx/lib/custom-fields/client'
import type { SelectOption } from '@auxx/types/custom-field'
import { Badge } from '@auxx/ui/components/badge'
import { Popover, PopoverContent, PopoverTrigger } from '@auxx/ui/components/popover'
import { cn } from '@auxx/ui/lib/utils'
import { ChevronDown, X } from 'lucide-react'
import { useCallback, useMemo, useRef, useState } from 'react'
import { MultiSelectPicker } from '~/components/pickers/multi-select-picker'
import { createNodeInput, type NodeInputProps } from './base-node-input'

/** Parse a raw stored value into a string array */
const parseStoredValue = (raw: unknown): string[] => {
  if (!raw) return []
  if (Array.isArray(raw)) return raw
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw)
      if (Array.isArray(parsed)) return parsed
    } catch {
      return raw ? [raw] : []
    }
  }
  return []
}

interface MultiSelectInputProps extends NodeInputProps {
  /** Field name */
  name: string
  /** Available options to select from */
  options?: SelectOption[]
  /** Placeholder text */
  placeholder?: string
  /** Allow user to create new options at runtime */
  canAdd?: boolean
  /** Allow user to edit/delete options at runtime */
  canManage?: boolean
}

/**
 * Multi-select input following node-input interface.
 * Uses MultiSelectPicker inside a Popover for selecting predefined options.
 */
export const MultiSelectInput = createNodeInput<MultiSelectInputProps>(
  ({
    inputs,
    onChange,
    name,
    options = [],
    placeholder = 'Select options...',
    canAdd = false,
    canManage = false,
  }) => {
    const [open, setOpen] = useState(false)

    /** Track custom options created via canAdd so they persist across popover open/close and page refresh */
    const [customOptions, setCustomOptions] = useState<SelectOption[]>(() => {
      if (!canAdd) return []
      const stored = parseStoredValue(inputs[name])
      const predefinedValues = new Set(options.map((o) => o.value))
      return stored.filter((v) => !predefinedValues.has(v)).map((v) => ({ label: v, value: v }))
    })

    /** Merge prop options with custom options */
    const mergedOptions = useMemo(() => {
      if (customOptions.length === 0) return options
      const propValues = new Set(options.map((o) => o.value))
      const unique = customOptions.filter((o) => !propValues.has(o.value))
      return [...options, ...unique]
    }, [options, customOptions])

    /** Parse the stored value into a string array */
    const storedValue: string[] = useMemo(() => parseStoredValue(inputs[name]), [inputs, name])

    /** Local selection state — always used for display, decoupled from store */
    const [localValue, setLocalValue] = useState<string[]>(storedValue)
    const localValueRef = useRef(localValue)
    localValueRef.current = localValue

    /** Sync local state when stored value changes externally (only while closed) */
    const prevStoredRef = useRef(storedValue)
    if (prevStoredRef.current !== storedValue && !open) {
      prevStoredRef.current = storedValue
      setLocalValue(storedValue)
    }

    /** Get selected option objects for display */
    const selectedOptions = useMemo(
      () => mergedOptions.filter((opt) => localValue.includes(opt.value)),
      [mergedOptions, localValue]
    )

    /** Handle popover open/close — commit on close */
    const handleOpenChange = useCallback(
      (isOpen: boolean) => {
        if (!isOpen) {
          onChange(name, localValueRef.current)
        }
        setOpen(isOpen)
      },
      [onChange, name]
    )

    /** Handle selection change from picker — local only */
    const handleChange = useCallback((selected: string[]) => {
      setLocalValue(selected)
    }, [])

    /** Track options changes from picker (captures custom-created options) */
    const handleOptionsChange = useCallback(
      (newOptions: SelectOption[]) => {
        const propValues = new Set(options.map((o) => o.value))
        setCustomOptions(newOptions.filter((o) => !propValues.has(o.value)))
      },
      [options]
    )

    /** Remove a single option from selection (immediate commit) */
    const removeOption = useCallback(
      (optValue: string) => {
        const newValue = localValue.filter((v) => v !== optValue)
        setLocalValue(newValue)
        onChange(name, newValue)
      },
      [onChange, name, localValue]
    )

    return (
      <div className='flex flex-col gap-2 flex-1'>
        <Popover open={open} onOpenChange={handleOpenChange}>
          <PopoverTrigger asChild>
            <div>
              {selectedOptions.length > 0 ? (
                <div className='min-h-7 flex flex-row flex-wrap items-center gap-1 py-1.5'>
                  {selectedOptions.map((opt) => (
                    <Badge
                      key={opt.value}
                      variant='pill'
                      size='xs'
                      className='gap-1 h-5 cursor-pointer'>
                      {opt.color && (
                        <div className={cn('size-2 rounded-full', getColorSwatch(opt.color))} />
                      )}
                      <span>{opt.label}</span>
                      <button
                        type='button'
                        onClick={(e) => {
                          e.stopPropagation()
                          removeOption(opt.value)
                        }}
                        className='hover:text-destructive'>
                        <X className='size-3' />
                      </button>
                    </Badge>
                  ))}
                </div>
              ) : (
                <div className='h-7 flex items-center justify-between pe-1'>
                  <span className='cursor-default text-sm text-primary-400 font-normal pt-0.5 truncate pointer-events-none'>
                    {placeholder}
                  </span>
                  <ChevronDown className='size-4 text-foreground opacity-50' />
                </div>
              )}
            </div>
          </PopoverTrigger>
          <PopoverContent className='p-0 w-[250px]' align='start'>
            <MultiSelectPicker
              options={mergedOptions}
              value={localValue}
              onChange={handleChange}
              onOptionsChange={handleOptionsChange}
              canManage={canManage}
              canAdd={canAdd}
              useValueAsLabel={canAdd}
              placeholder='Search options...'
            />
          </PopoverContent>
        </Popover>
      </div>
    )
  }
)
