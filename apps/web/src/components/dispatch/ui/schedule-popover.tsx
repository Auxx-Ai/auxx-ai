// apps/web/src/components/dispatch/ui/schedule-popover.tsx

'use client'

import { getActorRawId, toActorId } from '@auxx/types/actor'
import { Avatar, AvatarFallback, AvatarImage } from '@auxx/ui/components/avatar'
import { Button } from '@auxx/ui/components/button'
import { Popover, PopoverContent, PopoverTrigger } from '@auxx/ui/components/popover'
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
import { AlertTriangle, ArrowLeft, Calendar, User } from 'lucide-react'
import { type ReactNode, useMemo, useState } from 'react'
import { getInitials } from '~/components/groups/utils/group-utils'
import { ActorPickerContent } from '~/components/pickers/actor-picker/actor-picker-content'
import { DateTimePickerContent } from '~/components/pickers/date-time-picker'
import { cloneTimeToDate } from '~/components/pickers/date-time-picker/utils'
import { useActors, useAvailableActors } from '~/components/resources/hooks/use-actor'
import { api } from '~/trpc/react'

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
}

/**
 * The M2 schedule/assign control (07 §D.4, 04-ui #7): the single non-board surface that
 * writes `dispatch.scheduleVisit`. Composes `ActorPickerContent`/`DateTimePickerContent`
 * INSIDE this one popover (the `task-form.tsx` mention-picker precedent) — never nests a
 * second full picker popover; picking an assignee or a date/time swaps this popover's own
 * content via local `section` state instead.
 */
export function SchedulePopoverContent({
  visitId,
  initialStartTime,
  initialEndTime,
  initialAssigneeUserId,
  existingVisits = [],
  onScheduled,
  onUnscheduled,
  className,
}: SchedulePopoverContentProps) {
  const [section, setSection] = useState<'main' | 'assignee' | 'datetime'>('main')
  const [assigneeUserId, setAssigneeUserId] = useState<string | null>(initialAssigneeUserId ?? null)
  const [startTime, setStartTime] = useState<Date | undefined>(initialStartTime ?? undefined)
  const initialMinutes =
    initialStartTime && initialEndTime ? differenceInMinutes(initialEndTime, initialStartTime) : 60
  const initialDurationOption =
    DURATION_OPTIONS.find((o) => o.minutes === initialMinutes)?.value ?? 'custom'
  const [duration, setDuration] = useState<DurationValue>(initialDurationOption)
  const [customEndTime, setCustomEndTime] = useState<Date | undefined>(initialEndTime ?? undefined)

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

  const canSave = Boolean(startTime && endTime)

  const handleSave = () => {
    if (!startTime || !endTime) return
    scheduleVisit.mutate({ visitId, startTime, endTime, assigneeUserId })
  }

  const handleUnschedule = () => {
    unscheduleVisit.mutate({ visitId })
  }

  if (section === 'assignee') {
    return (
      <div className={cn('w-72', className)}>
        <SectionHeader label='Assignee' onBack={() => setSection('main')} />
        <ActorPickerContent
          value={assigneeActorId ? [assigneeActorId] : []}
          onChange={() => {}}
          target='user'
          multi={false}
          excludeIds={excludeIds}
          onSelectSingle={(actorId) => {
            setAssigneeUserId(getActorRawId(actorId))
            setSection('main')
          }}
          placeholder='Search workers...'
        />
      </div>
    )
  }

  if (section === 'datetime') {
    return (
      <div className={cn('w-auto', className)}>
        <SectionHeader label='Date & time' onBack={() => setSection('main')} />
        <DateTimePickerContent
          value={startTime}
          onChange={(value) => {
            setStartTime(value)
            setSection('main')
          }}
          mode='datetime'
        />
      </div>
    )
  }

  return (
    <div className={cn('w-72 space-y-3 p-3', className)}>
      <Button
        variant='outline'
        size='sm'
        className='w-full justify-start'
        onClick={() => setSection('assignee')}>
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
        onClick={() => setSection('datetime')}>
        <Calendar />
        {startTime ? format(startTime, 'PPP p') : 'Select date & time'}
      </Button>

      <Select value={duration} onValueChange={(v) => setDuration(v as DurationValue)}>
        <SelectTrigger size='sm' className='w-full'>
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

      {duration === 'custom' && (
        <DateTimePickerContent
          value={customEndTime}
          onChange={(value) =>
            setCustomEndTime(value && startTime ? cloneTimeToDate(startTime, value) : value)
          }
          mode='time'
          className='w-full'
        />
      )}

      {/* M2c adds a "Repeats" row here (None / Weekly / Every 2 weeks / Monthly / Custom) —
          06-recurring-engine.md §6. Picking a repeat flips jobType and opens the recurrence
          editor per the jobType-convergence rule (04-ui #7). */}

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

      <div className='flex items-center justify-between gap-2 pt-1'>
        <Button
          variant='ghost'
          size='sm'
          onClick={handleUnschedule}
          loading={unscheduleVisit.isPending}
          disabled={!initialStartTime}>
          Unschedule
        </Button>
        <Button
          size='sm'
          onClick={handleSave}
          loading={scheduleVisit.isPending}
          disabled={!canSave}>
          Save
        </Button>
      </div>
    </div>
  )
}

function SectionHeader({ label, onBack }: { label: string; onBack: () => void }) {
  return (
    <div className='flex items-center gap-1 border-b p-2'>
      <Button variant='ghost' size='icon' className='size-6' onClick={onBack}>
        <ArrowLeft />
      </Button>
      <span className='text-sm font-medium'>{label}</span>
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
      <PopoverContent className='p-0' align='start'>
        <SchedulePopoverContent {...contentProps} />
      </PopoverContent>
    </Popover>
  )
}
