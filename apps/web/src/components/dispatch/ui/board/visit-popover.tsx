// apps/web/src/components/dispatch/ui/board/visit-popover.tsx

'use client'

import { getInstanceId, toRecordId } from '@auxx/lib/resources/client'
import { Button } from '@auxx/ui/components/button'
import {
  EventDateTimeSection,
  EventPopoverFooter,
  EventPopoverHints,
  EventRepeatSection,
  EventTitleSection,
} from '@auxx/ui/components/event-calendar'
import { PanelCard, PanelCardRow } from '@auxx/ui/components/panel-card'
import { toastError } from '@auxx/ui/components/toast'
import { differenceInMinutes } from 'date-fns'
import { CircleDot, Contact, ExternalLink, Send, TriangleAlert } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useResource } from '~/components/resources'
import { useConfirm } from '~/hooks/use-confirm'
import { api } from '~/trpc/react'
import type { ExistingVisitForOverlap } from '../schedule-popover'
import { AssigneeRow } from '../shared/assignee-row'
import { RepeatEditor } from '../shared/repeat-editor'
import { useRecurrenceEditor } from '../shared/use-recurrence-editor'
import { useScheduleHints } from '../shared/use-schedule-hints'
import type { useBoardMutations } from './hooks/use-board-mutations'
import type { DispatchVisitEvent } from './types'
import { VISIT_STATUS_LABELS } from './types'
import { getVisitDayContext, isExecutionReady, nextVisitStatus } from './utils'

interface VisitPopoverContentProps {
  event: DispatchVisitEvent
  canEdit: boolean
  mutations: ReturnType<typeof useBoardMutations>
  existingVisits: ExistingVisitForOverlap[]
  onClose: () => void
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
}: VisitPopoverContentProps) {
  const router = useRouter()
  const utils = api.useUtils()
  const [confirm, ConfirmDialog] = useConfirm()

  const dayContext = getVisitDayContext(event.start, event.end)
  const isOverdue = dayContext === 'past' && event.status !== 'done' && event.status !== 'canceled'
  const next = nextVisitStatus(event.status)
  const canCancel = event.status !== 'canceled' && event.status !== 'done'

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
  })

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
   * chip's current start (decision #3 / plan §4.2). */
  const commitRecurrence = () => {
    if (!editor.wantsRecurrenceWrite || !editor.patternValid) return
    const input = editor.buildSetRecurrenceInput(event.start, event.end, event.assigneeUserId)
    if (input) setRecurrence.mutate(input)
  }

  const hints = useScheduleHints({
    visitId: event.id,
    assigneeUserId: event.assigneeUserId,
    startTime: event.start,
    endTime: event.end,
    existingVisits,
  })

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

  const openRecord = (href: string) => {
    onClose()
    router.push(href)
  }

  return (
    <>
      <EventTitleSection
        title={event.title}
        editable={false}
        subtitle={
          <>
            <div>{VISIT_STATUS_LABELS[event.status]}</div>
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
                  onClick: contactId
                    ? () => openRecord(`/app/contacts/${getInstanceId(contactId)}`)
                    : undefined,
                },
              ]
            : undefined
        }
      />

      <EventDateTimeSection
        start={event.start}
        end={event.end}
        disabled={!canEdit}
        onChange={
          canEdit
            ? ({ start, end }, scope) => {
                if (scope === 'this') {
                  mutations.scheduleVisit.mutate({
                    visitId: event.id,
                    startTime: start,
                    endTime: end,
                    assigneeUserId: event.assigneeUserId,
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
        onDateToggle={
          canEdit
            ? (enabled) => {
                if (!enabled) mutations.unscheduleVisit.mutate({ visitId: event.id })
              }
            : undefined
        }
      />

      <EventPopoverHints hints={hints} />

      <AssigneeRow
        value={event.assigneeUserId}
        disabled={!canEdit}
        onChange={(userId, scope) => {
          if (scope === 'this') {
            mutations.scheduleVisit.mutate({
              visitId: event.id,
              startTime: event.start,
              endTime: event.end,
              assigneeUserId: userId,
            })
          } else {
            mutations.applyToSeries.mutate({
              visitId: event.id,
              scope,
              changes: { assigneeUserId: userId },
            })
          }
        }}
      />

      <EventRepeatSection
        label={editor.repeatLabel}
        detail={
          editor.repeatMode === 'custom' ? (editor.recurrenceSummary ?? undefined) : undefined
        }
        disabled={!canEdit || !workOrderRecordId}
        renderEditor={() => <RepeatEditor editor={editor} />}
        onOpenChange={(open) => {
          if (!open) commitRecurrence()
        }}
      />

      {canEdit && (
        <PanelCard divided>
          <PanelCardRow
            icon={<CircleDot />}
            title='Status'
            description={VISIT_STATUS_LABELS[event.status]}
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
                    onClick={() =>
                      mutations.setVisitStatus.mutate({ visitId: event.id, status: 'canceled' })
                    }
                    loading={mutations.setVisitStatus.isPending}>
                    Cancel visit
                  </Button>
                )}
              </div>
            }
          />
          <PanelCardRow
            icon={<Send />}
            title='Dispatch'
            description={event.dispatchedAt ? 'Re-dispatch notifies the assignee again' : undefined}
            trailing={
              <Button
                size='sm'
                variant='outline'
                onClick={handleDispatch}
                loading={mutations.dispatchVisit.isPending}
                disabled={!event.assigneeUserId}>
                {event.dispatchedAt ? 'Re-dispatch' : 'Dispatch'}
              </Button>
            }
          />
        </PanelCard>
      )}

      <EventPopoverFooter
        action={{
          icon: <ExternalLink />,
          label: 'Open record',
          href: `/app/work-orders/${event.workOrderId}`,
          onClick: () => openRecord(`/app/work-orders/${event.workOrderId}`),
        }}
      />

      <ConfirmDialog />
    </>
  )
}
