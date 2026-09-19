// apps/web/src/components/accounting/ui/banking/settlements/settlements-toolbar.tsx

'use client'

import { Button } from '@auxx/ui/components/button'
import { type DateRange, DateRangePicker } from '@auxx/ui/components/date-range-picker'
import { InputSearch } from '@auxx/ui/components/input-search'
import { ListToolbar, ListToolbarGroup } from '@auxx/ui/components/list-toolbar'
import { RadioTab, RadioTabItem } from '@auxx/ui/components/radio-tab'
import { Separator } from '@auxx/ui/components/separator'
import { format } from 'date-fns'
import { CircleHelp, CircleX, List } from 'lucide-react'

/** What narrows the settlements list, beside the unidentified view itself. */
export interface SettlementFilters {
  search: string
  from: string
  to: string
}

export const EMPTY_SETTLEMENT_FILTERS: SettlementFilters = { search: '', from: '', to: '' }

/**
 * A calendar day in the VIEWER's zone, never `toISOString().slice(0, 10)` — the
 * picker's presets are local midnights, so west of UTC the ISO string is
 * already tomorrow (`payouts-toolbar.tsx` documents the same trap).
 */
const asDay = (date: Date) => format(date, 'yyyy-MM-dd')
const asDate = (day: string) => new Date(`${day}T00:00:00`)

interface SettlementsToolbarProps {
  onlyUnidentified: boolean
  onOnlyUnidentifiedChange: (next: boolean) => void
  filters: SettlementFilters
  onChange: (next: SettlementFilters) => void
  /** The list's select-all box, first in the row; the page owns the store it reads. */
  selectAll?: React.ReactNode
}

/**
 * The settlements list's toolbar — the view tabs, then search and a date range,
 * the same shape and controls `payouts-toolbar.tsx` carries.
 *
 * `sticky={false}`: Settlements has no inner scroll frame, so a sticky row here
 * would pin against the `SettingsPage` header instead of a list viewport.
 */
export function SettlementsToolbar({
  onlyUnidentified,
  onOnlyUnidentifiedChange,
  filters,
  onChange,
  selectAll,
}: SettlementsToolbarProps) {
  const set = <K extends keyof SettlementFilters>(key: K, value: SettlementFilters[K]) =>
    onChange({ ...filters, [key]: value })

  // Both ends or neither: `DateRangePicker` only hands back a complete range.
  const range =
    filters.from && filters.to ? { from: asDate(filters.from), to: asDate(filters.to) } : undefined

  // The tab is the VIEW and lives in the URL, so Clear leaves it alone.
  const dirty = !!filters.search || !!filters.from || !!filters.to

  return (
    <ListToolbar sticky={false}>
      {selectAll}

      <ListToolbarGroup className='shrink-0'>
        <RadioTab
          value={onlyUnidentified ? 'unidentified' : 'all'}
          onValueChange={(value) => onOnlyUnidentifiedChange(value === 'unidentified')}
          size='sm'>
          <RadioTabItem value='all'>
            <List />
            All payouts
          </RadioTabItem>
          <RadioTabItem value='unidentified'>
            <CircleHelp />
            Unidentified
          </RadioTabItem>
        </RadioTab>
      </ListToolbarGroup>

      <Separator orientation='vertical' className='h-5 shrink-0' />

      <ListToolbarGroup className='min-w-40 flex-1'>
        <InputSearch
          value={filters.search}
          onChange={(event) => set('search', event.target.value)}
          placeholder='Search payout or gateway'
          className='h-7'
        />
      </ListToolbarGroup>

      <ListToolbarGroup className='shrink-0'>
        <DateRangePicker
          value={range}
          onChange={(next: DateRange) =>
            onChange({ ...filters, from: asDay(next.from), to: asDay(next.to) })
          }
          showShortLabel
          placeholder='Any date'
          triggerVariant='ghost'
          triggerClassName='h-7 w-48 text-xs'
        />
      </ListToolbarGroup>

      {dirty && (
        <ListToolbarGroup className='shrink-0'>
          <Button
            variant='ghost'
            size='sm'
            className='h-7'
            onClick={() => onChange(EMPTY_SETTLEMENT_FILTERS)}>
            <CircleX />
            Clear
          </Button>
        </ListToolbarGroup>
      )}
    </ListToolbar>
  )
}
