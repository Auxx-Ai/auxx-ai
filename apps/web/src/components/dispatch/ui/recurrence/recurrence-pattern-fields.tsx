// apps/web/src/components/dispatch/ui/recurrence/recurrence-pattern-fields.tsx
'use client'

import type { NthWeekdayOrdinal, RecurrencePattern, Weekday } from '@auxx/lib/recurrence/client'
import { Input } from '@auxx/ui/components/input'
import { RadioGroup, RadioGroupItem } from '@auxx/ui/components/radio-group'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@auxx/ui/components/select'
import { ToggleGroup, ToggleGroupItem } from '@auxx/ui/components/toggle-group'
import { orderedWeekdays } from './recurrence-utils'

const WEEKDAY_ABBREVIATIONS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa']
const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const NTH_OPTIONS: { value: string; label: string; nth: NthWeekdayOrdinal }[] = [
  { value: '1', label: '1st', nth: 1 },
  { value: '2', label: '2nd', nth: 2 },
  { value: '3', label: '3rd', nth: 3 },
  { value: '4', label: '4th', nth: 4 },
  { value: '-1', label: 'last', nth: -1 },
]

type EndCondition = 'never' | 'until' | 'count'

function endConditionOf(pattern: RecurrencePattern): EndCondition {
  if (pattern.until) return 'until'
  if (pattern.count) return 'count'
  return 'never'
}

export interface RecurrencePatternFieldsProps {
  value: RecurrencePattern
  onChange: (next: RecurrencePattern) => void
  /** Org `weekStart` setting, as a date-fns index — controls weekday chip order. */
  weekStartIndex: 0 | 1 | 6
  className?: string
}

/**
 * The Custom recurrence pattern editor (06-recurring-engine.md §6): frequency/interval,
 * weekday chips (weekly), day-of-month vs nth-weekday (monthly), and the end condition —
 * expanded INLINE inside the #7 schedule popover (Option A, user-locked 2026-07-10) rather
 * than a nested dialog. Plain controlled state, matching `schedule-popover.tsx`'s own style
 * (no react-hook-form) since this is one more field group inside that same local-state form.
 */
