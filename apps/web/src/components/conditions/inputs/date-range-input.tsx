// apps/web/src/components/conditions/inputs/date-range-input.tsx

'use client'

import type { DateRangeValue } from '@auxx/lib/conditions/client'
import { fromCalendarDayIso, toCalendarDayIso } from '@auxx/lib/field-values/client'
import { DateRangePicker } from '@auxx/ui/components/date-range-picker'
import { addDays, format, startOfDay } from 'date-fns'
import { PickerTrigger, type PickerTriggerOptions } from '~/components/ui/picker-trigger'

interface DateRangeInputProps {
  /** A `between` value: `{ from, to }`, `to` exclusive. */
  value: unknown
  onChange: (value: DateRangeValue | undefined) => void
  /** DATE stores calendar days as UTC midnight; DATETIME stores the viewer's local instants. */
  fieldType: string
  disabled?: boolean
  placeholder?: string
  triggerProps?: PickerTriggerOptions
  open?: boolean
  onOpenChange?: (open: boolean) => void
}

/** Read a stored end back as a local Date for the picker. */
function toLocal(iso: string, isDay: boolean): Date | undefined {
  if (isDay) return fromCalendarDayIso(iso)
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? undefined : date
}

/** Picker value for a stored range; the exclusive `to` shows as the last included day. */
function toPickerRange(value: unknown, isDay: boolean): { from: Date; to: Date } | undefined {
  const range = value as DateRangeValue | undefined
  if (!range?.from || !range.to) return undefined
  const from = toLocal(range.from, isDay)
  const to = toLocal(range.to, isDay)
  if (!from || !to) return undefined
  return { from, to: addDays(to, -1) }
}

/** Human label for a stored range, including one-sided ranges. */
export function formatDateRangeValue(value: unknown, isDay: boolean): string {
  const range = value as DateRangeValue | undefined
  const from = range?.from ? toLocal(range.from, isDay) : undefined
  const to = range?.to ? toLocal(range.to, isDay) : undefined
  const fmt = (d: Date) => format(d, 'MMM d, yyyy')
  if (from && to) return `${fmt(from)} – ${fmt(addDays(to, -1))}`
  if (from) return `from ${fmt(from)}`
  if (to) return `before ${fmt(to)}`
  return ''
}

/** From/To picker for the `between` operator. Writes whole days, `to` as the next day's start. */
export function DateRangeInput({
  value,
  onChange,
  fieldType,
  disabled,
  placeholder = 'Select dates',
  triggerProps,
  open,
  onOpenChange,
}: DateRangeInputProps) {
  const isDay = fieldType === 'DATE'
  const toStored = (d: Date) => (isDay ? toCalendarDayIso(d) : startOfDay(d).toISOString())

  return (
    <DateRangePicker
      value={toPickerRange(value, isDay)}
      onChange={(range) =>
        onChange({ from: toStored(range.from), to: toStored(addDays(startOfDay(range.to), 1)) })
      }
      open={open}
      onOpenChange={onOpenChange}
      trigger={({ open: isOpen, hasValue }) => (
        <PickerTrigger
          open={isOpen}
          disabled={disabled}
          hasValue={hasValue}
          placeholder={placeholder}
          variant={triggerProps?.variant}
          size={triggerProps?.size}
          className={triggerProps?.className}
          hideIcon={triggerProps?.hideIcon}
          showClear={triggerProps?.showClear}
          onClear={() => onChange(undefined)}>
          <span className='truncate'>{formatDateRangeValue(value, isDay)}</span>
        </PickerTrigger>
      )}
    />
  )
}
