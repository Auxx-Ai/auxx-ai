// apps/web/src/components/availability/ui/weekly-hours-editor.tsx
'use client'

import { Button } from '@auxx/ui/components/button'
import {
  Command,
  CommandCheckboxItem,
  CommandGroup,
  CommandSeparator,
} from '@auxx/ui/components/command'
import { Popover, PopoverContent, PopoverTrigger } from '@auxx/ui/components/popover'
import { Switch } from '@auxx/ui/components/switch'
import { TreeRow } from '@auxx/ui/components/tree-row'
import { cn } from '@auxx/ui/lib/utils'
import { Copy, Plus } from 'lucide-react'
import { useCallback, useState } from 'react'
import { TimeRangeInput } from '~/components/pickers/time-range-input'

/** A single time range being edited (minutes since midnight; null = not chosen yet) */
export type WeeklyRangeDraft = { start: number | null; end: number | null }

/**
 * One weekly day row's editor state. Disabled days keep their `ranges` in memory so toggling a
 * day off and back on doesn't lose what was there — the page strips disabled days on save.
 */
export type WeeklyDayDraft = { dayOfWeek: number; enabled: boolean; ranges: WeeklyRangeDraft[] }

/** Full weekly-hours draft for one subject (org / worker / widget); always 7 `days` entries */
export type WeeklyHoursDraft = { timezone: string; days: WeeklyDayDraft[] }

export interface WeeklyHoursEditorProps {
  value: WeeklyHoursDraft
  onChange: (next: WeeklyHoursDraft) => void
  /** Day the week starts on (0 = Sunday, 1 = Monday, 6 = Saturday) — controls row order */
  weekStartsOn: 0 | 1 | 6
  /** 24-hour range pills + time-view instead of 12-hour AM/PM */
  use24HourTime?: boolean
  /** Dims the grid, hides +/✕/copy, disables the switches */
  readOnly?: boolean
  className?: string
}

const DAY_LABELS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

const DEFAULT_RANGE_START = 9 * 60 // 9:00 AM
const DEFAULT_RANGE_END = 17 * 60 // 5:00 PM

/** Day-of-week indices (0-6) in display order, starting from `weekStartsOn` */
function getOrderedDayIndices(weekStartsOn: 0 | 1 | 6): number[] {
  return Array.from({ length: 7 }, (_, i) => (weekStartsOn + i) % 7)
}

/** A range counts as "complete" once both sides are set, ordered, and don't overlap a sibling */
function isRangeComplete(
  range: WeeklyRangeDraft,
  index: number,
  ranges: WeeklyRangeDraft[]
): boolean {
  const { start, end } = range
  if (start == null || end == null) return false
  if (end <= start) return false
  return ranges.every((other, otherIndex) => {
    if (otherIndex === index) return true
    if (other.start == null || other.end == null) return true
    return end <= other.start || start >= other.end
  })
}

function isDayValid(day: WeeklyDayDraft): boolean {
  if (!day.enabled) return true
  if (day.ranges.length === 0) return false
  return day.ranges.every((range, index) => isRangeComplete(range, index, day.ranges))
}

/**
 * True when every ENABLED day's ranges are complete (both sides set), ordered (`end > start`),
 * and non-overlapping. Disabled days are ignored. Use to gate the page's Save button.
 */
export function validateWeeklyDraft(value: WeeklyHoursDraft): boolean {
  return value.days.every(isDayValid)
}

/**
 * Pill-level invalid flag: true once the user has partially or fully committed a bad range.
 * A freshly added, still-empty pill (both sides unset) is not flagged — it just shows the muted
 * placeholders — so newly-added rows don't render as errors before the user has touched them.
 */
function isRangePillInvalid(
  range: WeeklyRangeDraft,
  index: number,
  ranges: WeeklyRangeDraft[]
): boolean {
  const { start, end } = range
  if (start == null && end == null) return false
  if (start == null || end == null) return true
  if (end <= start) return true
  return ranges.some((other, otherIndex) => {
    if (otherIndex === index) return false
    if (other.start == null || other.end == null) return false
    return !(end <= other.start || start >= other.end)
  })
}

