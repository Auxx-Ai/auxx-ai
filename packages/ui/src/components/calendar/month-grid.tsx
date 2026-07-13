// packages/ui/src/components/calendar/month-grid.tsx

'use client'

import { addDays, format, isSameMonth, startOfWeek } from 'date-fns'
import * as React from 'react'
import { useCalendarContext } from './calendar'
import { CalendarDay } from './calendar-day'
import { getMonthWeeks, toDayKey } from './utils'

export interface MonthGridProps {
  month: Date
  showOutsideDays: boolean
  onKeyDown: (event: React.KeyboardEvent<HTMLDivElement>) => void
}

/** Weekday header row + week rows + day cells for a single month, honoring `weekStartsOn`. */
export function MonthGrid({ month, showOutsideDays, onKeyDown }: MonthGridProps) {
  const { weekStartsOn } = useCalendarContext()

  const weeks = React.useMemo(() => getMonthWeeks(month, weekStartsOn), [month, weekStartsOn])

  const weekdays = React.useMemo(() => {
    const start = startOfWeek(month, { weekStartsOn })
    return Array.from({ length: 7 }, (_, i) => {
      const date = addDays(start, i)
      return { key: i, short: format(date, 'EEEEEE'), full: format(date, 'EEEE') }
    })
  }, [month, weekStartsOn])

  return (
    <div
      data-slot='month-grid'
      role='grid'
      aria-label={format(month, 'MMMM yyyy')}
      onKeyDown={onKeyDown}
      className='w-full outline-none'>
      <div data-slot='weekdays' role='row' className='grid grid-cols-7'>
        {weekdays.map((day) => (
          <div
            key={day.key}
            data-slot='weekday'
            role='columnheader'
            aria-label={day.full}
            className='flex items-center justify-center py-1 text-[0.8rem] font-normal text-muted-foreground @max-[14rem]:text-[0.65rem]'>
            {day.short}
          </div>
        ))}
      </div>
      {weeks.map((week) => (
        <div
          key={toDayKey(week[0] as Date)}
          data-slot='week'
          role='row'
          className='grid grid-cols-7'>
          {week.map((date) => (
            <CalendarDay
              key={toDayKey(date)}
              date={date}
              outside={!isSameMonth(date, month)}
              showOutsideDays={showOutsideDays}
            />
          ))}
        </div>
      ))}
    </div>
  )
}
