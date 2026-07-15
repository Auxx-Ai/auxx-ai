// apps/web/src/components/dispatch/ui/schedule-popover.tsx

'use client'

import { Button } from '@auxx/ui/components/button'
import {
  EventDateTimeSection,
  EventPopoverBody,
  EventPopoverFooter,
  EventRepeatSection,
  type SeriesScope,
} from '@auxx/ui/components/event-calendar'
import { Popover, PopoverContent, PopoverTrigger } from '@auxx/ui/components/popover'
import { toastError } from '@auxx/ui/components/toast'
import { differenceInMinutes } from 'date-fns'
import { type ReactNode, useState } from 'react'
import type { RecordId } from '~/components/resources'
import { api } from '~/trpc/react'
import { AssigneeRow } from './shared/assignee-row'
import { RepeatEditor } from './shared/repeat-editor'
import { useRecurrenceEditor } from './shared/use-recurrence-editor'
import { useScheduleHints } from './shared/use-schedule-hints'

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
   * Repeat row (`dispatch.getRecurrence`/`setRecurrence`). The board's own visit popover
   * derives its RecordId itself (`visit-popover.tsx`); this prop serves the job-view/record-
   * drawer call sites.
   */
  workOrderRecordId?: RecordId
  /**
   * The target visit's own `recurrenceRuleId` (from `dispatch.listVisits`/`getBoard`) — when
   * set (and the visit is scheduled, not a draft), edits gate through the This visit / This and
   * following / All visits scope chooser (decision #3). Cadence edits (Repeats) never go
   * through the chooser — they always anchor at the picked start date.
   */
  recurrenceRuleId?: string | null
}