/** One concise row-level validation message, or undefined when the day has no flagged pills */
function getDayHint(day: WeeklyDayDraft): string | undefined {
  if (!day.enabled) return undefined
  const flags = day.ranges.map((range, index) => isRangePillInvalid(range, index, day.ranges))
  if (!flags.some(Boolean)) return undefined
  if (day.ranges.some((range) => (range.start == null) !== (range.end == null))) {
    return 'Enter both start and end times.'
  }
  if (
    day.ranges.some((range) => range.start != null && range.end != null && range.end <= range.start)
  ) {
    return 'End time must be after start time.'
  }
  return 'Time ranges overlap.'
}

/** Copy-hours popover: replicate one day's ranges onto other checked days */
function CopyHoursPopover({
  sourceDay,
  weekStartsOn,
  onApply,
}: {
  sourceDay: WeeklyDayDraft
  weekStartsOn: 0 | 1 | 6
  onApply: (targetDays: number[]) => void
}) {
  const [open, setOpen] = useState(false)
  const [checked, setChecked] = useState<Set<number>>(new Set())

  const otherDays = getOrderedDayIndices(weekStartsOn).filter(
    (dayOfWeek) => dayOfWeek !== sourceDay.dayOfWeek
  )

  const toggleDay = (dayOfWeek: number) => {
    setChecked((prev) => {
      const next = new Set(prev)
      if (next.has(dayOfWeek)) {
        next.delete(dayOfWeek)
      } else {
        next.add(dayOfWeek)
      }
      return next
    })
  }

  const handleApply = () => {
    if (checked.size === 0) return
    onApply(Array.from(checked))
    setChecked(new Set())
    setOpen(false)
  }

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (!next) setChecked(new Set())
      }}>
      <PopoverTrigger asChild>
        <Button
          type='button'
          variant='ghost'
          size='icon-sm'
          aria-label={`Copy ${DAY_LABELS[sourceDay.dayOfWeek]} hours to other days`}>
          <Copy className='size-3.5 text-muted-foreground' />
        </Button>
      </PopoverTrigger>
      <PopoverContent className='w-56 p-0' align='end'>
        <Command>
          <CommandGroup heading={`Copy ${DAY_LABELS[sourceDay.dayOfWeek]} hours to`}>
            {otherDays.map((dayOfWeek) => (
              <CommandCheckboxItem
                key={dayOfWeek}
                variant='switch'
                value={DAY_LABELS[dayOfWeek]}
                checked={checked.has(dayOfWeek)}
                onCheckedChange={() => toggleDay(dayOfWeek)}>
                {DAY_LABELS[dayOfWeek]}
              </CommandCheckboxItem>
            ))}
          </CommandGroup>
          <CommandSeparator />
          <CommandGroup>
            <Button
              type='button'
              variant='outline'
              size='sm'
              className='w-full rounded-b-xl'
              disabled={checked.size === 0}
              onClick={handleApply}>
              Apply
            </Button>
          </CommandGroup>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

