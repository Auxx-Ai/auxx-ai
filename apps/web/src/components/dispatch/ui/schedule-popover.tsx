// apps/web/src/components/dispatch/ui/schedule-popover.tsx

'use client'

import { detectTimezone } from '@auxx/config/client'
import { weekStartToIndex } from '@auxx/lib/availability/client'
import {
  describeRecurrence,
  type RecurrencePattern,
  recurrencePatternSchema,
} from '@auxx/lib/recurrence/client'
import { getActorRawId, toActorId } from '@auxx/types/actor'
import { Avatar, AvatarFallback, AvatarImage } from '@auxx/ui/components/avatar'
import { Button } from '@auxx/ui/components/button'
import {
  CommandBreadcrumb,
  CommandNavigation,
  useCommandNavigation,
} from '@auxx/ui/components/command'
import { Popover, PopoverContent, PopoverTrigger } from '@auxx/ui/components/popover'
import { RadioGroup, RadioGroupItem } from '@auxx/ui/components/radio-group'
import { ScrollArea } from '@auxx/ui/components/scroll-area'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@auxx/ui/components/select'
import { toastError } from '@auxx/ui/components/toast'
import { cn } from '@auxx/ui/lib/utils'
import { addMinutes, differenceInMinutes, format } from 'date-fns'
import { AlertTriangle, Calendar, Clock, User } from 'lucide-react'
import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react'
import { getInitials } from '~/components/groups/utils/group-utils'
import { ActorPickerContent } from '~/components/pickers/actor-picker/actor-picker-content'
import { DateTimePickerContent } from '~/components/pickers/date-time-picker'
import { cloneTimeToDate } from '~/components/pickers/date-time-picker/utils'
import type { RecordId } from '~/components/resources'
import { useActors, useAvailableActors } from '~/components/resources/hooks/use-actor'
import { useSettings } from '~/hooks/use-settings'
import { api } from '~/trpc/react'
import {
  RecurrenceEndFields,
  RecurrencePatternFields,
} from './recurrence/recurrence-pattern-fields'
import {
  buildPresetPattern,
  classifyRecurrencePreset as classifyPreset,
  defaultCustomPattern,
  type RecurrencePreset,
  scalarSetting,
} from './recurrence/recurrence-utils'

const DURATION_OPTIONS = [
  { value: '30', label: '30 min', minutes: 30 },
  { value: '60', label: '1 hour', minutes: 60 },
  { value: '90', label: '90 min', minutes: 90 },
  { value: '120', label: '2 hours', minutes: 120 },
  { value: '180', label: '3 hours', minutes: 180 },
  { value: '240', label: '4 hours', minutes: 240 },
  { value: 'custom', label: 'Custom', minutes: null },
] as const

type DurationValue = (typeof DURATION_OPTIONS)[number]['value']

/** A same-day visit to check overlaps against — the board passes its in-memory set. */
export interface ExistingVisitForOverlap {
  id: string
  label: string
  startTime: Date
  endTime: Date
  assigneeUserId: string | null
}

export interface SchedulePopoverContentProps {
  visitId: string
  initialStartTime?: Date | null
  initialEndTime?: Date | null
  initialAssigneeUserId?: string | null
  existingVisits?: ExistingVisitForOverlap[]
  onScheduled?: () => void
  onUnscheduled?: () => void
  className?: string
  /**
   * The work order this visit belongs to (06-recurring-engine.md §6) — presence enables the
   * Repeats row (`dispatch.getRecurrence`/`setRecurrence`). Board chip popovers omit this
   * (Board stays unchanged, §6 "no new chrome") so they never render Repeats.
   */
  workOrderRecordId?: RecordId
  /**
   * The target visit's own `recurrenceRuleId` (from `dispatch.listVisits`/`getBoard`) — when
   * set, and the Repeats selection hasn't been touched this session, a This visit / This and
   * following / All visits chooser gates time/duration/assignee edits (§4.3/§6). Cadence edits
   * (Repeats) never go through the chooser — they always anchor at the picked start date.
   */
  recurrenceRuleId?: string | null
}

/** Drill pages pushed onto the popover's CommandNavigation stack. */
type ScheduleNavItem = { id: 'assignee' | 'datetime' | 'endtime'; label: string }

/**
 * The M2 schedule/assign control (07 §D.4, 04-ui #7): the single non-board surface that
 * writes `dispatch.scheduleVisit`. Composes `ActorPickerContent`/`DateTimePickerContent`
 * INSIDE this one popover (the `task-form.tsx` mention-picker precedent) — never nests a
 * second full picker popover; picking an assignee, date/time, or custom end time pushes
 * a drill page onto the shared `CommandNavigation` stack (breadcrumb header, like the
 * tag/file pickers) instead of nesting another popover.
 */
