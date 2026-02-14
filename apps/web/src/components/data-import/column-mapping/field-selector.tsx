// apps/web/src/components/data-import/column-mapping/field-selector.tsx

'use client'

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
import { Check, ChevronsUpDown, Trash2, X } from 'lucide-react'
import { useState } from 'react'
import type { ImportableField } from '../types'

interface FieldSelectorProps {
  value: string | null
  fields: ImportableField[]
  usedFieldKeys: string[]
  onChange: (fieldKey: string | null) => void
}

/**
 * Combobox for selecting target field.
 */
export function FieldSelector({ value, fields, usedFieldKeys, onChange }: FieldSelectorProps) {
  const [open, setOpen] = useState(false)

  const selectedField = fields.find((f) => f.key === value)

  // Group fields by category
  const groupedFields = fields.reduce(
    (acc, field) => {
      const group = field.category ?? 'Other'
      if (!acc[group]) acc[group] = []
      acc[group].push(field)
      return acc
    },
    {} as Record<string, ImportableField[]>
  )

  return (
    <div className='flex items-center gap-0'>
      <div className='flex-1'>
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <Button
              variant='outline'
              size='sm'
              role='combobox'
              aria-expanded={open}
              className={cn(
                'w-full justify-between',
                value && 'border-r-0 rounded-r-none',
                !value && 'text-muted-foreground'
              )}>
              {selectedField?.label ?? 'Select field...'}
              <ChevronsUpDown className=' opacity-50' />
            </Button>
          </PopoverTrigger>
          <PopoverContent className='w-64 p-0'>
            <Command>
              <CommandInput placeholder='Search fields...' />
              <CommandList>
                <CommandEmpty>No field found.</CommandEmpty>
                {Object.entries(groupedFields).map(([group, groupFields]) => (
                  <CommandGroup key={group} heading={group}>
                    {groupFields.map((field) => {
                      const isUsed = usedFieldKeys.includes(field.key) && field.key !== value
                      return (
                        <CommandItem
                          key={field.key}
                          value={field.key}
                          onSelect={() => {
                            onChange(field.key)
                            setOpen(false)
                          }}>
                          <Check
                            className={cn(value === field.key ? 'opacity-100' : 'opacity-0')}
                          />
                          {field.label}
                          {isUsed && (
                            <span className='ml-auto text-xs text-muted-foreground'>
                              will replace
                            </span>
                          )}
                        </CommandItem>
                      )
                    })}
                  </CommandGroup>
                ))}
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>
      </div>
      {/* Clear button */}
      {value && (
        <Button
          variant='outline'
          size='icon-sm'
          className='rounded-l-none bg-linear-0 hover:to-destructive/5 hover:from-destructive/5 hover:inset-shadow-none hover:text-destructive hover:border-destructive/20 shadow-none hover:shadow-xs'
          onClick={() => onChange(null)}>
          <Trash2 />
        </Button>
      )}
    </div>
  )
}
