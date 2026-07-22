// apps/web/src/components/dispatch/ui/board/visit-popover.tsx

'use client'

import { getInstanceId, type RecordId, toRecordId } from '@auxx/lib/resources/client'
import { Button } from '@auxx/ui/components/button'
import {
  EventDateTimeSection,
  EventRepeatSection,
  type EventTitleAction,
  EventTitleSection,
} from '@auxx/ui/components/event-calendar'
import { PanelCard, PanelCardRow } from '@auxx/ui/components/panel-card'
import { toastError } from '@auxx/ui/components/toast'
import { useIsMobile } from '@auxx/ui/hooks/use-mobile'
import { differenceInMinutes } from 'date-fns'
import {
  ArrowUpRight,
  CalendarX2,
  CircleDot,
  Contact,
  PanelRight,
  Send,
  TriangleAlert,
} from 'lucide-react'
import { useResource } from '~/components/resources'
import { useConfirm } from '~/hooks/use-confirm'
import { api } from '~/trpc/react'
import { cancelVisitConfirmOptions, isVisitDispatchable } from '../job-schedule/job-schedule-utils'
import type { ExistingVisitForOverlap } from '../schedule-popover'
import { AssigneeRow } from '../shared/assignee-row'
import { InlineEventTimePicker } from '../shared/inline-event-time-picker'
import { RepeatEditor } from '../shared/repeat-editor'
import { useRecurrenceEditor } from '../shared/use-recurrence-editor'
import { useScheduleHints } from '../shared/use-schedule-hints'
import type { useBoardMutations } from './hooks/use-board-mutations'
import type { DispatchVisitEvent } from './types'
import { VISIT_STATUS_LABELS, visitStatusLabel } from './types'
import { getVisitDayContext, isExecutionReady, nextVisitStatus } from './utils'

interface VisitPopoverContentProps {
  event: DispatchVisitEvent
  canEdit: boolean
  mutations: ReturnType<typeof useBoardMutations>
  existingVisits: ExistingVisitForOverlap[]
  onClose: () => void
  /** Opens a record in the board's docked/overlay `RecordDrawer` (nuqs `?record=`). An optional
   * `drill` lands the drawer pre-drilled onto a panel item (e.g. the clicked visit). */
  onOpenRecord: (recordId: RecordId, drill?: { panel?: string; item?: string }) => void
  /** Renders the dock-panel toggle (plan 21) in the floating-popover-only usage. Pass this ONLY
   * from `board-calendar-grid.tsx`'s floating `EventPopover` call site — the docked panel's own
   * `event-dock-panel.tsx` renders this same content without it, so the button never shows up
   * inside the dock (it would be redundant there). */
  onDock?: () => void
}

/**
 * The board chip's popover body (14 §4.2) — composes the base `EventPopover` sections +
 * Phase-3 shared dispatch rows (`AssigneeRow`, `RepeatEditor`) with a consumer-injected
 * work-order options `PanelCard`. Replaces `VisitActionsPopoverContent` and
 * `SchedulePopoverContent`'s reschedule sub-mode — the Date & Time card's autosave IS the
 * reschedule flow now (decision #9). Members (`canEdit=false`) see read-only sections and no
 * work-order options card.
 */
