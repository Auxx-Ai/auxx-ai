// apps/web/src/components/availability/ui/exception-list-editor.tsx
'use client'

import type { TimeRange } from '@auxx/lib/availability/client'
import { validateRanges } from '@auxx/lib/availability/client'
import { AutosizeInput } from '@auxx/ui/components/autosize-input'
import { Badge } from '@auxx/ui/components/badge'
import { Button } from '@auxx/ui/components/button'
import { EmptySection, Section } from '@auxx/ui/components/section'
import { Skeleton } from '@auxx/ui/components/skeleton'
import { toastError } from '@auxx/ui/components/toast'
import { TreeRow, TreeRowButton } from '@auxx/ui/components/tree-row'
import { cn } from '@auxx/ui/lib/utils'
import { format, parseISO } from 'date-fns'
import { Ban, CalendarClock, CalendarOff, Clock, Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { DateTimePicker } from '~/components/pickers/date-time-picker'
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

/** Stable per-group key — the underlying row ids identify a regrouped run. */
const groupKey = (group: ExceptionGroup) => group.ids.join(',')

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
 * ExceptionListEditor
 *
 * Self-fetching per subject (05-availability.md §D — webhook-endpoints idiom: immediate
 * per-row mutations, no page-level dirty state). A `Section` lists the subject's regrouped
 * exception rows as `TreeRow`s (inline-editable name, status badge, delete); clicking a row —
 * or "Add exception" — opens a second `Section` below holding the detail editor, whose
 * Cancel/Apply persist a single `addException`/`updateException` mutation.
 */
export function ExceptionListEditor({
  subject,
  use24HourTime = false,
  className,
}: ExceptionListEditorProps) {
  const utils = api.useUtils()
  const { data: groups, isLoading } = api.availability.listExceptions.useQuery({ subject })

  const invalidate = () => utils.availability.listExceptions.invalidate({ subject })

  const deleteException = api.availability.deleteException.useMutation({
    onSuccess: invalidate,
    onError: (error) =>
      toastError({ title: 'Error deleting exception', description: error.message }),
  })

  const addException = api.availability.addException.useMutation({
    onSuccess: () => {
      invalidate()
      closeEditor()
    },
    onError: (error) => toastError({ title: 'Error adding exception', description: error.message }),
  })

  const updateException = api.availability.updateException.useMutation({
    onSuccess: () => {
      invalidate()
      closeEditor()
    },
    onError: (error) =>
      toastError({ title: 'Error updating exception', description: error.message }),
  })

  // Editor target: `creating` for a new exception, `editingKey` for an existing group. Both
  // false/null → the detail Section is hidden.
  const [creating, setCreating] = useState(false)
  const [editingKey, setEditingKey] = useState<string | null>(null)

  // Detail-editor buffer — nothing persists until Apply.
  const [dateFrom, setDateFrom] = useState<Date | undefined>(undefined)
  const [dateTo, setDateTo] = useState<Date | undefined>(undefined)
  const [label, setLabel] = useState('')
  const [isAvailable, setIsAvailable] = useState(false)
  const [ranges, setRanges] = useState<TimeRangeValue[]>([])

  function seed(group: ExceptionGroup | null) {
    setDateFrom(group ? parseISO(group.dateFrom) : undefined)
    setDateTo(group && group.dateTo !== group.dateFrom ? parseISO(group.dateTo) : undefined)
    setLabel(group?.label ?? '')
    setIsAvailable(group?.isAvailable ?? false)
    setRanges(group ? group.ranges.map((r) => ({ start: r.start, end: r.end })) : [])
  }

  function openCreate() {
    seed(null)
    setEditingKey(null)
    setCreating(true)
  }

  function openEdit(group: ExceptionGroup) {
    seed(group)
    setCreating(false)
    setEditingKey(groupKey(group))
  }

  function closeEditor() {
    setCreating(false)
    setEditingKey(null)
    seed(null)
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

  const rangesComplete = ranges.length > 0 && ranges.every((r) => r.start != null && r.end != null)
  const rangeErrors = rangesComplete ? validateRanges(ranges as TimeRange[]) : []
  const dateOrderValid = !dateFrom || !dateTo || dateTo >= dateFrom
  const canApply =
    !!dateFrom && dateOrderValid && (!isAvailable || (rangesComplete && rangeErrors.length === 0))

  const editingGroup = editingKey ? (groups?.find((g) => groupKey(g) === editingKey) ?? null) : null
  const editorOpen = creating || !!editingKey
  const applying = addException.isPending || updateException.isPending

  function handleApply() {
    if (!dateFrom || !canApply) return
    const payload = {
      subject,
      dateFrom: format(dateFrom, 'yyyy-MM-dd'),
      dateTo: dateTo ? format(dateTo, 'yyyy-MM-dd') : undefined,
      label: label.trim() || undefined,
      isAvailable,
      ranges: isAvailable
        ? (ranges.filter((r) => r.start != null && r.end != null) as TimeRange[])
        : undefined,
    }
    if (editingGroup) {
      updateException.mutate({ ...payload, ids: editingGroup.ids })
    } else {
      addException.mutate(payload)
    }
  }

  const empty = !isLoading && !creating && (groups?.length ?? 0) === 0

  return (
    <div className={cn('flex flex-col', className)}>
      {/* Exception list */}
      <Section
        title='Exceptions'
        icon={<CalendarOff className='size-4' />}
        collapsible={false}
        actions={
          !creating && (
            <Button variant='ghost' size='xs' onClick={openCreate}>
              <Plus />
              Add exception
            </Button>
          )
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
            {groups?.map((group) => {
              const key = groupKey(group)
              const selected = editingKey === key
              const titleValue = selected ? label : (group.label ?? '')
              return (
                <TreeRow
                  key={key}
                  icon={
                    group.isAvailable ? <Clock className='size-4' /> : <Ban className='size-4' />
                  }
                  isOpen={selected}
                  onToggleOpen={() => (selected ? closeEditor() : openEdit(group))}
                  rowClassName={
                    selected
                      ? 'bg-primary-100 hover:bg-primary-150'
                      : 'bg-primary-50 hover:bg-primary-100'
                  }
                  title={
                    <AutosizeInput
                      value={titleValue}
                      onChange={(e) => {
                        if (!selected) openEdit(group)
                        setLabel(e.target.value)
                      }}
                      onFocus={() => {
                        if (!selected) openEdit(group)
                      }}
                      onClick={(e) => e.stopPropagation()}
                      placeholder='Add a name'
                      inputClassName='bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground'
                      minWidth={60}
                    />
                  }
                  secondaryFill
                  secondary={
                    <span className='inline-flex items-center gap-2 text-muted-foreground'>
                      <span className='truncate'>
                        {formatExceptionDateRange(group.dateFrom, group.dateTo)}
                      </span>
                      <Badge variant={group.isAvailable ? 'outline' : 'destructive'} size='xs'>
                        {group.isAvailable ? 'Special hours' : 'Closed'}
                      </Badge>
                    </span>
                  }
                  actions={
                    <TreeRowButton
                      variant='destructive'
                      tooltipText='Delete exception'
                      disabled={
                        deleteException.isPending && deleteException.variables?.ids === group.ids
                      }
                      onClick={() => deleteException.mutate({ subject, ids: group.ids })}>
                      <Trash2 />
                    </TreeRowButton>
                  }
                />
              )
            })}
          </div>
        )}
      </Section>

      {/* Detail editor — the selected (or new) exception */}
      {editorOpen && (
        <Section
          title={
            editingGroup
              ? `Exception · ${formatExceptionDateRange(editingGroup.dateFrom, editingGroup.dateTo)}`
              : 'New exception'
          }
          icon={<CalendarClock className='size-4' />}
          collapsible={false}
          actions={
            <div className='flex items-center gap-1'>
              <Button variant='ghost' size='xs' onClick={closeEditor}>
                Cancel
              </Button>
              <Button
                variant='outline'
                size='xs'
                disabled={!canApply}
                loading={applying}
                onClick={handleApply}>
                Apply
              </Button>
            </div>
          }>
          <div className='flex flex-col gap-3'>
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
              <p className='text-xs text-destructive'>
                End date must be on or after the start date.
              </p>
            )}

            <button type='button' className='w-fit' onClick={() => handleModeChange(!isAvailable)}>
              <Badge
                variant={isAvailable ? 'default' : 'destructive'}
                size='sm'
                className='cursor-pointer'>
                {isAvailable ? 'Special hours' : 'Closed all day'}
              </Badge>
            </button>

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
          </div>
        </Section>
      )}
    </div>
  )
}
