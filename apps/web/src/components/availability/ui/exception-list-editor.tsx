// apps/web/src/components/availability/ui/exception-list-editor.tsx
'use client'

import type { TimeRange } from '@auxx/lib/availability/client'
import { validateRanges } from '@auxx/lib/availability/client'
import { AutosizeInput } from '@auxx/ui/components/autosize-input'
import { Badge } from '@auxx/ui/components/badge'
import { Button } from '@auxx/ui/components/button'
import { type DateRange, DateRangePicker } from '@auxx/ui/components/date-range-picker'
import { EmptySection, Section } from '@auxx/ui/components/section'
import { Skeleton } from '@auxx/ui/components/skeleton'
import { toastError } from '@auxx/ui/components/toast'
import { TreeRow, TreeRowButton } from '@auxx/ui/components/tree-row'
import { cn } from '@auxx/ui/lib/utils'
import { format, parseISO } from 'date-fns'
import { Ban, CalendarOff, Clock, Plus, Trash2 } from 'lucide-react'
import { type MouseEvent, useState } from 'react'
import {
  availabilitySubjectKey,
  useAvailabilityCacheStore,
} from '~/components/dispatch/stores/availability-cache-store'
import { TimeRangeInput, type TimeRangeValue } from '~/components/pickers/time-range-input'
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

/** One exception group as it lives in the editor's list. */
interface ExceptionGroup {
  ids: string[]
  dateFrom: string
  dateTo: string
  label: string | null
  isAvailable: boolean
  ranges: TimeRange[]
}

/** Default 9:00 AM–5:00 PM range seeded when a row flips to special hours (minutes). */
const DEFAULT_RANGE: TimeRange = { start: 9 * 60, end: 17 * 60 }

const stop = (e: MouseEvent) => e.stopPropagation()

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

/**
 * ExceptionRow
 *
 * One inline-editable exception row (05-availability.md §D — no page-level dirty state;
 * every edit is an immediate `updateException`). The date range opens a `DateRangePicker`,
 * the status badge toggles Closed ⇄ Special hours, and special-hours rows expand to reveal
 * their time-range pills. Each write re-materializes the group's rows (new ids), so the row
 * is keyed by `dateFrom` upstream to survive the refetch without remounting.
 */
