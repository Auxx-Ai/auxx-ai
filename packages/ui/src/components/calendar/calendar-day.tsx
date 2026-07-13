// packages/ui/src/components/calendar/calendar-day.tsx

'use client'

import { buttonVariants } from '@auxx/ui/components/button'
import { cn } from '@auxx/ui/lib/utils'
import { isToday } from 'date-fns'
import { useCalendarContext } from './calendar'
import { isInRange, isRangeEnd, isRangeStart, toDayKey } from './utils'

export interface CalendarDayProps {
  date: Date
  /** True when `date` belongs to an adjacent month shown to fill out the grid. */
  outside: boolean
  showOutsideDays: boolean
}

function kebabCase(value: string): string {
  return value.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase()
}

/**
 * One day cell: a `data-slot='day'` grid cell wrapping a `data-slot='day-button'`. All
 * selection/keyboard/hover state comes from `CalendarContext` — this component only derives
 * the per-day booleans and renders.
 *
 * Disabled days stay real, focusable DOM buttons (no `disabled` attribute — `aria-disabled`
 * instead), so keyboard navigation can land on them and screen readers still announce them;
 * only click/`Enter`/`Space` are made inert. This is the DayPicker-compatible approach.
 */
export function CalendarDay({ date, outside, showOutsideDays }: CalendarDayProps) {
  const ctx = useCalendarContext()

  if (outside && !showOutsideDays) {
    return (
      <div
        data-slot='day'
        role='gridcell'
        data-outside
        className='aspect-square w-full min-w-0 p-0'
      />
    )
  }

  const today = isToday(date)
  const disabled = ctx.isDayDisabled(date)
  const dayKey = toDayKey(date)
  const isRangeMode = ctx.mode === 'range'

  const selected = isRangeMode
    ? !!ctx.selectedRange && !ctx.selectedRange.to && toDayKey(ctx.selectedRange.from) === dayKey
    : !!ctx.selectedDate && toDayKey(ctx.selectedDate) === dayKey
  const rangeStart = isRangeMode && !!ctx.selectedRange?.to && isRangeStart(date, ctx.selectedRange)
  const rangeEnd = isRangeMode && isRangeEnd(date, ctx.selectedRange)
  const rangeMiddle =
    isRangeMode &&
    !!ctx.selectedRange?.to &&
    isInRange(date, ctx.selectedRange) &&
    !rangeStart &&
    !rangeEnd
  const rangePreview = isRangeMode && isInRange(date, ctx.previewRange)

  const modifierAttrs: Record<string, boolean> = {}
  if (ctx.modifiers) {
    for (const [name, predicate] of Object.entries(ctx.modifiers)) {
      if (predicate(date)) modifierAttrs[`data-${kebabCase(name)}`] = true
    }
  }

  const rangeRounding = rangeMiddle
    ? 'rounded-none'
    : rangeStart && rangeEnd
      ? undefined
      : rangeStart
        ? 'rounded-l-md rounded-r-none'
        : rangeEnd
          ? 'rounded-l-none rounded-r-md'
          : undefined

  const tabbable = ctx.tabbableKey === dayKey

  return (
    <div
      data-slot='day'
      role='gridcell'
      aria-selected={isRangeMode ? rangeStart || rangeEnd || undefined : undefined}
      data-today={today || undefined}
      data-selected={selected || undefined}
      data-outside={outside || undefined}
      data-disabled={disabled || undefined}
      data-range-start={rangeStart || undefined}
      data-range-middle={rangeMiddle || undefined}
      data-range-end={rangeEnd || undefined}
      data-range-preview={rangePreview || undefined}
      {...modifierAttrs}
      className='group/day relative aspect-square w-full min-w-0 p-0'>
      <button
        type='button'
        data-slot='day-button'
        data-day={dayKey}
        tabIndex={tabbable ? 0 : -1}
        aria-disabled={disabled || undefined}
        aria-pressed={!isRangeMode ? selected : undefined}
        onClick={() => {
          if (disabled) return
          ctx.onDaySelect(date)
        }}
        onFocus={() => ctx.onDayFocus(date)}
        onMouseEnter={() => ctx.onDayHoverStart(date)}
        onMouseLeave={ctx.onDayHoverEnd}
        onKeyDown={(event) => {
          if ((event.key === 'Enter' || event.key === ' ') && !disabled) {
            event.preventDefault()
            ctx.onDaySelect(date)
          }
        }}
        className={cn(
          buttonVariants({ variant: 'ghost' }),
          'absolute inset-0 size-full rounded-md p-0 text-sm font-normal @max-[14rem]:text-xs',
          outside && 'text-primary-300',
          today && 'rounded-lg bg-accent-100 font-semibold text-info hover:bg-accent-200',
          rangePreview && 'bg-accent/50',
          rangeMiddle && 'bg-accent text-accent-foreground',
          (rangeStart || rangeEnd) && 'bg-primary-200 text-primary-400',
          rangeRounding,
          disabled && 'cursor-default text-muted-foreground opacity-50 hover:bg-transparent',
          selected &&
            'bg-info text-white hover:bg-info! hover:text-primary-foreground focus:bg-info focus:text-primary-foreground'
        )}>
        <span>{date.getDate()}</span>
        {ctx.renderDay?.({ date, outside })}
      </button>
    </div>
  )
}
