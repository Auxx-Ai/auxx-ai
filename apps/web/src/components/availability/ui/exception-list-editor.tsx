// apps/web/src/components/availability/ui/exception-list-editor.tsx
'use client'

import type { TimeRange } from '@auxx/lib/availability/client'
import { validateRanges } from '@auxx/lib/availability/client'
import { Badge } from '@auxx/ui/components/badge'
import { Button } from '@auxx/ui/components/button'
import { Input } from '@auxx/ui/components/input'
import { SegmentedControl } from '@auxx/ui/components/segmented-control'
import { Skeleton } from '@auxx/ui/components/skeleton'
import { toastError } from '@auxx/ui/components/toast'
import { cn } from '@auxx/ui/lib/utils'
import { format, parseISO } from 'date-fns'
import { Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { DateTimePicker } from '~/components/pickers/date-time-picker'
import {
  minutesToLabel,
  TimeRangeInput,
  type TimeRangeValue,
} from '~/components/pickers/time-range-input'
import { api } from '~/trpc/react'

/**
 * Editor-facing subject input — mirrors the `availability` router's `subjectInputSchema`
 * (never carries `organizationId`; the server injects it). `worker`/`widget` variants are
 * typed here so slice-2 (Workers dialog) and the widget pass can reuse this component
 * without a prop-shape change.
 */
export type AvailabilityEditorSubject =
  | { type: 'organization' }
  | { type: 'worker'; userId: string }
  | { type: 'widget'; widgetId: string }

export interface ExceptionListEditorProps {
  subject: AvailabilityEditorSubject
  /** 24-hour range pills instead of 12-hour AM/PM (05-availability.md §A.1b) */
  use24HourTime?: boolean
  className?: string
}

/** 'Dec 25, 2026' for a single date, 'Dec 25 – 26, 2026' for a contiguous range. */
function formatExceptionDateRange(dateFrom: string, dateTo: string): string {
  const from = parseISO(dateFrom)
  const to = parseISO(dateTo)
  if (dateFrom === dateTo) return format(from, 'MMM d, yyyy')
  const sameYear = from.getFullYear() === to.getFullYear()
  const sameMonth = sameYear && from.getMonth() === to.getMonth()
  if (sameMonth) return `${format(from, 'MMM d')} – ${format(to, 'd, yyyy')}`
  if (sameYear) return `${format(from, 'MMM d')} – ${format(to, 'MMM d, yyyy')}`
  return `${format(from, 'MMM d, yyyy')} – ${format(to, 'MMM d, yyyy')}`
}

/** Pill-level invalid flag — same idiom as `WeeklyHoursEditor`'s `isRangePillInvalid`. */
function isExceptionRangeInvalid(
  range: TimeRangeValue,
  index: number,
  ranges: TimeRangeValue[]
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

/** One exception group row: date(-range), label, badge, range pills, delete. */
function ExceptionRow({
  group,
  use24HourTime,
  onDelete,
  deleting,
}: {
  group: {
    ids: string[]
    dateFrom: string
    dateTo: string
    label: string | null
    isAvailable: boolean
    ranges: TimeRange[]
  }
  use24HourTime: boolean
  onDelete: () => void
  deleting: boolean
}) {
  return (
    <div className='flex items-center gap-3 rounded-lg border px-3 py-2'>
      <div className='min-w-0 flex-1'>
        <div className='flex flex-wrap items-center gap-2'>
          <span className='text-sm font-medium'>
            {formatExceptionDateRange(group.dateFrom, group.dateTo)}
          </span>
          <Badge variant={group.isAvailable ? 'default' : 'destructive'} size='sm'>
            {group.isAvailable ? 'Special hours' : 'Closed'}
          </Badge>
          {group.label && (
            <span className='truncate text-sm text-muted-foreground'>{group.label}</span>
          )}
        </div>
        {group.isAvailable && group.ranges.length > 0 && (
          <div className='mt-1 flex flex-wrap gap-x-2 gap-y-0.5'>
            {group.ranges.map((range) => (
              <span key={`${range.start}-${range.end}`} className='text-xs text-muted-foreground'>
                {minutesToLabel(range.start, use24HourTime)} –{' '}
                {minutesToLabel(range.end, use24HourTime)}
              </span>
            ))}
          </div>
        )}
      </div>
      <Button
        type='button'
        variant='ghost'
        size='icon-sm'
        aria-label='Delete exception'
        loading={deleting}
        onClick={onDelete}>
        <Trash2 className='size-3.5 text-muted-foreground' />
      </Button>
    </div>
  )
}

/**
 * ExceptionListEditor
 *
 * Self-fetching per subject (05-availability.md §D — webhook-endpoints idiom: immediate
 * per-row mutations, no page-level dirty state). Lists the subject's regrouped exception
 * rows and adds new ones via an inline dashed editor card.
 */
export function ExceptionListEditor({
  subject,
  use24HourTime = false,
  className,
}: ExceptionListEditorProps) {
  const utils = api.useUtils()
  const { data: groups, isLoading } = api.availability.listExceptions.useQuery({ subject })

  const deleteException = api.availability.deleteException.useMutation({
    onSuccess: () => utils.availability.listExceptions.invalidate({ subject }),
    onError: (error) =>
      toastError({ title: 'Error deleting exception', description: error.message }),
  })

  const addException = api.availability.addException.useMutation({
    onSuccess: () => {
      utils.availability.listExceptions.invalidate({ subject })
      resetForm()
      setAdding(false)
    },
    onError: (error) => toastError({ title: 'Error adding exception', description: error.message }),
  })

  const [adding, setAdding] = useState(false)
  const [dateFrom, setDateFrom] = useState<Date | undefined>(undefined)
  const [dateTo, setDateTo] = useState<Date | undefined>(undefined)
  const [label, setLabel] = useState('')
  const [isAvailable, setIsAvailable] = useState(false)
  const [ranges, setRanges] = useState<TimeRangeValue[]>([])

  function resetForm() {
    setDateFrom(undefined)
    setDateTo(undefined)
    setLabel('')
    setIsAvailable(false)
    setRanges([])
  }

  function handleModeChange(nextIsAvailable: boolean) {
    setIsAvailable(nextIsAvailable)
    if (nextIsAvailable && ranges.length === 0) {
      setRanges([{ start: null, end: null }])
    }
  }

  function handleRangeChange(index: number, next: TimeRangeValue) {
    setRanges((prev) => prev.map((r, i) => (i === index ? next : r)))
  }

  function handleAddRange() {
    setRanges((prev) => [...prev, { start: null, end: null }])
  }

  function handleRemoveRange(index: number) {
    setRanges((prev) => prev.filter((_, i) => i !== index))
  }

  function handleCancel() {
    resetForm()
    setAdding(false)
  }

  const rangesComplete = ranges.length > 0 && ranges.every((r) => r.start != null && r.end != null)
  const rangeErrors = rangesComplete ? validateRanges(ranges as TimeRange[]) : []
  const dateOrderValid = !dateFrom || !dateTo || dateTo >= dateFrom
  const canAdd =
    !!dateFrom && dateOrderValid && (!isAvailable || (rangesComplete && rangeErrors.length === 0))

  function handleAdd() {
    if (!dateFrom || !canAdd) return
    addException.mutate({
      subject,
      dateFrom: format(dateFrom, 'yyyy-MM-dd'),
      dateTo: dateTo ? format(dateTo, 'yyyy-MM-dd') : undefined,
      label: label.trim() || undefined,
      isAvailable,
      ranges: isAvailable
        ? (ranges.filter((r) => r.start != null && r.end != null) as TimeRange[])
        : undefined,
    })
  }

  const empty = !isLoading && !adding && (groups?.length ?? 0) === 0

  return (
    <div className={cn('flex flex-col gap-3', className)}>
      <div className='flex items-center justify-end'>
        {!adding && (
          <Button type='button' variant='outline' size='sm' onClick={() => setAdding(true)}>
            <Plus /> Add exception
          </Button>
        )}
      </div>

      {adding && (
        <div className='flex flex-col gap-3 rounded-lg border border-dashed p-3'>
          <div className='flex flex-wrap items-center gap-2'>
            <DateTimePicker
              mode='date'
              noConfirm
              value={dateFrom}
              onChange={setDateFrom}
              placeholder='From date'
              triggerProps={{ className: 'w-[160px]' }}
            />
            <span className='text-sm text-muted-foreground'>to</span>
            <DateTimePicker
              mode='date'
              noConfirm
              value={dateTo}
              onChange={setDateTo}
              onClear={() => setDateTo(undefined)}
              placeholder='To date (optional)'
              triggerProps={{ className: 'w-[160px]' }}
            />
          </div>
          {!dateOrderValid && (
            <p className='text-xs text-destructive'>End date must be on or after the start date.</p>
          )}
          <Input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder='e.g. Public holiday'
          />
          <SegmentedControl
            mode='toggle'
            toggleMode='single'
            isPill
            value={[isAvailable ? 1 : 0]}
            onChange={(indices) => handleModeChange(indices[0] === 1)}
            className='w-fit'>
            <Button type='button' variant='outline' size='sm'>
              Closed all day
            </Button>
            <Button type='button' variant='outline' size='sm'>
              Special hours
            </Button>
          </SegmentedControl>
          {isAvailable && (
            <div className='flex flex-wrap items-center gap-1.5'>
              {ranges.map((range, index) => (
                <TimeRangeInput
                  key={index}
                  value={range}
                  onChange={(next) => handleRangeChange(index, next)}
                  onRemove={() => handleRemoveRange(index)}
                  use24HourTime={use24HourTime}
                  invalid={isExceptionRangeInvalid(range, index, ranges)}
                />
              ))}
              <Button
                type='button'
                variant='ghost'
                size='icon-sm'
                className='rounded-lg border border-dashed hover:border-primary-300 hover:bg-primary-100'
                aria-label='Add time range'
                onClick={handleAddRange}>
                <Plus className='size-3.5 text-muted-foreground' />
              </Button>
            </div>
          )}
          <div className='flex items-center justify-end gap-2 pt-1'>
            <Button type='button' variant='outline' size='sm' onClick={handleCancel}>
              Cancel
            </Button>
            <Button
              type='button'
              size='sm'
              disabled={!canAdd}
              loading={addException.isPending}
              onClick={handleAdd}>
              Add
            </Button>
          </div>
        </div>
      )}

      {isLoading ? (
        <div className='flex flex-col gap-2'>
          <Skeleton className='h-12 w-full rounded-lg' />
          <Skeleton className='h-12 w-full rounded-lg' />
        </div>
      ) : empty ? (
        <p className='text-sm text-muted-foreground'>No exceptions yet.</p>
      ) : (
        <div className='flex flex-col gap-2'>
          {groups?.map((group) => (
            <ExceptionRow
              key={group.ids.join(',')}
              group={group}
              use24HourTime={use24HourTime}
              deleting={deleteException.isPending && deleteException.variables?.ids === group.ids}
              onDelete={() => deleteException.mutate({ subject, ids: group.ids })}
            />
          ))}
        </div>
      )}
    </div>
  )
}
