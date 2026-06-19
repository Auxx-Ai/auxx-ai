// apps/web/src/components/global/calc-formula/functions-picker-group.tsx

'use client'

import { CommandGroup, CommandItem, CommandSeparator } from '@auxx/ui/components/command'
import { EntityIcon } from '@auxx/ui/components/icons'
import { getAvailableFunctions } from '@auxx/utils/calc-expression'
import { useMemo } from 'react'

interface FunctionsPickerGroupProps {
  /** Current picker search query — filters the function list. */
  search: string
  /** Insert a function call (`name(`) at the cursor. */
  onSelect: (funcName: string) => void
}

/**
 * The shared Functions group for the `{`-picker, rendered after a token source's
 * items. Both calc-formula consumers (custom-fields, data-connectors) render it,
 * so the `getAvailableFunctions()` + search-filter logic lives once.
 */
export function FunctionsPickerGroup({ search, onSelect }: FunctionsPickerGroupProps) {
  const functions = useMemo(() => getAvailableFunctions(), [])

  const filtered = search
    ? functions.filter(
        (f) =>
          f.name.toLowerCase().includes(search.toLowerCase()) ||
          f.description.toLowerCase().includes(search.toLowerCase())
      )
    : functions

  if (filtered.length === 0) return null

  return (
    <>
      <CommandSeparator />
      <CommandGroup heading='Functions'>
        {filtered.map((fn) => (
          <CommandItem key={fn.name} onSelect={() => onSelect(fn.name)}>
            <EntityIcon iconId='function' size='xs' className='text-muted-foreground' />
            <div className='flex flex-col'>
              <span className='font-mono text-sm'>{fn.signature}</span>
              <span className='text-xs text-muted-foreground'>{fn.description}</span>
            </div>
          </CommandItem>
        ))}
      </CommandGroup>
    </>
  )
}
