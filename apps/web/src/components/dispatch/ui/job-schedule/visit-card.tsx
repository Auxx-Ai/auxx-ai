// apps/web/src/components/dispatch/ui/job-schedule/visit-card.tsx
'use client'

import { toActorId } from '@auxx/types/actor'
import { Avatar, AvatarFallback, AvatarImage } from '@auxx/ui/components/avatar'
import { Button } from '@auxx/ui/components/button'
import { format } from 'date-fns'
import { Send, User } from 'lucide-react'
import { getInitials } from '~/components/groups/utils/group-utils'
import type { RecordId } from '~/components/resources'
import { useActors } from '~/components/resources/hooks/use-actor'
import { useConfirm } from '~/hooks/use-confirm'
import { VISIT_STATUS_FORWARD_ORDER, VISIT_STATUS_LABELS, type VisitStatus } from '../board/types'
import { type ExistingVisitForOverlap, SchedulePopover } from '../schedule-popover'
import type { JobVisit, UseJobVisitsResult } from './use-job-visits'

export interface VisitCardProps {
  visit: JobVisit | undefined
  canEdit: boolean
  mutations: UseJobVisitsResult['mutations']
  existingVisits: ExistingVisitForOverlap[]
  onRefresh: () => void
  /** Threaded into `SchedulePopover` so it can offer the Repeats row (06 §6). */
  workOrderRecordId: RecordId
}

/**
 * The Schedule section's primary card (dispatch M2 build spec §F.3, 04-ui.md
 * §6): one-off jobs get a single visit card — assignee, time window, the
 * visit-status stepper (`scheduled → en_route → on_site → done`), schedule/
 * assign inline via the schedule control (#7), and the separate Dispatch
 * (notify) action. Recurring jobs render the same card for their
 * next-upcoming visit (the M2c engine adds the recurrence summary above it).
 */
export function VisitCard({
  visit,
  canEdit,
  mutations,
  existingVisits,
  onRefresh,
  workOrderRecordId,
}: VisitCardProps) {
  const [confirm, ConfirmDialog] = useConfirm()
  const assigneeActorId = visit?.assigneeUserId ? toActorId('user', visit.assigneeUserId) : null
  const hydratedAssignee = useActors(assigneeActorId ? [assigneeActorId] : [])
  const assignee = assigneeActorId ? hydratedAssignee.get(assigneeActorId) : undefined

  if (!visit) {
    return (
      <div className='rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground'>
        No visit yet.
      </div>
    )
  }

  const isScheduled = Boolean(visit.startTime && visit.endTime)
  const status = visit.status as VisitStatus
  const currentIndex = VISIT_STATUS_FORWARD_ORDER.indexOf(status)
  const canCancel = status !== 'canceled' && status !== 'done'

  const handleDispatch = async () => {
    if (visit.dispatchedAt) {
      const confirmed = await confirm({
        title: 'Re-dispatch this visit?',
        description: 'This notifies the assignee again.',
        confirmText: 'Re-dispatch',
      })
      if (!confirmed) return
    }
    mutations.dispatchVisit.mutate({ visitId: visit.id })
  }

  const handleCancel = async () => {
    const confirmed = await confirm({
      title: 'Cancel this visit?',
      description: 'The visit is removed from the schedule. This does not cancel the job.',
      confirmText: 'Cancel visit',
      cancelText: 'Keep visit',
      destructive: true,
    })
    if (!confirmed) return
    mutations.setVisitStatus.mutate({ visitId: visit.id, status: 'canceled' })
  }

  return (
    <div className='space-y-3 rounded-lg border p-4'>
      <div className='flex items-center justify-between gap-2'>
        <div className='flex items-center gap-2'>
          {assignee ? (
            <>
              <Avatar className='size-7'>
                <AvatarImage src={assignee.avatarUrl ?? undefined} />
                <AvatarFallback className='text-xs'>{getInitials(assignee.name)}</AvatarFallback>
              </Avatar>
              <span className='text-sm font-medium'>{assignee.name}</span>
            </>
          ) : (
            <span className='flex items-center gap-1.5 text-sm text-muted-foreground'>
              <User className='size-4' /> Unassigned
            </span>
          )}
        </div>

        {canEdit && (
          <SchedulePopover
            trigger={
              <Button variant='outline' size='sm'>
                {isScheduled ? 'Reschedule' : 'Schedule'}
              </Button>
            }
            visitId={visit.id}
            initialStartTime={visit.startTime ? new Date(visit.startTime) : undefined}
            initialEndTime={visit.endTime ? new Date(visit.endTime) : undefined}
            initialAssigneeUserId={visit.assigneeUserId}
            existingVisits={existingVisits}
            workOrderRecordId={workOrderRecordId}
            recurrenceRuleId={visit.recurrenceRuleId}
            onScheduled={onRefresh}
            onUnscheduled={onRefresh}
          />
        )}
      </div>

      <div className='text-sm text-muted-foreground'>
        {isScheduled && visit.startTime && visit.endTime
          ? `${format(new Date(visit.startTime), 'EEEE, MMMM d · p')} – ${format(new Date(visit.endTime), 'p')}`
          : 'Not scheduled yet'}
      </div>

      {status !== 'canceled' && (
        <div className='flex flex-wrap items-center gap-1'>
          {VISIT_STATUS_FORWARD_ORDER.map((step, index) => (
            <Button
              key={step}
              size='xs'
              variant={index === currentIndex ? 'default' : 'outline'}
              disabled={!canEdit || index <= currentIndex}
              loading={
                canEdit &&
                mutations.setVisitStatus.isPending &&
                mutations.setVisitStatus.variables?.status === step
              }
              onClick={() => mutations.setVisitStatus.mutate({ visitId: visit.id, status: step })}>
              {VISIT_STATUS_LABELS[step]}
            </Button>
          ))}
        </div>
      )}

      {canEdit && (
        <div className='flex items-center gap-2 pt-1'>
          <Button
            variant='outline'
            size='sm'
            onClick={handleDispatch}
            loading={mutations.dispatchVisit.isPending}
            disabled={!visit.assigneeUserId || !isScheduled}>
            <Send /> {visit.dispatchedAt ? 'Re-dispatch' : 'Dispatch'}
          </Button>
          {canCancel && (
            <Button variant='ghost' size='sm' onClick={handleCancel}>
              Cancel visit
            </Button>
          )}
        </div>
      )}

      <ConfirmDialog />
    </div>
  )
}
