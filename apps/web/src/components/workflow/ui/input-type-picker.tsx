// apps/web/src/components/workflow/ui/input-type-picker.tsx

'use client'

import { BASE_TYPE_GROUPS, type BaseType } from '@auxx/lib/workflow-engine/types'
import { Button } from '@auxx/ui/components/button'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@auxx/ui/components/command'
import { Popover, PopoverContent, PopoverTrigger } from '@auxx/ui/components/popover'
import { cn } from '@auxx/ui/lib/utils'
import { Check, ChevronDown } from 'lucide-react'
import { useMemo, useState } from 'react'
import { getVarTypeName, VarTypeIcon } from '~/components/workflow/utils/icon-helper'

/**
 * Props for InputTypePicker component
 */
interface InputTypePickerProps {
  value: BaseType
  onChange: (value: BaseType) => void
  disabled?: boolean
  className?: string
}

/**
 * Input type picker for workflow form-input nodes
 * Uses BaseType directly for future-proof type selection
 */
export function InputTypePicker({
  value,
  onChange,
  disabled = false,
  className,
}: InputTypePickerProps) {
  const [open, setOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')

  /**
   * Filter types based on search query
   */
  const filteredGroups = useMemo(() => {
    if (!searchQuery) return BASE_TYPE_GROUPS

    const filtered: Record<string, BaseType[]> = {}
    for (const [group, types] of Object.entries(BASE_TYPE_GROUPS)) {
      const matchingTypes = types.filter((type) =>
        getVarTypeName(type).toLowerCase().includes(searchQuery.toLowerCase())
      )
      if (matchingTypes.length > 0) {
        filtered[group] = matchingTypes
      }
    }
    return filtered
  }, [searchQuery])

  /**
   * Handle type selection
   */
  const handleSelect = (type: BaseType) => {
    onChange(type)
    setOpen(false)
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant='transparent'
          role='combobox'
          size='sm'
          aria-expanded={open}
          className={cn('w-full justify-between px-0 py-0', className)}
          disabled={disabled}>
          <div className='flex items-center gap-2'>
            <VarTypeIcon type={value} className='size-4' />
            <span>{getVarTypeName(value)}</span>
          </div>
          <ChevronDown className=' shrink-0 opacity-50' />
        </Button>
      </PopoverTrigger>
      <PopoverContent className='w-[240px] p-0' align='start'>
        <Command>
          <CommandInput
            placeholder='Search types...'
            value={searchQuery}
            onValueChange={setSearchQuery}
          />
          <CommandList className='max-h-[300px]'>
            <CommandEmpty>No type found.</CommandEmpty>
            {Object.entries(filteredGroups).map(([group, types]) => (
              <CommandGroup key={group} heading={group}>
                {types.map((type) => (
                  <CommandItem key={type} value={type} onSelect={() => handleSelect(type)}>
                    <div className='flex items-center gap-2 flex-1'>
                      <VarTypeIcon type={type} className='size-4' />
                      <span>{getVarTypeName(type)}</span>
                    </div>
                    <Check
                      className={cn(
                        'ml-auto h-4 w-4',
                        value === type ? 'opacity-100' : 'opacity-0'
                      )}
                    />
                  </CommandItem>
                ))}
              </CommandGroup>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
