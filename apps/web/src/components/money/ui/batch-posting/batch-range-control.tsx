// apps/web/src/components/money/ui/batch-posting/batch-range-control.tsx
'use client'

// The range control, shaped by the frequency above it (§6.2 of
// `plans/accounting/tasks/25-batch-posting-and-credit-memos.md`).
//
// The dialog used to ask From, To, Group into, which is backwards: the grouping
// is what decides what a sensible range even looks like. Frequency comes first
// now, and the control swaps on the answer.
//
// | Month | a multi-month picker | the real job is a backlog, not one month, and
//   the range is exact by construction with no off-by-one available to make |
// | Day   | the existing `DateRangePicker`, presets included | a day-grouped run
//   genuinely is an arbitrary range |
//
// 🛑 Both ends are INCLUSIVE here and half-open on the wire. `range.ts` adds the
// day; nothing on this screen explains it any more (§6.1).

import { Button } from '@auxx/ui/components/button'
import { DateRangePicker } from '@auxx/ui/components/date-range-picker'
import type { MonthRangeOption, MonthRangeValue } from '@auxx/ui/components/month-range-picker'
import { MonthRangePicker } from '@auxx/ui/components/month-range-picker'
import { Skeleton } from '@auxx/ui/components/skeleton'
import { CalendarIcon } from 'lucide-react'
import { dateOfDayKey, dayKeyOf } from './range'
import type { BatchPostingGrouping } from './types'

/** Both ends inclusive, both `YYYY-MM-DD`. */
export interface InclusiveDayRange {
  from: string
  to: string
}

interface BatchRangeControlProps {
  grouping: BatchPostingGrouping
  monthRange: MonthRangeValue | null
  onMonthRange: (value: MonthRangeValue) => void
  dayRange: InclusiveDayRange
  onDayRange: (value: InclusiveDayRange) => void
  /** From `usePostableMonths`: the ledger's own periods, disabled ones included. */
  months: readonly MonthRangeOption[]
  monthsLoading: boolean
  disabled?: boolean
}

export function BatchRangeControl({
  grouping,
  monthRange,
  onMonthRange,
  dayRange,
  onDayRange,
  months,
  monthsLoading,
  disabled,
}: BatchRangeControlProps) {
  if (grouping === 'month') {
    if (monthsLoading && months.length === 0) return <Skeleton className='h-8 w-48' />
    // The books have no periods at all: the setup wizard was never finished, or
    // the cutoff is in the future. An empty picker would be a dead end with
    // nothing on it to read, so say which screen fixes it.
    if (months.length === 0) {
      return (
        <p className='py-1.5 text-muted-foreground text-sm'>
          No accounting periods yet. Finish the ledger setup, or post by day instead.
        </p>
      )
    }
    return (
      <MonthRangePicker
        months={months}
        value={monthRange}
        onChange={onMonthRange}
        disabled={disabled}
        triggerClassName='w-full sm:w-auto'
      />
    )
  }

  return (
    <DateRangePicker
      value={{ from: dateOfDayKey(dayRange.from), to: dateOfDayKey(dayRange.to) }}
      onChange={(next) => onDayRange({ from: dayKeyOf(next.from), to: dayKeyOf(next.to) })}
      showShortLabel
      // `DateRangePicker`'s own `disabled` is a per-DAY predicate on the
      // calendar, not a switch for the control, so the whole-control disable has
      // to come through the trigger.
      trigger={({ label }) => (
        <Button
          type='button'
          variant='outline'
          size='sm'
          disabled={disabled}
          className='w-full justify-start text-left font-normal sm:w-auto'>
          <CalendarIcon />
          {label}
        </Button>
      )}
    />
  )
}