export function VisitPopoverContent({
  event,
  canEdit,
  mutations,
  existingVisits,
  onClose,
  onOpenRecord,
  onDock,
}: VisitPopoverContentProps) {
  const utils = api.useUtils()
  const [confirm, ConfirmDialog] = useConfirm()
  const isMobile = useIsMobile()

  const dayContext = getVisitDayContext(event.start, event.end)
  const isOverdue = dayContext === 'past' && event.status !== 'done' && event.status !== 'canceled'
  const next = nextVisitStatus(event.status)
  const canCancel = event.status !== 'canceled' && event.status !== 'done'
  /** Plan 30 §C.2 — Dispatch (notify-worker) only for a `scheduled` visit starting today or
   * tomorrow in its own stamped tz (falls back to the browser's tz when unset, e.g. legacy
   * rows). Canceled/done events never reach this — `isVisitDispatchable` checks status too. */
  const dispatchable = isVisitDispatchable({
    status: event.status,
    startTime: event.start,
    timezone: event.timezone,
  })

  const contactId = event.workOrder?.contactId ?? null
  const contactDisplayName = event.workOrder?.contactDisplayName

  const { resource: workOrderResource } = useResource('work-orders')
  const workOrderRecordId = workOrderResource
    ? toRecordId(workOrderResource.id, event.workOrderId)
    : undefined

  const editor = useRecurrenceEditor({
    workOrderRecordId,
    initialStartTime: event.start,
    startTime: event.start,
    recurrenceRuleId: event.recurrenceRuleId,
  })

  // Rule mutations are bulk-shaped (an unbounded row set, not one visit) — this settle-invalidate
  // stays as-is rather than converting to `applyVisitToCaches` (plan `dispatch/39-visit-cache-
  // sync.md` §2.4 "what this deliberately is NOT" / the batch-rule carve-out).
  const setRecurrence = api.dispatch.setRecurrence.useMutation({
    onError: (error) =>
      toastError({ title: 'Error saving recurrence', description: error.message }),
    onSuccess: () => editor.invalidate(),
    onSettled: () => {
      void utils.dispatch.getBoard.invalidate()
      void utils.dispatch.getVisitDayMarkers.invalidate()
    },
  })

  /** Repeat-row commits never go through the scope chooser and always re-anchor from the
   * chip's current start (decision #3 / plan §4.2). Fired by the editor's explicit Save
   * button only — closing the page without saving discards instead (`resetToRule` below). */
  const commitRecurrence = () => {
    if (!editor.wantsRecurrenceWrite || !editor.patternValid) return
    const input = editor.buildSetRecurrenceInput(event.start, event.end, event.assigneeWorkerId)
    if (!input) return
    setRecurrence.mutate(input)
    editor.markSaved()
  }

  const hints = useScheduleHints({
    visitId: event.id,
    assigneeWorkerId: event.assigneeWorkerId,
    startTime: event.start,
    endTime: event.end,
    existingVisits,
  })

  /** Confirmed cancel with the series-scope choice: primary = this visit only (the existing
   * tombstone), alternate = "Skip this and future visits" (tombstone + series ends here). */
  const handleCancel = async () => {
    const choice = await confirm(cancelVisitConfirmOptions(Boolean(event.recurrenceRuleId)))
    if (!choice) return
    if (choice === 'alternate') {
      mutations.cancelVisitFollowing.mutate({ visitId: event.id })
    } else {
      mutations.setVisitStatus.mutate({ visitId: event.id, status: 'canceled' })
    }
  }

  const handleDispatch = async () => {
    if (event.dispatchedAt) {
      const confirmed = await confirm({
        title: 'Re-dispatch this visit?',
        description: `This notifies ${contactDisplayName ? 'the worker' : 'the assignee'} again.`,
        confirmText: 'Re-dispatch',
      })
      if (!confirmed) return
    }
    mutations.dispatchVisit.mutate({ visitId: event.id })
  }

  /** Both the title link and the ↗ button open the work-order drawer pre-drilled onto this
   * visit (decision #8 — records stay in the board's docked/overlay drawer, not a full-page nav). */
  const openWorkOrder = () => {
    onClose()
    if (workOrderRecordId) onOpenRecord(workOrderRecordId, { panel: 'visits', item: event.id })
  }

  const openContact = () => {
    onClose()
    if (contactId) onOpenRecord(contactId, {})
  }

  /** The single "event actions" toolbar above the title. Dock is desktop-only (plan 21 decision
   * #5 — no docked column on mobile) and omitted from the dock panel's own render (no `onDock`);
   * once docked, `EventTitleSection` appends the dock chrome (flip / pop-out / close) itself. */
  const titleActions: EventTitleAction[] = [
    ...(onDock && !isMobile
      ? [{ icon: <PanelRight />, label: 'Dock panel', onClick: onDock }]
      : []),
    {
      icon: <ArrowUpRight />,
      label: 'Open work order',
      onClick: openWorkOrder,
      href: `/app/work-orders/${event.workOrderId}`,
    },
    // Plan 30 §D.1 — series visits never go back to the backlog (the server rejects it too);
    // a series occurrence's exception verbs are Reschedule (Date & Time card) and Skip
    // (Status card's Cancel, which reads "Skipped" for a series row) only.
    ...(canEdit && !event.recurrenceRuleId
      ? [
          {
            icon: <CalendarX2 />,
            label: 'Remove from calendar',
            destructive: true,
            onClick: () => {
              mutations.unscheduleVisit.mutate({ visitId: event.id })
              onClose()
            },
          },
        ]
      : []),
  ]

  return (
    <>
      <div className='space-y-2'>
        <EventTitleSection
          title={event.title}
          editable={false}
          onTitleClick={openWorkOrder}
          titleHref={`/app/work-orders/${event.workOrderId}`}
          actions={titleActions}
          subtitle={
            <>
              <div>{visitStatusLabel(event.status, event.recurrenceRuleId)}</div>
              {isOverdue && (
                <div className='flex items-center gap-1 text-amber-600 dark:text-amber-500'>
                  <TriangleAlert className='size-3' /> Overdue — not completed
                </div>
              )}
            </>
          }
          links={
            contactDisplayName
              ? [
                  {
                    icon: <Contact />,
                    label: contactDisplayName,
                    href: contactId ? `/app/contacts/${getInstanceId(contactId)}` : undefined,
                    onClick: contactId ? openContact : undefined,
                  },
                ]
              : undefined
          }
        />

        <EventDateTimeSection
          start={event.start}
          end={event.end}
          disabled={!canEdit}
          warnings={hints}
          renderTimeEditor={(props) => <InlineEventTimePicker {...props} />}
          onChange={
            canEdit
              ? ({ start, end }, scope) => {
                  if (scope === 'this') {
                    mutations.scheduleVisit.mutate({
                      visitId: event.id,
                      startTime: start,
                      endTime: end,
                      assigneeWorkerId: event.assigneeWorkerId,
                    })
                  } else {
                    mutations.applyToSeries.mutate({
                      visitId: event.id,
                      scope,
                      changes: {
                        startMinute: start.getHours() * 60 + start.getMinutes(),
                        durationMinutes: differenceInMinutes(end, start),
                      },
                    })
                  }
                }
              : undefined
          }
        />

        <AssigneeRow
          value={event.assigneeWorkerId}
          disabled={!canEdit}
          onChange={(workerId, scope) => {
            if (scope === 'this') {
              mutations.scheduleVisit.mutate({
                visitId: event.id,
                startTime: event.start,
                endTime: event.end,
                assigneeWorkerId: workerId,
              })
            } else {
              mutations.applyToSeries.mutate({
                visitId: event.id,
                scope,
                changes: { assigneeWorkerId: workerId },
              })
            }
          }}
        />

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
          disabled={!canEdit || !workOrderRecordId || editor.repeatLocked}
          renderEditor={(close) => (
            <RepeatEditor
              editor={editor}
              saving={setRecurrence.isPending}
              onSave={() => {
                commitRecurrence()
                close()
              }}
            />
          )}
          onOpenChange={(open) => {
            // Save already cleared `repeatsTouched`, so this only fires on close-without-save:
            // discard the staged edits so the collapsed pill never shows an unwritten cadence.
            if (!open && editor.repeatsTouched) editor.resetToRule()
          }}
        />

        {canEdit && (
          <PanelCard divided>
            <PanelCardRow
              icon={<CircleDot />}
              title='Status'
              description={visitStatusLabel(event.status, event.recurrenceRuleId)}
              trailing={
                <div className='flex flex-col items-end gap-1.5'>
                  {next && isExecutionReady(dayContext) && (
                    <Button
                      size='sm'
                      variant='outline'
                      onClick={() =>
                        mutations.setVisitStatus.mutate({ visitId: event.id, status: next })
                      }
                      loading={mutations.setVisitStatus.isPending}>
                      Advance to {VISIT_STATUS_LABELS[next]}
                    </Button>
                  )}
                  {canCancel && (
                    <Button
                      size='sm'
                      variant='ghost'
                      onClick={handleCancel}
                      loading={
                        mutations.setVisitStatus.isPending ||
                        mutations.cancelVisitFollowing.isPending
                      }>
                      {event.recurrenceRuleId ? 'Skip visit' : 'Cancel visit'}
                    </Button>
                  )}
                </div>
              }
            />
            {dispatchable && (
              <PanelCardRow
                icon={<Send />}
                title='Dispatch'
                description={
                  event.dispatchedAt ? 'Re-dispatch notifies the assignee again' : undefined
                }
                trailing={
                  <Button
                    size='sm'
                    variant='outline'
                    onClick={handleDispatch}
                    loading={mutations.dispatchVisit.isPending}
                    disabled={!event.assigneeWorkerId}>
                    {event.dispatchedAt ? 'Re-dispatch' : 'Dispatch'}
                  </Button>
                }
              />
            )}
          </PanelCard>
        )}
      </div>
      <ConfirmDialog />
    </>
  )
}
