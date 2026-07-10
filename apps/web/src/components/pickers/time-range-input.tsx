// apps/web/src/components/pickers/time-range-input.tsx
'use client'

import { Button } from '@auxx/ui/components/button'
import { Popover, PopoverContent, PopoverTrigger } from '@auxx/ui/components/popover'
import { cn } from '@auxx/ui/lib/utils'
import { X } from 'lucide-react'
import { useCallback, useState } from 'react'
import { Period } from './date-time-picker/types'
import {
  createDateWithTime,
  getHourIn12HourFormat,
  getPeriod,
  to24Hour,
} from './date-time-picker/utils'
import TimeView from './date-time-picker/views/time-view'

/** A single `{ start, end }` boundary — minutes since midnight, null = not chosen yet */
export interface TimeRangeValue {
  start: number | null
  end: number | null
}

export interface TimeRangeInputProps {
  /** Current range, minutes since midnight (null on either side = empty segment) */
  value: TimeRangeValue
  /** Fired whenever a segment changes */
  onChange: (value: TimeRangeValue) => void
  /** Shows the trailing ✕ when provided */
  onRemove?: () => void
  /** Minute-column step filter (e.g. 15 → only :00/:15/:30/:45) */
  minuteStep?: number
  /** 24-hour labels + time-view columns instead of 12-hour AM/PM */
  use24HourTime?: boolean
  /** Destructive border/text tint (incomplete, inverted, or overlapping range) */
  invalid?: boolean
  /** Non-interactive: no popovers, no ✕ */
  readOnly?: boolean
  className?: string
}

type Segment = 'from' | 'to'

/** Convert minutes-since-midnight to a Date usable by TimeView (date portion is arbitrary) */
function dateFromMinutes(minutes: number | null | undefined): Date | undefined {
  if (minutes == null) return undefined
  const date = new Date(2000, 0, 1)
  date.setHours(Math.floor(minutes / 60), minutes % 60, 0, 0)
  return date
}

/** Convert a Date's time-of-day to minutes-since-midnight */
function dateToMinutes(date: Date): number {
  return date.getHours() * 60 + date.getMinutes()
}

/** Resolve the 24-hour hour from a TimeView hour string, honoring 12h/24h mode */
function resolveHour24(hourStr: string, use24HourTime: boolean, currentDate: Date | undefined) {
  const hourNum = parseInt(hourStr, 10)
  if (use24HourTime) return hourNum
  const currentPeriod = currentDate ? getPeriod(currentDate) : Period.AM
  return to24Hour(hourNum, currentPeriod)
}

/** Format minutes-since-midnight for pill display ('9:00 AM' or, in 24h mode, '09:00') */
export function minutesToLabel(minutes: number | null | undefined, use24HourTime = false) {
  if (minutes == null) return undefined
  const hours = Math.floor(minutes / 60)
  const mins = minutes % 60
  if (use24HourTime) {
    return `${hours.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}`
  }
  const period = hours >= 12 ? 'PM' : 'AM'
  const hour12 = hours % 12 || 12
  return `${hour12}:${mins.toString().padStart(2, '0')} ${period}`
}

/**
 * TimeRangeInput
 *
 * Segmented pill (`condition-badge` anatomy) editing a `{ start, end }` minutes-since-midnight
 * range: `[ from ▾ | – | to ▾ | ✕ ]`. Each time segment opens a popover with the standalone
 * time-view picker; the picker speaks `Date`, the value speaks minutes — conversion happens at
 * this component's boundary. Picking a complete `from` time (hour + minute) closes that popover
 * and auto-opens `to` if it's still empty.
 */