export function RecurrencePatternFields({
  value,
  onChange,
  weekStartIndex,
  className,
}: RecurrencePatternFieldsProps) {
  const weekdayOrder = orderedWeekdays(weekStartIndex)
  const endCondition = endConditionOf(value)

  const setFrequency = (frequency: RecurrencePattern['frequency']) => {
    if (frequency === value.frequency) return
    if (frequency === 'weekly') {
      onChange({ ...value, frequency, weekdays: value.weekdays?.length ? value.weekdays : [1] })
      return
    }
    if (frequency === 'monthly') {
      onChange({ ...value, frequency, monthDay: value.monthDay ?? 1, nthWeekday: undefined })
      return
    }
    onChange({
      ...value,
      frequency,
      weekdays: undefined,
      monthDay: undefined,
      nthWeekday: undefined,
    })
  }

  const setInterval = (interval: number) => {
    onChange({ ...value, interval: Number.isFinite(interval) && interval >= 1 ? interval : 1 })
  }

  const toggleWeekday = (weekdays: string[]) => {
    onChange({ ...value, weekdays: weekdays.map(Number) as Weekday[] })
  }

  const setMonthlyMode = (mode: 'day' | 'nth') => {
    if (mode === 'day') {
      onChange({ ...value, monthDay: value.monthDay ?? 1, nthWeekday: undefined })
    } else {
      onChange({
        ...value,
        monthDay: undefined,
        nthWeekday: value.nthWeekday ?? { nth: 1, weekday: 1 },
      })
    }
  }

  const setEndCondition = (next: EndCondition) => {
    if (next === 'never') onChange({ ...value, until: undefined, count: undefined })
    else if (next === 'until')
      onChange({
        ...value,
        until: value.until ?? new Date().toISOString().slice(0, 10),
        count: undefined,
      })
    else onChange({ ...value, count: value.count ?? 1, until: undefined })
  }

  return (
    <div className={className}>
      <div className='flex flex-col gap-3 rounded-md border p-3'>
        <div className='flex items-center gap-2'>
          <span className='text-xs text-muted-foreground'>Every</span>
          <Input
            type='number'
            min={1}
            value={value.interval}
            onChange={(e) => setInterval(Number.parseInt(e.target.value, 10))}
            className='h-8 w-16'
          />
          <Select
            value={value.frequency}
            onValueChange={(v) => setFrequency(v as RecurrencePattern['frequency'])}>
            <SelectTrigger size='sm' className='flex-1'>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value='daily'>{value.interval === 1 ? 'day' : 'days'}</SelectItem>
              <SelectItem value='weekly'>{value.interval === 1 ? 'week' : 'weeks'}</SelectItem>
              <SelectItem value='monthly'>{value.interval === 1 ? 'month' : 'months'}</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {value.frequency === 'weekly' && (
          <ToggleGroup
            type='multiple'
            variant='outline'
            size='sm'
            value={(value.weekdays ?? []).map(String)}
            onValueChange={toggleWeekday}
            className='justify-start'>
            {weekdayOrder.map((day) => (
              <ToggleGroupItem
                key={day}
                value={String(day)}
                aria-label={WEEKDAY_NAMES[day]}
                className='size-8 text-xs'>
                {WEEKDAY_ABBREVIATIONS[day]}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        )}

        {value.frequency === 'monthly' && (
          <div className='flex flex-col gap-2'>
            <RadioGroup
              value={value.nthWeekday ? 'nth' : 'day'}
              onValueChange={(v) => setMonthlyMode(v as 'day' | 'nth')}
              className='gap-1.5'>
              <label className='flex items-center gap-2 text-sm'>
                <RadioGroupItem value='day' size='sm' />
                On day
                <Input
                  type='number'
                  min={1}
                  max={31}
                  disabled={Boolean(value.nthWeekday)}
                  value={value.monthDay ?? 1}
                  onChange={(e) =>
                    onChange({ ...value, monthDay: Number.parseInt(e.target.value, 10) || 1 })
                  }
                  className='h-7 w-14'
                />
              </label>
              <label className='flex items-center gap-2 text-sm'>
                <RadioGroupItem value='nth' size='sm' />
                On the
                <Select
                  value={String(value.nthWeekday?.nth ?? 1)}
                  onValueChange={(v) =>
                    onChange({
                      ...value,
                      monthDay: undefined,
                      nthWeekday: {
                        nth: Number(v) as NthWeekdayOrdinal,
                        weekday: value.nthWeekday?.weekday ?? 1,
                      },
                    })
                  }
                  disabled={!value.nthWeekday}>
                  <SelectTrigger size='sm' className='h-7 w-20'>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {NTH_OPTIONS.map((o) => (
                      <SelectItem key={o.value} value={o.value}>
                        {o.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select
                  value={String(value.nthWeekday?.weekday ?? 1)}
                  onValueChange={(v) =>
                    onChange({
                      ...value,
                      monthDay: undefined,
                      nthWeekday: {
                        nth: value.nthWeekday?.nth ?? 1,
                        weekday: Number(v) as Weekday,
                      },
                    })
                  }
                  disabled={!value.nthWeekday}>
                  <SelectTrigger size='sm' className='h-7 flex-1'>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {WEEKDAY_NAMES.map((name, day) => (
                      <SelectItem key={name} value={String(day)}>
                        {name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </label>
            </RadioGroup>
          </div>
        )}

        <div className='flex flex-col gap-2 border-t pt-2'>
          <span className='text-xs text-muted-foreground'>Ends</span>
          <RadioGroup
            value={endCondition}
            onValueChange={(v) => setEndCondition(v as EndCondition)}
            className='gap-1.5'>
            <label className='flex items-center gap-2 text-sm'>
              <RadioGroupItem value='never' size='sm' /> Never
            </label>
            <label className='flex items-center gap-2 text-sm'>
              <RadioGroupItem value='until' size='sm' /> On date
              <Input
                type='date'
                disabled={endCondition !== 'until'}
                value={value.until ?? ''}
                onChange={(e) => onChange({ ...value, until: e.target.value, count: undefined })}
                className='h-7 w-36'
              />
            </label>
            <label className='flex items-center gap-2 text-sm'>
              <RadioGroupItem value='count' size='sm' /> After
              <Input
                type='number'
                min={1}
                disabled={endCondition !== 'count'}
                value={value.count ?? 1}
                onChange={(e) =>
                  onChange({
                    ...value,
                    count: Number.parseInt(e.target.value, 10) || 1,
                    until: undefined,
                  })
                }
                className='h-7 w-16'
              />
              visits
            </label>
          </RadioGroup>
        </div>
      </div>
    </div>
  )
}