function ExceptionRow({
  subject,
  group,
  use24HourTime,
  invalidate,
}: {
  subject: AvailabilityEditorSubject
  group: ExceptionGroup
  use24HourTime: boolean
  invalidate: () => void
}) {
  const [name, setName] = useState(group.label ?? '')
  const [ranges, setRanges] = useState<TimeRangeValue[]>(() =>
    group.ranges.map((r) => ({ start: r.start, end: r.end }))
  )
  const [open, setOpen] = useState(false)

  const update = api.availability.updateException.useMutation({
    onSuccess: invalidate,
    onError: (error) =>
      toastError({ title: 'Error updating exception', description: error.message }),
  })
  const remove = api.availability.deleteException.useMutation({
    onSuccess: invalidate,
    onError: (error) =>
      toastError({ title: 'Error deleting exception', description: error.message }),
  })

  /** Build a full `updateException` payload from the group, applying `overrides`. */
  function persist(overrides: {
    dateFrom?: string
    dateTo?: string
    label?: string
    isAvailable?: boolean
    ranges?: TimeRangeValue[]
  }) {
    const isAvailable = overrides.isAvailable ?? group.isAvailable
    const nextRanges = overrides.ranges ?? ranges
    update.mutate({
      subject,
      ids: group.ids,
      dateFrom: overrides.dateFrom ?? group.dateFrom,
      dateTo: overrides.dateTo ?? group.dateTo,
      label: (overrides.label ?? name).trim() || undefined,
      isAvailable,
      ranges: isAvailable
        ? (nextRanges.filter((r) => r.start != null && r.end != null) as TimeRange[])
        : undefined,
    })
  }

  function handleNameBlur() {
    if ((name.trim() || '') !== (group.label ?? '')) persist({ label: name })
  }

  function handleDateChange(range: DateRange) {
    persist({
      dateFrom: format(range.from, 'yyyy-MM-dd'),
      dateTo: format(range.to, 'yyyy-MM-dd'),
    })
  }

  function handleToggleMode() {
    if (group.isAvailable) {
      persist({ isAvailable: false })
      setOpen(false)
    } else {
      // Special hours require ≥1 valid range (exceptions.ts) — seed a default and expand.
      const seeded = [{ ...DEFAULT_RANGE }]
      setRanges(seeded)
      setOpen(true)
      persist({ isAvailable: true, ranges: seeded })
    }
  }

  /** Persist only when every range is complete + valid; partial edits stay local. */
  function commitRanges(next: TimeRangeValue[]) {
    setRanges(next)
    const complete = next.length > 0 && next.every((r) => r.start != null && r.end != null)
    if (complete && validateRanges(next as TimeRange[]).length === 0) {
      persist({ isAvailable: true, ranges: next })
    }
  }

  const dateValue = { from: parseISO(group.dateFrom), to: parseISO(group.dateTo) }

  return (
    <TreeRow
      icon={group.isAvailable ? <Clock className='size-4' /> : <Ban className='size-4' />}
      expandable={group.isAvailable}
      isOpen={open}
      onToggleOpen={group.isAvailable ? () => setOpen((o) => !o) : undefined}
      rowClassName='bg-primary-50 hover:bg-primary-100'
      title={
        <AutosizeInput
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={handleNameBlur}
          onClick={stop}
          placeholder='Add a name'
          inputClassName='bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground'
          minWidth={60}
        />
      }
      secondaryFill
      secondary={
        <span className='inline-flex items-center gap-2'>
          <span onClick={stop}>
            <DateRangePicker
              value={dateValue}
              onChange={handleDateChange}
              showPresets={false}
              showShortLabel
              trigger={({ label }) => (
                <button
                  type='button'
                  className='truncate text-muted-foreground text-sm hover:text-foreground hover:underline'>
                  {label}
                </button>
              )}
            />
          </span>
          <button
            type='button'
            onClick={(e) => {
              stop(e)
              handleToggleMode()
            }}>
            <Badge
              variant={group.isAvailable ? 'outline' : 'destructive'}
              size='xs'
              className='cursor-pointer'>
              {group.isAvailable ? 'Special hours' : 'Closed'}
            </Badge>
          </button>
        </span>
      }
      actions={
        <TreeRowButton
          variant='destructive'
          tooltipText='Delete exception'
          disabled={remove.isPending}
          onClick={() => remove.mutate({ subject, ids: group.ids })}>
          <Trash2 />
        </TreeRowButton>
      }>
      {group.isAvailable && (
        <div className='flex flex-wrap items-center gap-1.5 py-2 pl-8'>
          {ranges.map((range, index) => (
            <TimeRangeInput
              key={index}
              value={range}
              onChange={(next) => commitRanges(ranges.map((r, i) => (i === index ? next : r)))}
              onRemove={
                ranges.length > 1
                  ? () => commitRanges(ranges.filter((_, i) => i !== index))
                  : undefined
              }
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
            onClick={() => setRanges((prev) => [...prev, { start: null, end: null }])}>
            <Plus className='size-3.5 text-muted-foreground' />
          </Button>
        </div>
      )}
    </TreeRow>
  )
}

/**
 * ExceptionListEditor
 *
 * Self-fetching per subject (05-availability.md §D — webhook-endpoints idiom: immediate
 * per-row mutations, no page-level dirty state). A `Section` lists the subject's regrouped
 * exception rows as inline-editable `ExceptionRow`s. "Add exception" inserts a default
 * Closed-today row that's edited in place — clicking the date opens the range picker, the
 * badge flips Closed ⇄ Special hours, and special-hours rows expand to show their time pills.
 */
export function ExceptionListEditor({
  subject,
  use24HourTime = false,
  className,
}: ExceptionListEditorProps) {
  const utils = api.useUtils()
  const { data: groups, isLoading } = api.availability.listExceptions.useQuery({ subject })

  const invalidate = () => {
    utils.availability.listExceptions.invalidate({ subject })
    // Exceptions (holidays/closures) refine the board's off-hours shading — drop the cache so the
    // affected subject re-fetches. Org exceptions cascade to workers (inherited), so clear all.
    if (subject.type === 'organization') useAvailabilityCacheStore.getState().invalidateAll()
    else if (subject.type === 'worker')
      useAvailabilityCacheStore.getState().invalidate(availabilitySubjectKey(subject))
  }

  const addException = api.availability.addException.useMutation({
    onSuccess: invalidate,
    onError: (error) => toastError({ title: 'Error adding exception', description: error.message }),
  })

  function handleAdd() {
    const today = format(new Date(), 'yyyy-MM-dd')
    addException.mutate({ subject, dateFrom: today, dateTo: today, isAvailable: false })
  }

  const empty = !isLoading && (groups?.length ?? 0) === 0

  return (
    <div className={cn('flex flex-col', className)}>
      <Section
        title='Exceptions'
        icon={<CalendarOff className='size-4' />}
        collapsible={false}
        actions={
          <Button variant='ghost' size='xs' loading={addException.isPending} onClick={handleAdd}>
            <Plus />
            Add exception
          </Button>
        }>
        {isLoading ? (
          <div className='flex flex-col gap-2'>
            <Skeleton className='h-8 w-full rounded-md' />
            <Skeleton className='h-8 w-full rounded-md' />
          </div>
        ) : empty ? (
          <EmptySection
            icon={<CalendarOff className='size-5' />}
            title='No exceptions yet'
            description='Add a holiday or one-off change to the schedule.'
          />
        ) : (
          <div className='flex flex-col gap-0.5'>
            {groups?.map((group) => (
              <ExceptionRow
                key={group.dateFrom}
                subject={subject}
                group={group}
                use24HourTime={use24HourTime}
                invalidate={invalidate}
              />
            ))}
          </div>
        )}
      </Section>
    </div>
  )
}
