// apps/web/src/components/workflow/nodes/shared/node-inputs/multi-select-input.tsx

'use client'

import { getColorSwatch } from '@auxx/lib/custom-fields/client'
import type { SelectOption } from '@auxx/types/custom-field'
import { Badge } from '@auxx/ui/components/badge'
import { Popover, PopoverContent, PopoverTrigger } from '@auxx/ui/components/popover'
import { cn } from '@auxx/ui/lib/utils'
import { ChevronDown, X } from 'lucide-react'
import { useCallback, useMemo, useState } from 'react'
import { MultiSelectPicker } from '~/components/pickers/multi-select-picker'
import { createNodeInput, type NodeInputProps } from './base-node-input'

interface MultiSelectInputProps extends NodeInputProps {
  /** Field name */
  name: string
  /** Available options to select from */
  options?: SelectOption[]
  /** Placeholder text */
  placeholder?: string
}

/**
 * Multi-select input following node-input interface.
 * Uses MultiSelectPicker inside a Popover for selecting predefined options.
 */
export const MultiSelectInput = createNodeInput<MultiSelectInputProps>(
  ({ inputs, onChange, name, options = [], placeholder = 'Select options...' }) => {
    const [open, setOpen] = useState(false)

    /** Get current value (array of option values) */
    const value: string[] = useMemo(() => {
      const raw = inputs[name]
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
    }, [inputs, name])

    /** Get selected option objects for display */
    const selectedOptions = useMemo(
      () => options.filter((opt) => value.includes(opt.value)),
      [options, value]
    )

    /** Handle selection change from picker */
    const handleChange = useCallback(
      (selected: string[]) => {
        onChange(name, selected)
      },
      [onChange, name]
    )

    /** Remove a single option from selection */
    const removeOption = useCallback(
      (optValue: string) => {
        onChange(
          name,
          value.filter((v) => v !== optValue)
        )
      },
      [onChange, name, value]
    )

    return (
      <div className='flex flex-col gap-2 flex-1'>
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <div>
              {selectedOptions.length > 0 ? (
                <div className='min-h-7 flex flex-row flex-wrap items-center gap-1'>
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
              options={options}
              value={value}
              onChange={handleChange}
              canManage={false}
              canAdd={false}
              placeholder='Search options...'
            />
          </PopoverContent>
        </Popover>
      </div>
    )
  }
)