/**
 * The scheduling-only composition of the base `EventPopover` (14-event-popover.md Phase 5,
 * decisions #9/#10/#13): Date & Time + Assignee + Repeat + hints — no title card, no WO-options
 * section, no open-record footer (the job view / record drawer are already on the record).
 *
 * **Draft until scheduled, autosave after** (decision #10): an unscheduled visit
 * (`initialStartTime == null`) opens in a draft state where every section stages locally and a
 * single primary "Schedule" button commits once start + end are set. The moment the visit has
 * times (this session, via Schedule, or already on load), every edit autosaves per commit and
 * series edits gate through the commit-time scope chooser exactly like the board popover
 * (`series.isMember`), replacing the old always-visible "Apply to" chooser and Save button.
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
  workOrderRecordId,
  recurrenceRuleId,
}: SchedulePopoverContentProps) {
  const [scheduledYet, setScheduledYet] = useState(false)
  const isDraft = initialStartTime == null && !scheduledYet

  // Staged values — track props initially, then the last committed values in scheduled mode so
  // later commits (e.g. an assignee change after a time change) compose off current state.
  const [assigneeUserId, setAssigneeUserId] = useState<string | null>(initialAssigneeUserId ?? null)
  const [startTime, setStartTime] = useState<Date | null>(initialStartTime ?? null)
  const [endTime, setEndTime] = useState<Date | null>(initialEndTime ?? null)

  const editor = useRecurrenceEditor({ workOrderRecordId, initialStartTime, startTime })
  const hints = useScheduleHints({ visitId, assigneeUserId, startTime, endTime, existingVisits })

  const scheduleVisit = api.dispatch.scheduleVisit.useMutation({
    onError: (error) => toastError({ title: 'Error scheduling visit', description: error.message }),
    onSuccess: () => onScheduled?.(),
  })
  const unscheduleVisit = api.dispatch.unscheduleVisit.useMutation({
    onError: (error) =>
      toastError({ title: 'Error unscheduling visit', description: error.message }),
    onSuccess: () => onUnscheduled?.(),
  })
  const setRecurrence = api.dispatch.setRecurrence.useMutation({
    onError: (error) =>
      toastError({ title: 'Error saving recurrence', description: error.message }),
    onSuccess: () => {
      editor.invalidate()
      onScheduled?.()
    },
  })
  const applyToSeries = api.dispatch.applyToSeries.useMutation({
    onError: (error) => toastError({ title: 'Error updating series', description: error.message }),
    onSuccess: () => {
      editor.invalidate()
      onScheduled?.()
    },
  })

  const handleDateTimeChange = (change: { start: Date; end: Date }, scope: SeriesScope) => {
    setStartTime(change.start)
    setEndTime(change.end)
    if (isDraft) return

    if (scope === 'this') {
      scheduleVisit.mutate({
        visitId,
        startTime: change.start,
        endTime: change.end,
        assigneeUserId,
      })
      return
    }
    applyToSeries.mutate({
      visitId,
      scope,
      changes: {
        startMinute: change.start.getHours() * 60 + change.start.getMinutes(),
        durationMinutes: differenceInMinutes(change.end, change.start),
      },
    })
  }

  const handleAssigneeChange = (userId: string | null, scope: SeriesScope) => {
    setAssigneeUserId(userId)
    if (isDraft) return

    if (scope === 'this') {
      // Times unchanged — only fire when the visit actually has times to schedule with.
      if (startTime && endTime) {
        scheduleVisit.mutate({ visitId, startTime, endTime, assigneeUserId: userId })
      }
      return
    }
    applyToSeries.mutate({ visitId, scope, changes: { assigneeUserId: userId } })
  }

  /** Fires on the Repeat row's nested editor closing, in scheduled (non-draft) mode only. */
  const commitRecurrence = () => {
    if (!editor.wantsRecurrenceWrite || !editor.patternValid || !startTime || !endTime) return
    const input = editor.buildSetRecurrenceInput(startTime, endTime, assigneeUserId)
    if (!input) return
    setRecurrence.mutate(input)
  }

  const canSave = Boolean(startTime && endTime) && editor.patternValid

  /** Draft mode's single commit — same branch order as the old `handleSave`, minus the scope
   * chooser (a draft visit is never a series member). */
  const handleSchedule = () => {
    if (!startTime || !endTime) return

    if (editor.wantsRecurrenceWrite) {
      const input = editor.buildSetRecurrenceInput(startTime, endTime, assigneeUserId)
      if (!input) return
      setRecurrence.mutate(input, { onSuccess: () => setScheduledYet(true) })
      return
    }
    scheduleVisit.mutate(
      { visitId, startTime, endTime, assigneeUserId },
      { onSuccess: () => setScheduledYet(true) }
    )
  }

  return (
    <EventPopoverBody
      series={{
        isMember: !isDraft && Boolean(recurrenceRuleId),
        labels: { this: 'This visit', following: 'This and following', all: 'All visits' },
      }}
      className={className}>
      <EventDateTimeSection
        start={startTime}
        end={endTime}
        warnings={hints}
        onChange={handleDateTimeChange}
        onDateToggle={
          isDraft
            ? undefined
            : (enabled) => {
                if (!enabled) unscheduleVisit.mutate({ visitId })
              }
        }
      />
      <AssigneeRow value={assigneeUserId} onChange={handleAssigneeChange} />
      {workOrderRecordId && (
        <EventRepeatSection
          label={editor.repeatLabel}
          detail={
            editor.repeatMode === 'custom' ? (editor.recurrenceSummary ?? undefined) : undefined
          }
          renderEditor={() => <RepeatEditor editor={editor} />}
          onOpenChange={(open) => {
            if (!open && !isDraft) commitRecurrence()
          }}
        />
      )}
      {isDraft && (
        <EventPopoverFooter>
          <Button
            size='sm'
            className='w-full'
            loading={scheduleVisit.isPending || setRecurrence.isPending}
            disabled={!canSave}
            onClick={handleSchedule}>
            Schedule
          </Button>
        </EventPopoverFooter>
      )}
    </EventPopoverBody>
  )
}

export interface SchedulePopoverProps extends SchedulePopoverContentProps {
  trigger: ReactNode
  open?: boolean
  onOpenChange?: (open: boolean) => void
}

/**
 * Full popover-wrapped schedule control — for consumers outside the board (job view's Schedule
 * card, the record drawer's "Schedule" button) that need their own trigger. The board mounts
 * `SchedulePopoverContent`-equivalent content directly inside its own chip popover instead.
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
      <PopoverContent className='w-80 rounded-3xl p-0 shadow-xl' align='start'>
        <SchedulePopoverContent {...contentProps} />
      </PopoverContent>
    </Popover>
  )
}