export function TimeRangeInput({
  value,
  onChange,
  onRemove,
  minuteStep = 15,
  use24HourTime = false,
  invalid = false,
  readOnly = false,
  className,
}: TimeRangeInputProps) {
  const [openSegment, setOpenSegment] = useState<Segment | null>(null)

  const minuteFilter = useCallback(
    (minutes: string[]) => minutes.filter((minute) => parseInt(minute, 10) % minuteStep === 0),
    [minuteStep]
  )

  const handleSelectHour = useCallback(
    (segment: Segment, hourStr: string) => {
      const currentDate = dateFromMinutes(segment === 'from' ? value.start : value.end)
      const hour24 = resolveHour24(hourStr, use24HourTime, currentDate)
      const minute = currentDate?.getMinutes() ?? 0
      const newDate = createDateWithTime(currentDate, hour24, minute)
      onChange({ ...value, [segment]: dateToMinutes(newDate) })
    },
    [value, onChange, use24HourTime]
  )

  const handleSelectMinute = useCallback(
    (segment: Segment, minuteStr: string) => {
      const currentDate = dateFromMinutes(segment === 'from' ? value.start : value.end)
      const hour = currentDate?.getHours() ?? 0
      const newDate = createDateWithTime(currentDate, hour, parseInt(minuteStr, 10))
      const next = { ...value, [segment]: dateToMinutes(newDate) }
      onChange(next)

      // Focus cascade: minute selection completes the segment — close it, and if this was
      // `from`, auto-open `to` when it's still empty.
      setOpenSegment(segment === 'from' && next.end == null ? 'to' : null)
    },
    [value, onChange]
  )

  const handleSelectPeriod = useCallback(
    (segment: Segment, period: Period) => {
      const currentDate = dateFromMinutes(segment === 'from' ? value.start : value.end)
      if (!currentDate) {
        const hour24 = period === Period.PM ? 12 : 0
        onChange({ ...value, [segment]: dateToMinutes(createDateWithTime(undefined, hour24, 0)) })
        return
      }
      const hour24 = to24Hour(getHourIn12HourFormat(currentDate), period)
      const newDate = createDateWithTime(currentDate, hour24, currentDate.getMinutes())
      onChange({ ...value, [segment]: dateToMinutes(newDate) })
    },
    [value, onChange]
  )

  const fromLabel = minutesToLabel(value.start, use24HourTime)
  const toLabel = minutesToLabel(value.end, use24HourTime)
  const showRemove = !!onRemove && !readOnly

  const renderSegment = (segment: Segment, label: string | undefined, hasBorder: boolean) => (
    <Popover
      key={segment}
      open={openSegment === segment}
      onOpenChange={(open) => {
        if (readOnly) return
        setOpenSegment(open ? segment : null)
      }}>
      <PopoverTrigger asChild disabled={readOnly}>
        <Button
          type='button'
          variant='transparent'
          disabled={readOnly}
          className={cn(
            'h-6 shrink-0 rounded-none px-1.5 text-xs hover:bg-primary-200/50',
            hasBorder && 'border-r',
            !label && 'text-muted-foreground',
            invalid && 'text-destructive'
          )}>
          {label ?? segment}
        </Button>
      </PopoverTrigger>
      <PopoverContent className='w-[240px] p-0 bg-background/50 backdrop-blur-sm!' align='start'>
        <TimeView
          selectedTime={dateFromMinutes(segment === 'from' ? value.start : value.end)}
          minuteFilter={minuteFilter}
          use24HourTime={use24HourTime}
          onSelectHour={(hour) => handleSelectHour(segment, hour)}
          onSelectMinute={(minute) => handleSelectMinute(segment, minute)}
          onSelectPeriod={(period) => handleSelectPeriod(segment, period)}
        />
      </PopoverContent>
    </Popover>
  )

  return (
    <div
      data-slot='time-range-input'
      className={cn(
        'flex h-6 items-center rounded-xl bg-primary-200/30 border shrink-0 overflow-hidden',
        invalid && 'border-destructive/40',
        readOnly && 'pointer-events-none opacity-70',
        className
      )}>
      {renderSegment('from', fromLabel, true)}
      <span className='flex h-6 shrink-0 items-center border-r px-1 text-xs text-muted-foreground select-none'>
        –
      </span>
      {renderSegment('to', toLabel, showRemove)}
      {showRemove && (
        <button
          type='button'
          onClick={onRemove}
          aria-label='Remove time range'
          className='flex h-6 w-7 shrink-0 items-center justify-center text-muted-foreground hover:bg-destructive/10 hover:text-destructive'>
          <X className='size-3.5 shrink-0' />
        </button>
      )}
    </div>
  )
}
