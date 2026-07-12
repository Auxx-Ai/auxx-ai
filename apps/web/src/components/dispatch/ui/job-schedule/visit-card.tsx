// apps/web/src/components/dispatch/ui/job-schedule/visit-card.tsx
'use client'

import { toActorId } from '@auxx/types/actor'
import { Avatar, AvatarFallback, AvatarImage } from '@auxx/ui/components/avatar'
import { Badge } from '@auxx/ui/components/badge'
import { Button } from '@auxx/ui/components/button'
import { RadioTab, RadioTabItem } from '@auxx/ui/components/radio-tab'
import { EmptySection } from '@auxx/ui/components/section'
import { TreeRowButton } from '@auxx/ui/components/tree-row'
import { format } from 'date-fns'
import { CalendarClock, Send, User, XCircle } from 'lucide-react'
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
 * The Schedule section's primary "Next visit" card (dispatch M2 build spec
 * §F.3, 04 mock): tinted rounded-2xl shell with a calendar date block (month +
 * day), "Next visit · <date>" title, time window + assignee line, a visible
 * Schedule/Reschedule button (hover-revealed dispatch/cancel next to it), and
 * the visit-status stepper as a `RadioTab` segmented control
 * (`scheduled → en_route → on_site → done`, forward-only). Recurring jobs
 * render the same card for their next-upcoming visit (the M2c engine adds the
 * recurrence row above it).
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
    return <EmptySection icon={<CalendarClock className='size-5' />} title='No visit yet' />
  }

  const isScheduled = Boolean(visit.startTime && visit.endTime)
  const status = visit.status as VisitStatus
  const currentIndex = VISIT_STATUS_FORWARD_ORDER.indexOf(status)
  const canCancel = status !== 'canceled' && status !== 'done'
  const canDispatch = canEdit && Boolean(visit.assigneeUserId) && isScheduled

  const handleStatusChange = (next: string) => {
    // Forward-only, mirroring the server transition rules — RadioTab fires for
    // any item, so ignore clicks on the current/past steps.
    if (VISIT_STATUS_FORWARD_ORDER.indexOf(next as VisitStatus) <= currentIndex) return
    mutations.setVisitStatus.mutate({ visitId: visit.id, status: next as VisitStatus })
  }

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

  const start = visit.startTime ? new Date(visit.startTime) : null
  const end = visit.endTime ? new Date(visit.endTime) : null

  return (
    <div className='group/tree-row space-y-2.5 rounded-2xl border bg-primary-100/50 py-2.5 px-3'>
      <div className='flex items-center gap-3'>
        {/* Calendar date block — month + day (04 mock), icon when unscheduled. */}
        <div className='flex size-11 shrink-0 flex-col items-center justify-center rounded-lg border bg-background'>
          {start ? (
            <>
              <span className='text-[10px] font-semibold uppercase leading-none text-muted-foreground'>
                {format(start, 'MMM')}
              </span>
              <span className='text-base font-semibold leading-tight'>{format(start, 'd')}</span>
            </>
          ) : (
            <CalendarClock className='size-5 text-muted-foreground' />
          )}
        </div>

        <div className='min-w-0 flex-1'>
          <div className='flex items-center gap-2 text-sm font-medium'>
            <span className='truncate'>
              {start ? `Next visit · ${format(start, 'EEE, MMM d')}` : 'Not scheduled yet'}
            </span>
            {status === 'canceled' && (
              <Badge variant='red' size='xs'>
                Canceled
              </Badge>
            )}
          </div>
          <div className='flex items-center gap-2 text-sm text-muted-foreground'>
            {start && (
              <span>
                {end ? `${format(start, 'p')} – ${format(end, 'p')}` : format(start, 'p')}
              </span>
            )}
            {assignee ? (
              <span className='flex min-w-0 items-center gap-1.5'>
                <Avatar className='size-4 shrink-0'>
                  <AvatarImage src={assignee.avatarUrl ?? undefined} />
                  <AvatarFallback className='text-[9px]'>
                    {getInitials(assignee.name)}
                  </AvatarFallback>
                </Avatar>
                <span className='truncate'>{assignee.name}</span>
              </span>
            ) : (
              <span className='flex items-center gap-1'>
                <User className='size-3.5' /> Unassigned
              </span>
            )}
          </div>
        </div>

        {canEdit && (
          <div className='flex shrink-0 items-center gap-1'>
            {canDispatch && (
              <TreeRowButton
                tooltipText={visit.dispatchedAt ? 'Re-dispatch' : 'Dispatch'}
                disabled={mutations.dispatchVisit.isPending}
                onClick={handleDispatch}>
                <Send />
              </TreeRowButton>
            )}
            {canCancel && (
              <TreeRowButton
                variant='destructive'
                tooltipText='Cancel visit'
                onClick={handleCancel}>
                <XCircle />
              </TreeRowButton>
            )}
            <SchedulePopover
              trigger={
                <Button variant='outline' size='xs'>
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
          </div>
        )}
      </div>

      {status !== 'canceled' && (
        <RadioTab
          value={status}
          onValueChange={handleStatusChange}
          size='sm'
          radioGroupClassName='grid w-full grid-cols-4'
          className='border border-primary-200 flex w-full'>
          {VISIT_STATUS_FORWARD_ORDER.map((step, index) => (
            <RadioTabItem
              key={step}
              value={step}
              size='sm'
              disabled={!canEdit || index < currentIndex || mutations.setVisitStatus.isPending}>
              {VISIT_STATUS_LABELS[step]}
            </RadioTabItem>
          ))}
        </RadioTab>
      )}

      <ConfirmDialog />
    </div>
  )
}