export function SchedulePopoverContent(props: SchedulePopoverContentProps) {
  return (
    <CommandNavigation<ScheduleNavItem>>
      <ScheduleContent {...props} />
    </CommandNavigation>
  )
}

function ScheduleContent({
  visitId,
  initialStartTime,
  initialEndTime,
  initialAssigneeUserId,
  existingVisits = [],
  onScheduled,
  onUnscheduled,
  className,
  workOrderRecordId,
  recurrenceRuleId,
}: SchedulePopoverContentProps) {
  const { current, push, pop } = useCommandNavigation<ScheduleNavItem>()
  const [assigneeUserId, setAssigneeUserId] = useState<string | null>(initialAssigneeUserId ?? null)
  const [startTime, setStartTime] = useState<Date | undefined>(initialStartTime ?? undefined)
  const initialMinutes =
    initialStartTime && initialEndTime ? differenceInMinutes(initialEndTime, initialStartTime) : 60
  const initialDurationOption =
    DURATION_OPTIONS.find((o) => o.minutes === initialMinutes)?.value ?? 'custom'
  const [duration, setDuration] = useState<DurationValue>(initialDurationOption)
  const [customEndTime, setCustomEndTime] = useState<Date | undefined>(initialEndTime ?? undefined)

  // ── Repeats (06-recurring-engine.md §6) ──────────────────────────────────────────────
  const utils = api.useUtils()
  const { getSetting } = useSettings({ scope: 'GENERAL' })
  const weekStart = (scalarSetting(getSetting('organization.weekStart')) ?? 'monday') as
    | 'monday'
    | 'sunday'
    | 'saturday'
  const weekStartIndex = weekStartToIndex(weekStart)

  const recurrenceQuery = api.dispatch.getRecurrence.useQuery(
    { workOrderRecordId: workOrderRecordId as RecordId },
    { enabled: Boolean(workOrderRecordId) }
  )
  const hasExistingRule = Boolean(recurrenceQuery.data)

  const [repeatMode, setRepeatMode] = useState<RecurrencePreset>('none')
  const [customPattern, setCustomPattern] = useState<RecurrencePattern>(
    defaultCustomPattern(initialStartTime ?? undefined)
  )
  // Ends (until/count) live independently of the preset/custom pattern now — the schedule
  // popover edits them via one `RecurrenceEndFields` regardless of Repeats mode.
  const [ends, setEnds] = useState<{ until?: string; count?: number }>({})
  const [repeatsTouched, setRepeatsTouched] = useState(false)
  const [chooserScope, setChooserScope] = useState<'this' | 'following' | 'all'>('this')
  const initializedFromRuleRef = useRef(false)

  // Initialize Repeats state from the existing rule ONCE — later realtime refetches of
  // `getRecurrence` (another tab editing the same series) must not clobber an in-progress edit.
  useEffect(() => {
    if (initializedFromRuleRef.current) return
    if (recurrenceQuery.isLoading) return
    initializedFromRuleRef.current = true
    if (!recurrenceQuery.data) return
    const pattern = recurrenceQuery.data.pattern as unknown as RecurrencePattern
    const preset = classifyPreset(pattern)
    setRepeatMode(preset)
    setEnds({ until: pattern.until, count: pattern.count })
    if (preset === 'custom') setCustomPattern({ ...pattern, until: undefined, count: undefined })
  }, [recurrenceQuery.data, recurrenceQuery.isLoading])

  const effectivePattern = useMemo((): RecurrencePattern | null => {
    if (repeatMode === 'none') return null
    if (repeatMode === 'custom') return { ...customPattern, until: ends.until, count: ends.count }
    if (!startTime) return null
    return { ...buildPresetPattern(repeatMode, startTime), until: ends.until, count: ends.count }
  }, [repeatMode, customPattern, startTime, ends])

  const recurrenceSummary = useMemo(() => {
    if (!effectivePattern) return null
    return describeRecurrence(effectivePattern, { weekStart })
  }, [effectivePattern, weekStart])

  const handleRepeatModeChange = (nextMode: RecurrencePreset) => {
    setRepeatsTouched(true)
    if (nextMode === 'custom' && repeatMode !== 'custom') {
      // Expand from whatever pattern is currently in effect so switching to Custom doesn't
      // reset the user's picks (the existing rule's pattern if it was already custom-shaped,
      // else the preset-derived pattern, else a sane default).
      const seed =
        recurrenceQuery.data &&
        classifyPreset(recurrenceQuery.data.pattern as unknown as RecurrencePattern) === 'custom'
          ? (recurrenceQuery.data.pattern as unknown as RecurrencePattern)
          : repeatMode !== 'none' && startTime
            ? buildPresetPattern(repeatMode, startTime)
            : defaultCustomPattern(startTime)
      // Ends live in the separate `ends` state now — strip them from the seed so they aren't
      // duplicated inside `customPattern`.
      setCustomPattern({ ...seed, until: undefined, count: undefined })
    }
    setRepeatMode(nextMode)
  }

  // Only an intentional Repeats edit this session writes the rule — an incidental
  // time/duration/assignee edit must never silently rewrite the series cadence.
  const wantsRecurrenceWrite = repeatsTouched && repeatMode !== 'none'
  const patternValid =
    !wantsRecurrenceWrite ||
    (effectivePattern != null && recurrencePatternSchema.safeParse(effectivePattern).success)
  const showChooser = Boolean(recurrenceRuleId) && !wantsRecurrenceWrite

  const endTime = useMemo(() => {
    if (!startTime) return undefined
    const option = DURATION_OPTIONS.find((o) => o.value === duration)
    if (option?.minutes != null) return addMinutes(startTime, option.minutes)
    return customEndTime
  }, [startTime, duration, customEndTime])

  const workersQuery = api.dispatch.listWorkers.useQuery()
  const activeWorkers = useMemo(
    () => (workersQuery.data ?? []).filter((w) => w.isActive),
    [workersQuery.data]
  )
  const allUserActors = useAvailableActors({ target: 'user' })
  const excludeIds = useMemo(() => {
    if (activeWorkers.length === 0) return []
    const workerUserIds = new Set(activeWorkers.map((w) => w.userId))
    return allUserActors
      .filter((a) => !workerUserIds.has(getActorRawId(a.actorId)))
      .map((a) => a.actorId)
  }, [activeWorkers, allUserActors])

  const assigneeActorId = assigneeUserId ? toActorId('user', assigneeUserId) : null
  const hydratedAssignee = useActors(assigneeActorId ? [assigneeActorId] : [])
  const assigneeActor = assigneeActorId ? hydratedAssignee.get(assigneeActorId) : undefined

  const dayIso = startTime ? format(startTime, 'yyyy-MM-dd') : undefined
  const availabilityQuery = api.availability.resolve.useQuery(
    {
      subject: { type: 'worker', userId: assigneeUserId ?? '' },
      from: dayIso ?? '',
      to: dayIso ?? '',
    },
    { enabled: Boolean(assigneeUserId && dayIso) }
  )

  const hints = useMemo(() => {
    const list: string[] = []
    const resolvedDay = availabilityQuery.data?.[0]
    if (resolvedDay) {
      if (resolvedDay.ranges.length === 0) {
        list.push('Off that day')
      } else if (startTime && endTime) {
        const startMin = startTime.getHours() * 60 + startTime.getMinutes()
        const endMin = endTime.getHours() * 60 + endTime.getMinutes()
        const withinAnyRange = resolvedDay.ranges.some(
          (r) => startMin >= r.start && endMin <= r.end
        )
        if (!withinAnyRange) list.push('Outside working hours')
      }
    }
    if (assigneeUserId && startTime && endTime) {
      for (const visit of existingVisits) {
        if (visit.id === visitId) continue
        if (visit.assigneeUserId !== assigneeUserId) continue
        if (startTime < visit.endTime && visit.startTime < endTime) {
          list.push(`Overlaps ${visit.label}`)
        }
      }
    }
    return list
  }, [availabilityQuery.data, startTime, endTime, assigneeUserId, existingVisits, visitId])

  const scheduleVisit = api.dispatch.scheduleVisit.useMutation({
    onError: (error) => toastError({ title: 'Error scheduling visit', description: error.message }),
    onSuccess: () => onScheduled?.(),
  })
  const unscheduleVisit = api.dispatch.unscheduleVisit.useMutation({
    onError: (error) =>
      toastError({ title: 'Error unscheduling visit', description: error.message }),
    onSuccess: () => onUnscheduled?.(),
  })
  const invalidateRecurrence = () => {
    if (workOrderRecordId) void utils.dispatch.getRecurrence.invalidate({ workOrderRecordId })
  }
  const setRecurrence = api.dispatch.setRecurrence.useMutation({
    onError: (error) =>
      toastError({ title: 'Error saving recurrence', description: error.message }),
    onSuccess: () => {
      invalidateRecurrence()
      onScheduled?.()
    },
  })
  const applyToSeries = api.dispatch.applyToSeries.useMutation({
    onError: (error) => toastError({ title: 'Error updating series', description: error.message }),
    onSuccess: () => {
      invalidateRecurrence()
      onScheduled?.()
    },
  })

  const canSave = Boolean(startTime && endTime) && patternValid
  const isSaving = scheduleVisit.isPending || setRecurrence.isPending || applyToSeries.isPending

  const handleSave = () => {
    if (!startTime || !endTime) return

    if (wantsRecurrenceWrite) {
      if (!effectivePattern || !workOrderRecordId) return
      setRecurrence.mutate({
        workOrderRecordId,
        pattern: effectivePattern,
        template: {
          startMinute: startTime.getHours() * 60 + startTime.getMinutes(),
          durationMinutes: differenceInMinutes(endTime, startTime),
          defaultAssigneeUserId: assigneeUserId,
        },
        timezone: detectTimezone(),
        effectiveFrom: format(startTime, 'yyyy-MM-dd'),
      })
      return
    }

    if (showChooser && chooserScope !== 'this') {
      applyToSeries.mutate({
        visitId,
        scope: chooserScope,
        changes: {
          startMinute: startTime.getHours() * 60 + startTime.getMinutes(),
          durationMinutes: differenceInMinutes(endTime, startTime),
          assigneeUserId,
        },
      })
      return
    }

    scheduleVisit.mutate({ visitId, startTime, endTime, assigneeUserId })
  }

  const handleUnschedule = () => {
    unscheduleVisit.mutate({ visitId })
  }

  if (current?.id === 'assignee') {
    return (
      <div className={cn('w-80', className)}>
        <CommandBreadcrumb rootLabel='Schedule' />
        <ActorPickerContent
          value={assigneeActorId ? [assigneeActorId] : []}
          onChange={() => {}}
          target='user'
          multi={false}
          excludeIds={excludeIds}
          onSelectSingle={(actorId) => {
            setAssigneeUserId(getActorRawId(actorId))
            pop()
          }}
          placeholder='Search workers...'
        />
      </div>
    )
  }

  if (current?.id === 'datetime') {
    return (
      <div className={cn('w-80', className)}>
        <CommandBreadcrumb rootLabel='Schedule' />
        <DateTimePickerContent
          value={startTime}
          onChange={(value) => {
            setStartTime(value)
            pop()
          }}
          mode='datetime'
          className='w-full min-w-0'
        />
      </div>
    )
  }

  if (current?.id === 'endtime') {
    return (
      <div className={cn('w-80', className)}>
        <CommandBreadcrumb rootLabel='Schedule' />
        <DateTimePickerContent
          value={customEndTime ?? endTime}
          onChange={(value) => {
            setDuration('custom')
            setCustomEndTime(value && startTime ? cloneTimeToDate(startTime, value) : value)
            pop()
          }}
          mode='time'
          className='w-full min-w-0'
        />
      </div>
    )
  }

  return (
    <div className={cn('flex min-h-0 w-80 flex-col', className)}>
      <ScrollArea className='min-h-0 flex-1'>
        <div className='space-y-3 p-3'>
          <Button
            variant='outline'
            size='sm'
            className='w-full justify-start'
            onClick={() => push({ id: 'assignee', label: 'Assignee' })}>
            {assigneeActor ? (
              <>
                <Avatar className='size-4'>
                  <AvatarImage src={assigneeActor.avatarUrl ?? undefined} />
                  <AvatarFallback className='text-[9px]'>
                    {getInitials(assigneeActor.name)}
                  </AvatarFallback>
                </Avatar>
                {assigneeActor.name}
              </>
            ) : (
              <>
                <User /> Unassigned
              </>
            )}
          </Button>

          <Button
            variant='outline'
            size='sm'
            className='w-full justify-start'
            onClick={() => push({ id: 'datetime', label: 'Date & time' })}>
            <Calendar />
            {startTime ? format(startTime, 'PPP p') : 'Select date & time'}
          </Button>

          <div className='flex gap-2'>
            <Select
              value={duration}
              onValueChange={(v) => {
                // Custom drills into the end-time page — the duration only flips to
                // 'custom' once a time is actually picked there.
                if (v === 'custom') {
                  push({ id: 'endtime', label: 'End time' })
                  return
                }
                setDuration(v as DurationValue)
              }}>
              <SelectTrigger size='sm' className='flex-1 min-w-0'>
                <SelectValue placeholder='Duration' />
              </SelectTrigger>
              <SelectContent>
                {DURATION_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Button
              variant='outline'
              size='sm'
              className='flex-1 min-w-0 justify-start'
              onClick={() => push({ id: 'endtime', label: 'End time' })}>
              <Clock />
              {endTime ? format(endTime, 'p') : 'End time'}
            </Button>
          </div>

          {workOrderRecordId && (
            <div className='space-y-2'>
              <Select
                value={repeatMode}
                onValueChange={(v) => handleRepeatModeChange(v as RecurrencePreset)}>
                <SelectTrigger size='sm' className='w-full'>
                  <SelectValue placeholder='Repeats' />
                </SelectTrigger>
                <SelectContent>
                  {/* Selecting None on an existing rule is out of scope for v1 (06 §6) — ending
                      a series happens via the Pause/End engagement actions, not this control. */}
                  {!hasExistingRule && <SelectItem value='none'>Does not repeat</SelectItem>}
                  <SelectItem value='weekly'>Weekly</SelectItem>
                  <SelectItem value='biweekly'>Every 2 weeks</SelectItem>
                  <SelectItem value='monthly'>Monthly</SelectItem>
                  <SelectItem value='custom'>Custom...</SelectItem>
                </SelectContent>
              </Select>

              {repeatMode === 'custom' && (
                <RecurrencePatternFields
                  value={customPattern}
                  onChange={setCustomPattern}
                  weekStartIndex={weekStartIndex}
                  hideEndCondition
                />
              )}

              {repeatMode !== 'none' && (
                <div className='rounded-md border p-2'>
                  <RecurrenceEndFields
                    value={ends}
                    onChange={(next) => {
                      setRepeatsTouched(true)
                      setEnds(next)
                    }}
                    className='flex flex-col gap-2'
                  />
                </div>
              )}
            </div>
          )}

          {showChooser && (
            <div className='space-y-1.5 rounded-md border p-2'>
              <div className='text-xs font-medium text-muted-foreground'>Apply to</div>
              <RadioGroup
                value={chooserScope}
                onValueChange={(v) => setChooserScope(v as 'this' | 'following' | 'all')}
                className='gap-1.5'>
                <label className='flex items-center gap-2 text-sm'>
                  <RadioGroupItem value='this' size='sm' /> This visit
                </label>
                <label className='flex items-center gap-2 text-sm'>
                  <RadioGroupItem value='following' size='sm' /> This and following
                </label>
                <label className='flex items-center gap-2 text-sm'>
                  <RadioGroupItem value='all' size='sm' /> All visits
                </label>
              </RadioGroup>
            </div>
          )}

          {hints.length > 0 && (
            <div className='space-y-1 rounded-md border border-amber-500/30 bg-amber-500/10 p-2 text-xs text-amber-700 dark:text-amber-400'>
              {hints.map((hint) => (
                <div key={hint} className='flex items-center gap-1.5'>
                  <AlertTriangle className='size-3 shrink-0' />
                  {hint}
                </div>
              ))}
            </div>
          )}
        </div>
      </ScrollArea>

      <div className='space-y-2 border-t p-3'>
        {recurrenceSummary && (
          <p className='px-0.5 text-xs text-muted-foreground'>{recurrenceSummary}</p>
        )}

        {wantsRecurrenceWrite && !patternValid && (
          <p className='px-0.5 text-xs text-destructive'>
            Pick at least one weekday, or fix the end condition, to save this pattern.
          </p>
        )}

        <div className='flex items-center justify-between gap-2'>
          <Button
            variant='ghost'
            size='sm'
            onClick={handleUnschedule}
            loading={unscheduleVisit.isPending}
            disabled={!initialStartTime}>
            Unschedule
          </Button>
          <Button size='sm' onClick={handleSave} loading={isSaving} disabled={!canSave}>
            Save
          </Button>
        </div>
      </div>
    </div>
  )
}

export interface SchedulePopoverProps extends SchedulePopoverContentProps {
  trigger: ReactNode
  open?: boolean
  onOpenChange?: (open: boolean) => void
}

/**
 * Full popover-wrapped schedule control — for consumers outside the board (M2b job view's
 * Schedule card, the record drawer's "Schedule" button) that need their own trigger. The
 * board mounts `SchedulePopoverContent` directly inside its own chip popover instead.
 */
export function SchedulePopover({
  trigger,
  open,
  onOpenChange,
  ...contentProps
}: SchedulePopoverProps) {
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent className='w-80 p-0' align='start'>
        <SchedulePopoverContent {...contentProps} />
      </PopoverContent>
    </Popover>
  )
}