/** One day row: switch + label + range pills + copy popover */
function WeeklyDayRow({
  day,
  weekStartsOn,
  use24HourTime,
  readOnly,
  onChange,
  onCopyTo,
}: {
  day: WeeklyDayDraft
  weekStartsOn: 0 | 1 | 6
  use24HourTime: boolean
  readOnly: boolean
  onChange: (next: WeeklyDayDraft) => void
  onCopyTo: (targetDays: number[]) => void
}) {
  const handleToggle = (enabled: boolean) => {
    if (enabled && day.ranges.length === 0) {
      onChange({
        ...day,
        enabled,
        ranges: [{ start: DEFAULT_RANGE_START, end: DEFAULT_RANGE_END }],
      })
      return
    }
    onChange({ ...day, enabled })
  }

  const handleRangeChange = (index: number, range: WeeklyRangeDraft) => {
    onChange({ ...day, ranges: day.ranges.map((r, i) => (i === index ? range : r)) })
  }

  const handleAddRange = () => {
    onChange({ ...day, ranges: [...day.ranges, { start: null, end: null }] })
  }

  const handleRemoveRange = (index: number) => {
    const ranges = day.ranges.filter((_, i) => i !== index)
    onChange(ranges.length === 0 ? { ...day, enabled: false, ranges } : { ...day, ranges })
  }

  const hint = getDayHint(day)

  // Single-line row (streams-section idiom): day label as the title, range pills inline in the
  // `secondary` slot, and the enable switch + copy in `trailing`. The validation hint sits just
  // below the row, indented under the pills.
  return (
    <div>
      <TreeRow
        title={<span className='text-sm text-foreground'>{DAY_LABELS[day.dayOfWeek]}</span>}
        secondaryFill
        secondary={
          day.enabled ? (
            <span className='flex flex-wrap items-center gap-1.5'>
              {day.ranges.map((range, index) => (
                <TimeRangeInput
                  key={index}
                  value={range}
                  onChange={(next) => handleRangeChange(index, next)}
                  onRemove={readOnly ? undefined : () => handleRemoveRange(index)}
                  use24HourTime={use24HourTime}
                  readOnly={readOnly}
                  invalid={isRangePillInvalid(range, index, day.ranges)}
                />
              ))}
              {!readOnly && (
                <Button
                  type='button'
                  variant='ghost'
                  size='icon-sm'
                  className='rounded-lg border border-dashed hover:border-primary-300 hover:bg-primary-100'
                  aria-label='Add time range'
                  onClick={handleAddRange}>
                  <Plus className='size-3.5 text-muted-foreground' />
                </Button>
              )}
            </span>
          ) : (
            <span className='text-muted-foreground text-sm'>Closed</span>
          )
        }
        trailing={
          <div className='flex items-center gap-1'>
            {!readOnly && day.enabled && (
              <CopyHoursPopover sourceDay={day} weekStartsOn={weekStartsOn} onApply={onCopyTo} />
            )}
            <Switch
              size='xs'
              checked={day.enabled}
              onCheckedChange={handleToggle}
              disabled={readOnly}
            />
          </div>
        }
      />
      {hint && <p className='ps-2 pt-0.5 text-xs text-destructive'>{hint}</p>}
    </div>
  )
}

/**
 * WeeklyHoursEditor
 *
 * Controlled, subject-agnostic weekly-hours editor: 7 fixed day rows (switch, day label,
 * `TimeRangeInput` pills for split shifts, copy-to-other-days). No data fetching and no
 * footer — the page owns fetch/save/dirty state (including the draft's `timezone`, rendered
 * page-side as a `FieldPanelRow`), strips disabled days when serializing, and renders its
 * own Save/Discard controls.
 */
export function WeeklyHoursEditor({
  value,
  onChange,
  weekStartsOn,
  use24HourTime = false,
  readOnly = false,
  className,
}: WeeklyHoursEditorProps) {
  const orderedIndices = getOrderedDayIndices(weekStartsOn)

  const handleDayChange = useCallback(
    (dayOfWeek: number, next: WeeklyDayDraft) => {
      onChange({ ...value, days: value.days.map((d) => (d.dayOfWeek === dayOfWeek ? next : d)) })
    },
    [value, onChange]
  )

  const handleCopyTo = useCallback(
    (sourceDayOfWeek: number, targetDays: number[]) => {
      const source = value.days.find((d) => d.dayOfWeek === sourceDayOfWeek)
      if (!source) return
      const targets = new Set(targetDays)
      onChange({
        ...value,
        days: value.days.map((d) =>
          targets.has(d.dayOfWeek)
            ? { ...d, enabled: true, ranges: source.ranges.map((r) => ({ ...r })) }
            : d
        ),
      })
    },
    [value, onChange]
  )

  return (
    <div className={cn('flex flex-col gap-3', className)}>
      <div className={cn('flex flex-col gap-0.5', readOnly && 'pointer-events-none opacity-60')}>
        {orderedIndices.map((dayOfWeek) => {
          const day = value.days.find((d) => d.dayOfWeek === dayOfWeek)
          if (!day) return null
          return (
            <WeeklyDayRow
              key={dayOfWeek}
              day={day}
              weekStartsOn={weekStartsOn}
              use24HourTime={use24HourTime}
              readOnly={readOnly}
              onChange={(next) => handleDayChange(dayOfWeek, next)}
              onCopyTo={(targets) => handleCopyTo(dayOfWeek, targets)}
            />
          )
        })}
      </div>
    </div>
  )
}
