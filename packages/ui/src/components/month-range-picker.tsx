// packages/ui/src/components/month-range-picker.tsx
'use client'

// A contiguous range of whole calendar months, picked from a list the caller
// supplies rather than from a free calendar.
//
// 🛑 **The month list is the point.** The caller passes exactly the months that
// may be picked plus the ones that may not, each with a short reason, and this
// renders the unpickable ones DISABLED AND LABELLED rather than hiding them.
// A month that is simply absent leaves "where is February" with no answer on
// the screen.
//
// ⚠️ Contiguous only. Once one end is anchored, a month on the far side of a
// disabled month cannot be picked either, because the span between them would
// silently include it. That is reported on the cell the same way.

import { Button } from '@auxx/ui/components/button'
import { Popover, PopoverContentDialogAware, PopoverTrigger } from '@auxx/ui/components/popover'
import { cn } from '@auxx/ui/lib/utils'
import { CalendarRange, ChevronLeft, ChevronRight } from 'lucide-react'
import { useMemo, useState } from 'react'

/** One month the picker knows about. `key` is `'2026-01'`. */
export interface MonthRangeOption {
  key: string
  /** Renders the cell greyed and refuses the click. */
  disabled?: boolean
  /** Two or three words, shown ON the cell. The full sentence goes in `title`. */
  disabledReason?: string
}

/** Both ends inclusive, both `'2026-01'`. A single month has `from === to`. */
export interface MonthRangeValue {
  from: string
  to: string
}

interface MonthRangePickerProps {
  /** Every month the picker may show, ascending. Gaps render as unpickable cells. */
  months: readonly MonthRangeOption[]
  value: MonthRangeValue | null
  onChange: (value: MonthRangeValue) => void
  disabled?: boolean
  /** Trigger label while `value` is null. */
  placeholder?: string
  triggerClassName?: string
  /** What a cell outside `months` says. */
  outsideReason?: string
}

const MONTH_CELL = new Intl.DateTimeFormat('en-US', { month: 'short', timeZone: 'UTC' })
const MONTH_LONG = new Intl.DateTimeFormat('en-US', {
  month: 'long',
  year: 'numeric',
  timeZone: 'UTC',
})
const MONTH_SHORT = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
})

/** `'2026-03'` becomes `24315`, so a span is arithmetic and never string compare. */
function monthOrdinal(key: string): number | null {
  const match = /^(\d{4})-(\d{2})$/.exec(key)
  if (!match) return null
  const year = Number(match[1])
  const month = Number(match[2])
  if (!Number.isFinite(year) || month < 1 || month > 12) return null
  return year * 12 + (month - 1)
}

