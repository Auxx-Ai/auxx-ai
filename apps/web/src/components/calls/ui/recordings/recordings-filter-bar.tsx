// apps/web/src/components/calls/ui/recordings/recordings-filter-bar.tsx
'use client'

import { BOT_STATUSES, type BotStatus } from '@auxx/lib/recording/client'
import { type DateRange, DateRangePicker } from '@auxx/ui/components/date-range-picker'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@auxx/ui/components/select'
import { addDays, endOfDay, startOfDay } from 'date-fns'
import { useCallback } from 'react'
import type { RecordingsFilter } from './recordings-types'

interface RecordingsFilterBarProps {
  filter: RecordingsFilter
  setFilter: (filter: RecordingsFilter | ((prev: RecordingsFilter) => RecordingsFilter)) => void
}

function titleCase(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1)
}

const statusOptions: { value: BotStatus | 'all'; label: string }[] = [
  { value: 'all', label: 'All statuses' },
  ...BOT_STATUSES.map((status) => ({ value: status, label: titleCase(status) })),
]

export function RecordingsFilterBar({ filter, setFilter }: RecordingsFilterBarProps) {
  const handleStatusChange = useCallback(
    (value: string) => {
      setFilter((prev) => ({ ...prev, status: value as BotStatus | 'all' }))
    },
    [setFilter]
  )

  const handleDateChange = useCallback(
    (range: DateRange) => {
      setFilter((prev) => ({ ...prev, startDate: range.from, endDate: range.to }))
    },
    [setFilter]
  )

  return (
    <div className='flex gap-1 items-center'>
      <DateRangePicker
        value={{
          from: filter.startDate ?? startOfDay(addDays(new Date(), -30)),
          to: filter.endDate ?? endOfDay(new Date()),
        }}
        onChange={handleDateChange}
        showShortLabel
        triggerClassName='sm:w-[200px]'
        triggerVariant='ghost'
      />

      <Select value={filter.status} onValueChange={handleStatusChange}>
        <SelectTrigger
          size='sm'
          className='w-[150px] bg-transparent hover:bg-accent hover:text-accent-foreground border-0'>
          <SelectValue placeholder='Status' />
        </SelectTrigger>
        <SelectContent>
          {statusOptions.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}
