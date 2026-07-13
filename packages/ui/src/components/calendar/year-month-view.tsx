// packages/ui/src/components/calendar/year-month-view.tsx

'use client'

import { cn } from '@auxx/ui/lib/utils'
import * as React from 'react'

const MonthNames = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
]

/** Years shown on either side of the current calendar year. */
const YearRange = 100

export interface YearMonthViewProps {
  /** The month currently anchoring the calendar — drives which rows render as selected. */
  month: Date
  onSelectMonth: (monthIndex: number) => void
  onSelectYear: (year: number) => void
}

/**
 * Two-column scrollable month/year picker, ported from the date-time-picker's year-month
 * view. Selecting a month returns the calendar to the day grid; selecting a year stays here
 * (matches the picker's existing pick-year-then-month feel).
 */
export function YearMonthView({ month, onSelectMonth, onSelectYear }: YearMonthViewProps) {
  const selectedMonth = month.getMonth()
  const selectedYear = month.getFullYear()

  const years = React.useMemo(() => {
    const current = new Date().getFullYear()
    return Array.from({ length: YearRange * 2 + 1 }, (_, i) => current - YearRange + i)
  }, [])

  return (
    <div data-slot='year-month-view' className='grid grid-cols-2 gap-x-1 p-2'>
      <ul className='no-scrollbar flex max-h-[15rem] flex-col gap-y-0.5 overflow-y-auto'>
        {MonthNames.map((name, index) => (
          <OptionRow
            key={name}
            isSelected={selectedMonth === index}
            onClick={() => onSelectMonth(index)}>
            {name}
          </OptionRow>
        ))}
      </ul>
      <ul className='no-scrollbar flex max-h-[15rem] flex-col gap-y-0.5 overflow-y-auto'>
        {years.map((year) => (
          <OptionRow
            key={year}
            isSelected={selectedYear === year}
            onClick={() => onSelectYear(year)}>
            {year}
          </OptionRow>
        ))}
      </ul>
    </div>
  )
}

interface OptionRowProps {
  isSelected: boolean
  onClick: () => void
  children: React.ReactNode
}

/** A selectable month/year row — scrolls itself into view once, the moment it becomes selected. */
function OptionRow({ isSelected, onClick, children }: OptionRowProps) {
  const ref = React.useRef<HTMLLIElement>(null)

  // biome-ignore lint/correctness/useExhaustiveDependencies: only scroll once, on mount
  React.useEffect(() => {
    // Instant (not smooth) scroll on mount/open — a smooth scroll here reads as jank.
    if (isSelected) ref.current?.scrollIntoView({ block: 'center' })
  }, [])

  return (
    <li
      ref={ref}
      onClick={onClick}
      className={cn(
        'flex cursor-pointer items-center justify-center rounded-md px-1.5 py-1 text-sm font-medium transition-colors',
        isSelected ? 'bg-primary-100 text-primary-600' : 'text-secondary-600 hover:bg-secondary-100'
      )}>
      {children}
    </li>
  )
}
