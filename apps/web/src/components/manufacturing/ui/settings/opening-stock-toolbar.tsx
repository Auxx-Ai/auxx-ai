// apps/web/src/components/manufacturing/ui/settings/opening-stock-toolbar.tsx
'use client'

import { Button } from '@auxx/ui/components/button'
import {
  Command,
  CommandDetailItem,
  CommandGroup,
  CommandInput,
  CommandList,
} from '@auxx/ui/components/command'
import { InputSearch } from '@auxx/ui/components/input-search'
import { ListToolbar, ListToolbarGroup } from '@auxx/ui/components/list-toolbar'
import { Popover, PopoverContent, PopoverTrigger } from '@auxx/ui/components/popover'
import { ChevronDown, CircleX, ListFilter } from 'lucide-react'
import { useState } from 'react'
import { SelectAllCheckbox } from '~/components/list-selection'
import {
  type OpeningStockCounts,
  type OpeningStockFilter,
  partKindLabel,
} from '../../hooks/use-opening-stock'

/** The list's `p-3`, which `SelectAllCheckbox` aligns its box against. */
const OPENING_STOCK_LIST_PADDING = 12

interface FilterOption {
  value: OpeningStockFilter
  label: string
  count: number
}

interface OpeningStockToolbarProps {
  search: string
  onSearchChange: (search: string) => void
  filter: OpeningStockFilter
  onFilterChange: (filter: OpeningStockFilter) => void
  counts: OpeningStockCounts
  kindCounts: Map<string, number>
  canSetKind: boolean
}

export function OpeningStockToolbar({
  search,
  onSearchChange,
  filter,
  onFilterChange,
  counts,
  kindCounts,
  canSetKind,
}: OpeningStockToolbarProps) {
  const [open, setOpen] = useState(false)

  const stateOptions: FilterOption[] = [
    { value: 'all', label: 'All parts', count: counts.all },
    { value: 'not-counted', label: 'Not counted', count: counts.notCounted },
    { value: 'counted', label: 'Counted', count: counts.counted },
    { value: 'uncounted', label: 'Sold, never counted', count: counts.uncounted },
    { value: 'unclassified', label: 'Unclassified', count: counts.unclassified },
    { value: 'uncosted', label: 'No standard cost', count: counts.uncosted },
    { value: 'unbuilt', label: 'Unbuilt sales', count: counts.unbuilt },
  ]
  const kindOptions: FilterOption[] = [...kindCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([kind, count]) => ({ value: `kind:${kind}`, label: partKindLabel(kind), count }))

  const active = [...stateOptions, ...kindOptions].find((o) => o.value === filter)
  const isDirty = filter !== 'all' || search !== ''

  const select = (value: OpeningStockFilter) => {
    onFilterChange(value)
    setOpen(false)
  }

  const renderOption = (option: FilterOption) => (
    <CommandDetailItem
      key={option.value}
      value={option.label}
      title={option.label}
      secondary={<span className='text-muted-foreground text-xs tabular-nums'>{option.count}</span>}
      selected={option.value === filter}
      selectionMode='check'
      onSelect={() => select(option.value)}
    />
  )

  return (
    <ListToolbar sticky={false}>
      <SelectAllCheckbox listPadding={OPENING_STOCK_LIST_PADDING} disabled={!canSetKind} />
      <ListToolbarGroup className='min-w-40 flex-1'>
        <InputSearch
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder='Search by part or SKU...'
          className='h-7'
        />
      </ListToolbarGroup>
      <ListToolbarGroup className='shrink-0'>
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <Button variant='ghost' size='sm' className='justify-start'>
              <ListFilter />
              <span className='text-left tabular-nums'>
                {filter === 'all' || !active ? 'Filter' : `${active.label} (${active.count})`}
              </span>
              <ChevronDown />
            </Button>
          </PopoverTrigger>
          <PopoverContent align='start' className='w-64 p-0'>
            <Command>
              <CommandInput placeholder='Search filters…' />
              <CommandList>
                <CommandGroup heading='Count'>{stateOptions.map(renderOption)}</CommandGroup>
                {kindOptions.length > 0 && (
                  <CommandGroup heading='Kind'>{kindOptions.map(renderOption)}</CommandGroup>
                )}
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>
        <Button
          variant='ghost'
          size='icon-sm'
          aria-label='Clear filters'
          disabled={!isDirty}
          onClick={() => {
            onFilterChange('all')
            onSearchChange('')
          }}>
          <CircleX />
        </Button>
      </ListToolbarGroup>
    </ListToolbar>
  )
}
