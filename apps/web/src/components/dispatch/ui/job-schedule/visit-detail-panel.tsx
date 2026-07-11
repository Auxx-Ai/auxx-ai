// apps/web/src/components/dispatch/ui/job-schedule/visit-detail-panel.tsx
'use client'

import { toActorId } from '@auxx/types/actor'
import { Avatar, AvatarFallback, AvatarImage } from '@auxx/ui/components/avatar'
import { Badge } from '@auxx/ui/components/badge'
import { Button } from '@auxx/ui/components/button'
import { ScrollArea } from '@auxx/ui/components/scroll-area'
import { format } from 'date-fns'
import { CalendarClock, Send, User, XCircle } from 'lucide-react'
import type { DetailViewSectionsDrillContext } from '~/components/detail-view/detail-view-sections'
import { getInitials } from '~/components/groups/utils/group-utils'
import { useActors } from '~/components/resources/hooks/use-actor'
import { useConfirm } from '~/hooks/use-confirm'
import { VISIT_STATUS_LABELS, type VisitStatus } from '../board/types'
import { SchedulePopover } from '../schedule-popover'
import { formatVisitWindow, VISIT_STATUS_BADGE_VARIANT } from './job-schedule-utils'
import { useJobVisits } from './use-job-visits'

/**
 * VisitDetailPanel — the third stack level (`visits:item`), dispatch M2 build
 * spec §F.3: full visit info, the per-visit proof-of-work placeholder (worker
 * mobile surface plan fills it in), the visit line items placeholder (money
 * 01-ui #13, `visitId`-scoped — not built in this slice), and the row actions.
 */
export function VisitDetailPanel({ recordId, itemId }: DetailViewSectionsDrillContext) {
  const { visits, isLoading, canEdit, mutations, existingVisits, refresh } = useJobVisits(recordId)
  const visit = visits.find((v) => v.id === itemId)
  const [confirm, ConfirmDialog] = useConfirm()

  const assigneeActorId = visit?.assigneeUserId ? toActorId('user', visit.assigneeUserId) : null
  const hydratedAssignee = useActors(assigneeActorId ? [assigneeActorId] : [])
  const assignee = assigneeActorId ? hydratedAssignee.get(assigneeActorId) : undefined

  if (isLoading && !visit) {
    return <div className='p-6 text-sm text-muted-foreground'>Loading visit...</div>
  }
  if (!visit) {
    return <div className='p-6 text-sm text-muted-foreground'>Visit not found.</div>
  }

  const canCancel = visit.status !== 'canceled' && visit.status !== 'done'

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
    <ScrollArea className='h-full' scrollbarClassName='w-1.5 z-20' noFade>
      <div className='flex flex-col gap-4 p-4'>
        <div className='flex items-center justify-between gap-2'>
          <div className='flex flex-col gap-1'>
            <span className='text-sm font-medium'>{formatVisitWindow(visit)}</span>
            <Badge
              variant={VISIT_STATUS_BADGE_VARIANT[visit.status] ?? 'default'}
              size='sm'
              className='w-fit'>
              {VISIT_STATUS_LABELS[visit.status as VisitStatus] ?? visit.status}
            </Badge>
          </div>
          {assignee ? (
            <div className='flex items-center gap-2'>
              <Avatar className='size-7'>
                <AvatarImage src={assignee.avatarUrl ?? undefined} />
                <AvatarFallback className='text-xs'>{getInitials(assignee.name)}</AvatarFallback>
              </Avatar>
              <span className='text-sm'>{assignee.name}</span>
            </div>
          ) : (
            <span className='flex items-center gap-1.5 text-sm text-muted-foreground'>
              <User className='size-4' /> Unassigned
            </span>
          )}
        </div>

        {visit.dispatchedAt && (
          <div className='text-xs text-muted-foreground'>
            Dispatched {format(new Date(visit.dispatchedAt), 'PP p')}
          </div>
        )}

        {canEdit && (
          <div className='flex flex-wrap items-center gap-2'>
            <SchedulePopover
              trigger={
                <Button variant='outline' size='sm'>
                  <CalendarClock /> Reschedule
                </Button>
              }
              visitId={visit.id}
              initialStartTime={visit.startTime ? new Date(visit.startTime) : undefined}
              initialEndTime={visit.endTime ? new Date(visit.endTime) : undefined}
              initialAssigneeUserId={visit.assigneeUserId}
              existingVisits={existingVisits}
              workOrderRecordId={recordId}
              recurrenceRuleId={visit.recurrenceRuleId}
              onScheduled={refresh}
              onUnscheduled={refresh}
            />
            <Button
              variant='outline'
              size='sm'
              onClick={() => mutations.dispatchVisit.mutate({ visitId: visit.id })}
              loading={mutations.dispatchVisit.isPending}
              disabled={!visit.assigneeUserId || !visit.startTime}>
              <Send /> {visit.dispatchedAt ? 'Re-dispatch' : 'Dispatch'}
            </Button>
            {canCancel && (
              <Button variant='ghost' size='sm' onClick={handleCancel}>
                <XCircle /> Cancel visit
              </Button>
            )}
          </div>
        )}

        {/* Per-visit proof of work — worker mobile surface plan fills this in
            (completion notes + photos, dispatch M2 build spec §F.3). */}
        <div className='rounded-lg border border-dashed p-4 text-sm text-muted-foreground'>
          Proof of work (completion notes, photos) lands with the worker mobile surface.
        </div>

        {/* Visit line items (occurrence extras) — money 01-ui #13, `visitId`-scoped.
            Not built in this slice. */}
        <div className='rounded-lg border border-dashed p-4 text-sm text-muted-foreground'>
          Visit line items (occurrence extras) land with money 01-ui #13.
        </div>

        <ConfirmDialog />
      </div>
    </ScrollArea>
  )
}
