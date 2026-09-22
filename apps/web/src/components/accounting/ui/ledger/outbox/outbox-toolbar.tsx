// apps/web/src/components/accounting/ui/ledger/outbox/outbox-toolbar.tsx
'use client'

import type { OutboxTab } from '@auxx/lib/accounting/export/client'
import { EXPORT_AVENUES, type ExportAvenue } from '@auxx/lib/accounting/ledger/client'
import { Button } from '@auxx/ui/components/button'
import { DateRangePicker } from '@auxx/ui/components/date-range-picker'
import { InputSearch } from '@auxx/ui/components/input-search'
import { ListToolbar, ListToolbarGroup } from '@auxx/ui/components/list-toolbar'
import { Popover, PopoverContent, PopoverTrigger } from '@auxx/ui/components/popover'
import { format } from 'date-fns'
import { ChevronDown, CircleX, Tags } from 'lucide-react'
import { SelectAllCheckbox } from '~/components/list-selection'
import { MultiSelectPicker } from '~/components/pickers/multi-select-picker'
import { EXPORT_AVENUE_LABEL } from '../export-avenue-labels'
import { OUTBOX_LIST_PADDING } from './outbox-tabs'

export interface OutboxFilters {
  search: string
  categories: string[]
  from: string
  to: string
}

export const EMPTY_OUTBOX_FILTERS: OutboxFilters = { search: '', categories: [], from: '', to: '' }

/** Every avenue, labelled and sorted - the same list on every tab. */
const CATEGORY_OPTIONS = EXPORT_AVENUES.map((value) => ({
  value,
  label: EXPORT_AVENUE_LABEL[value],
})).sort((a, b) => a.label.localeCompare(b.label))

/** The picker's strings as avenues; anything else is dropped rather than sent. */
export function outboxCategoryInput(filters: OutboxFilters): ExportAvenue[] {
  return EXPORT_AVENUES.filter((value) => filters.categories.includes(value))
}

/** Banking-style narrowing controls beneath the Outbox status tabs. */
export function OutboxToolbar({
  tab,
  filters,
  onChange,
  onClear,
  selectionDisabled = false,
}: {
  tab: OutboxTab
  filters: OutboxFilters
  onChange: (filters: OutboxFilters) => void
  onClear: () => void
  selectionDisabled?: boolean
}) {
  const dirty = !!(filters.search || filters.categories.length || filters.from || filters.to)
  return (
    <ListToolbar sticky={false}>
      <SelectAllCheckbox listPadding={OUTBOX_LIST_PADDING} disabled={selectionDisabled} />
      <ListToolbarGroup className='min-w-40 flex-1'>
        <InputSearch
          value={filters.search}
          onChange={(event) => onChange({ ...filters, search: event.target.value })}
          maxLength={200}
          placeholder='Search outbox'
          className='h-7'
        />
      </ListToolbarGroup>
      <ListToolbarGroup className='shrink-0'>
        <Popover>
          <PopoverTrigger asChild>
            <Button
              variant='ghost'
              size='sm'
              className='w-40 justify-start'
              aria-label={
                filters.categories.length
                  ? `Category, ${filters.categories.length} selected`
                  : 'Category, all categories'
              }>
              <Tags />
              <span className='flex-1 text-left tabular-nums'>
                Category{filters.categories.length > 0 ? ` (${filters.categories.length})` : ''}
              </span>
              <ChevronDown />
            </Button>
          </PopoverTrigger>
          <PopoverContent align='start' className='w-64 p-0'>
            <MultiSelectPicker
              options={CATEGORY_OPTIONS}
              value={filters.categories}
              multi
              canAdd={false}
              canManage={false}
              placeholder='Search categories…'
              onChange={(categories) =>
                onChange({ ...filters, categories: [...categories].sort() })
              }
            />
            <Button
              variant='ghost'
              size='sm'
              className='w-full'
              disabled={!filters.categories.length}
              onClick={() => onChange({ ...filters, categories: [] })}>
              All categories
            </Button>
          </PopoverContent>
        </Popover>
        <DateRangePicker
          value={
            filters.from && filters.to
              ? {
                  from: new Date(`${filters.from}T00:00:00`),
                  to: new Date(`${filters.to}T00:00:00`),
                }
              : undefined
          }
          onChange={(range) =>
            onChange({
              ...filters,
              from: format(range.from, 'yyyy-MM-dd'),
              to: format(range.to, 'yyyy-MM-dd'),
            })
          }
          showShortLabel
          placeholder='Any date'
          triggerVariant='ghost'
          triggerClassName='h-7 w-48 text-xs'
        />
        <Button
          variant='ghost'
          size='icon-sm'
          aria-label='Clear filters'
          disabled={!dirty}
          onClick={onClear}>
          <CircleX />
        </Button>
      </ListToolbarGroup>
    </ListToolbar>
  )
}
