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
import { InlineEventTimePicker } from './shared/inline-event-time-picker'
import { RepeatEditor } from './shared/repeat-editor'
import { useRecurrenceEditor } from './shared/use-recurrence-editor'
import { useScheduleHints } from './shared/use-schedule-hints'

/** A same-day visit to check overlaps against — the board passes its in-memory set. */
export interface ExistingVisitForOverlap {
  id: string
  label: string
  startTime: Date
  endTime: Date
  assigneeWorkerId: string | null
}

export interface SchedulePopoverContentProps {
  /**
   * Omit for CREATE mode (plan 30 §F.2 follow-up — the "Add visit" flow): the popover opens
   * as a pure draft and nothing exists until the Schedule button commits, which then creates
   * AND schedules the new rule-less visit in one `dispatch.addVisit` call. Requires
   * `workOrderRecordId`. After a create-commit the caller should close the popover
   * (`onScheduled` fires) — the content stays in draft mode and never autosaves without an id.
   */
  visitId?: string
  initialStartTime?: Date | null
  initialEndTime?: Date | null
  initialAssigneeWorkerId?: string | null
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
  initialAssigneeWorkerId,
  existingVisits = [],
  onScheduled,
  onUnscheduled,
  className,
  workOrderRecordId,
  recurrenceRuleId,
}: SchedulePopoverContentProps) {
  const [scheduledYet, setScheduledYet] = useState(false)
  // CREATE mode (no visitId) is permanently a draft — the commit creates the row and the
  // caller closes the popover; there is nothing to autosave against.
  const isDraft = visitId == null || (initialStartTime == null && !scheduledYet)

  // Staged values — track props initially, then the last committed values in scheduled mode so
  // later commits (e.g. an assignee change after a time change) compose off current state.
  const [assigneeWorkerId, setAssigneeWorkerId] = useState<string | null>(
    initialAssigneeWorkerId ?? null
  )
  const [startTime, setStartTime] = useState<Date | null>(initialStartTime ?? null)
  const [endTime, setEndTime] = useState<Date | null>(initialEndTime ?? null)

  const editor = useRecurrenceEditor({
    workOrderRecordId,
    initialStartTime,
    startTime,
    recurrenceRuleId,
  })
  /** Plan 30 §D.2 — the series-scope chooser collapses to This visit / Future visits once the
   * target occurrence's own window has passed ("All visits" behaving identically to "following"
   * for a past pick is dishonest). Derived from the LIVE end time, not visit status (unavailable
   * here) — matches `isPastVisit`'s date-comparison half. */
  const isPast = Boolean(endTime && endTime.getTime() < Date.now())
  const hints = useScheduleHints({
    visitId,
    assigneeWorkerId,
    startTime,
    endTime,
    existingVisits,
  })

  const scheduleVisit = api.dispatch.scheduleVisit.useMutation({
    onError: (error) => toastError({ title: 'Error scheduling visit', description: error.message }),
    onSuccess: () => onScheduled?.(),
  })
  const addVisit = api.dispatch.addVisit.useMutation({
    onError: (error) => toastError({ title: 'Error adding visit', description: error.message }),
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
    if (isDraft || !visitId) return

    if (scope === 'this') {
      scheduleVisit.mutate({
        visitId,
        startTime: change.start,
        endTime: change.end,
        assigneeWorkerId,
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

  const handleAssigneeChange = (workerId: string | null, scope: SeriesScope) => {
    setAssigneeWorkerId(workerId)
    if (isDraft || !visitId) return

    if (scope === 'this') {
      // Times unchanged — only fire when the visit actually has times to schedule with.
      if (startTime && endTime) {
        scheduleVisit.mutate({ visitId, startTime, endTime, assigneeWorkerId: workerId })
      }
      return
    }
    applyToSeries.mutate({ visitId, scope, changes: { assigneeWorkerId: workerId } })
  }

  /** Scheduled (non-draft) mode's cadence commit — fired by the Repeat editor's explicit Save
   * button; closing the page without saving discards instead (`resetToRule` below). */
  const commitRecurrence = () => {
    if (!editor.wantsRecurrenceWrite || !editor.patternValid || !startTime || !endTime) return
    const input = editor.buildSetRecurrenceInput(startTime, endTime, assigneeWorkerId)
    if (!input) return
    setRecurrence.mutate(input)
    editor.markSaved()
  }

  const canSave = Boolean(startTime && endTime) && editor.patternValid

  /** Draft mode's single commit — same branch order as the old `handleSave`, minus the scope
   * chooser (a draft visit is never a series member). */
  const handleSchedule = () => {
    if (!startTime || !endTime) return

    // CREATE mode — nothing exists yet: one `addVisit` call creates + schedules the new
    // rule-less visit. A staged Repeat then fires `setRecurrence` after the create — the rule's
    // create-time adoption (plan 30 §E.1) folds the fresh visit in as the first occurrence.
    if (!visitId) {
      if (!workOrderRecordId) return
      addVisit.mutate(
        { workOrderRecordId, startTime, endTime, assigneeWorkerId },
        {
          onSuccess: () => {
            if (editor.wantsRecurrenceWrite) {
              const input = editor.buildSetRecurrenceInput(startTime, endTime, assigneeWorkerId)
              if (input) {
                setRecurrence.mutate(input)
                return
              }
            }
            onScheduled?.()
          },
        }
      )
      return
    }

    if (editor.wantsRecurrenceWrite) {
      const input = editor.buildSetRecurrenceInput(startTime, endTime, assigneeWorkerId)
      if (!input) return
      setRecurrence.mutate(input, { onSuccess: () => setScheduledYet(true) })
      return
    }
    scheduleVisit.mutate(
      { visitId, startTime, endTime, assigneeWorkerId },
      { onSuccess: () => setScheduledYet(true) }
    )
  }

  return (
    <EventPopoverBody
      series={{
        isMember: !isDraft && Boolean(recurrenceRuleId),
        labels: {
          this: 'This visit',
          following: isPast ? 'Future visits' : 'This and following',
          all: 'All visits',
        },
        hideAll: isPast,
      }}
      className={className}>
      <EventDateTimeSection
        start={startTime}
        end={endTime}
        warnings={hints}
        renderTimeEditor={(props) => <InlineEventTimePicker {...props} />}
        onChange={handleDateTimeChange}
        // Plan 30 §D.1 — series visits never go back to the backlog (server rejects it too);
        // the clear-date toggle is a series visit's disguised unschedule affordance, so hide it
        // once `recurrenceRuleId` is set. Reschedule (this same card's date/time picker) and
        // Skip (Status card, elsewhere) are the only exception verbs.
        onDateToggle={
          isDraft || recurrenceRuleId || !visitId
            ? undefined
            : (enabled) => {
                if (!enabled) unscheduleVisit.mutate({ visitId })
              }
        }
      />
      <AssigneeRow value={assigneeWorkerId} onChange={handleAssigneeChange} />
      {workOrderRecordId && (
        <EventRepeatSection
          label={editor.repeatLabel}
          detail={
            // Plan 30 §F.4 — a rule-less visit on an already-recurring work order can't pick up
            // a cadence of its own (one rule per job); the hint explains why the row is locked.
            editor.repeatLocked
              ? 'This job already repeats — this is an extra visit.'
              : editor.repeatMode === 'custom'
                ? (editor.recurrenceSummary ?? undefined)
                : undefined
          }
          disabled={editor.repeatLocked}
          renderEditor={(close) => (
            <RepeatEditor
              editor={editor}
              // Draft mode has no Save — the staged Repeat commits with the Schedule button.
              saving={setRecurrence.isPending}
              onSave={
                isDraft
                  ? undefined
                  : () => {
                      commitRecurrence()
                      close()
                    }
              }
            />
          )}
          onOpenChange={(open) => {
            // Non-draft close-without-save = discard (Save cleared `repeatsTouched` already);
            // draft mode keeps its staged edits for the Schedule commit.
            if (!open && !isDraft && editor.repeatsTouched) editor.resetToRule()
          }}
        />
      )}
      {isDraft && (
        <EventPopoverFooter>
          <Button
            size='sm'
            className='w-full'
            loading={scheduleVisit.isPending || addVisit.isPending || setRecurrence.isPending}
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