/** The inverse of {@link monthOrdinal}. */
function monthKeyOf(ordinal: number): string {
  const year = Math.floor(ordinal / 12)
  const month = (ordinal % 12) + 1
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}`
}

function monthDate(key: string): Date {
  return new Date(`${key}-01T00:00:00.000Z`)
}

/** `'2026-01'` + `'2026-03'` becomes `'Jan 2026 to Mar 2026'`; one month reads in full. */
export function formatMonthRange(value: MonthRangeValue): string {
  if (value.from === value.to) return MONTH_LONG.format(monthDate(value.from))
  return `${MONTH_SHORT.format(monthDate(value.from))} to ${MONTH_SHORT.format(monthDate(value.to))}`
}

export function MonthRangePicker({
  months,
  value,
  onChange,
  disabled,
  placeholder = 'Select months',
  triggerClassName,
  outsideReason = 'Outside the books',
}: MonthRangePickerProps) {
  const [open, setOpen] = useState(false)
  /** The end that is already down while the other one is being picked. */
  const [anchor, setAnchor] = useState<string | null>(null)

  const model = useMemo(() => {
    const byOrdinal = new Map<number, MonthRangeOption>()
    for (const month of months) {
      const ordinal = monthOrdinal(month.key)
      if (ordinal !== null) byOrdinal.set(ordinal, month)
    }
    const ordinals = [...byOrdinal.keys()].sort((a, b) => a - b)
    return {
      byOrdinal,
      firstYear: ordinals.length ? Math.floor((ordinals[0] as number) / 12) : null,
      lastYear: ordinals.length ? Math.floor((ordinals[ordinals.length - 1] as number) / 12) : null,
    }
  }, [months])

  // 🛑 Derived, not seeded. `months` usually arrives one render AFTER the first
  // one (it is a query), so a `useState(initialYear)` would freeze on whatever
  // year the empty list implied and open on a grid with nothing pickable in it.
  const [navigatedYear, setNavigatedYear] = useState<number | null>(null)
  const valueOrdinal = monthOrdinal(value?.to ?? '')
  const year =
    navigatedYear ??
    (valueOrdinal !== null
      ? Math.floor(valueOrdinal / 12)
      : (model.lastYear ?? new Date().getUTCFullYear()))
  const setYear = (next: (current: number) => number) => setNavigatedYear(next(year))

  const selection = useMemo(() => {
    const from = monthOrdinal(value?.from ?? '')
    const to = monthOrdinal(value?.to ?? '')
    if (from === null || to === null) return null
    return { from: Math.min(from, to), to: Math.max(from, to) }
  }, [value])

  /**
   * Why this cell cannot be picked, or null when it can.
   *
   * Three flavours, in the order somebody would ask about them: the month is
   * not in the books at all, the month itself is refused, or the SPAN from the
   * anchor to it crosses one that is.
   */
  const refusalFor = (ordinal: number): string | null => {
    const option = model.byOrdinal.get(ordinal)
    if (!option) return outsideReason
    if (option.disabled) return option.disabledReason ?? 'Cannot be posted'
    const anchorOrdinal = monthOrdinal(anchor ?? '')
    if (anchorOrdinal === null) return null
    const low = Math.min(anchorOrdinal, ordinal)
    const high = Math.max(anchorOrdinal, ordinal)
    for (let cursor = low; cursor <= high; cursor += 1) {
      const between = model.byOrdinal.get(cursor)
      if (!between || between.disabled) return 'Blocked in between'
    }
    return null
  }

  const select = (ordinal: number) => {
    const key = monthKeyOf(ordinal)
    const anchorOrdinal = monthOrdinal(anchor ?? '')
    if (anchorOrdinal === null) {
      setAnchor(key)
      onChange({ from: key, to: key })
      return
    }
    setAnchor(null)
    onChange({
      from: monthKeyOf(Math.min(anchorOrdinal, ordinal)),
      to: monthKeyOf(Math.max(anchorOrdinal, ordinal)),
    })
  }

  const cells = Array.from({ length: 12 }, (_, index) => year * 12 + index)
  const canGoBack = model.firstYear === null || year > model.firstYear
  const canGoForward = model.lastYear === null || year < model.lastYear

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (!next) setAnchor(null)
      }}>
      <PopoverTrigger asChild>
        <Button
          type='button'
          variant='outline'
          size='sm'
          disabled={disabled}
          className={cn('justify-start text-left font-normal', triggerClassName)}>
          <CalendarRange />
          {value ? formatMonthRange(value) : placeholder}
        </Button>
      </PopoverTrigger>
      {/* Dialog-aware: this picker's first caller lives inside a dialog, and a
          plain body portal fights the dialog for focus. Falls back to a body
          portal everywhere else. */}
      <PopoverContentDialogAware className='w-[17rem] p-2' align='start'>
        <div className='flex items-center justify-between gap-1 pb-2'>
          <Button
            type='button'
            variant='ghost'
            size='sm'
            aria-label='Previous year'
            disabled={!canGoBack}
            onClick={() => setYear((current) => current - 1)}>
            <ChevronLeft />
          </Button>
          <span className='font-medium text-sm tabular-nums'>{year}</span>
          <Button
            type='button'
            variant='ghost'
            size='sm'
            aria-label='Next year'
            disabled={!canGoForward}
            onClick={() => setYear((current) => current + 1)}>
            <ChevronRight />
          </Button>
        </div>

        <div className='grid grid-cols-3 gap-1'>
          {cells.map((ordinal) => {
            const key = monthKeyOf(ordinal)
            const refusal = refusalFor(ordinal)
            const inRange = !!selection && ordinal >= selection.from && ordinal <= selection.to
            const isEnd = !!selection && (ordinal === selection.from || ordinal === selection.to)
            return (
              <button
                key={key}
                type='button'
                disabled={!!refusal}
                title={refusal ?? formatMonthRange({ from: key, to: key })}
                onClick={() => select(ordinal)}
                className={cn(
                  'flex h-12 flex-col items-center justify-center rounded-md border border-transparent px-1 text-sm transition-colors',
                  refusal
                    ? 'cursor-not-allowed bg-muted/40 text-muted-foreground/70'
                    : 'hover:bg-accent hover:text-accent-foreground',
                  inRange && !refusal && 'bg-accent/60',
                  isEnd && !refusal && 'border-primary bg-primary/10 font-medium'
                )}>
                <span>{MONTH_CELL.format(monthDate(key))}</span>
                {refusal && (
                  <span className='w-full truncate text-[10px] leading-tight'>{refusal}</span>
                )}
              </button>
            )
          })}
        </div>

        <p className='px-1 pt-2 text-[11px] text-muted-foreground'>
          {anchor
            ? 'Pick a second month to extend the range, or the same one again.'
            : 'Pick a month, then a second one for a range.'}
        </p>
      </PopoverContentDialogAware>
    </Popover>
  )
}
