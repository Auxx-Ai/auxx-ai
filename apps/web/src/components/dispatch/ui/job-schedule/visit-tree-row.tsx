// apps/web/src/components/dispatch/ui/job-schedule/visit-tree-row.tsx
'use client'

import { toActorId } from '@auxx/types/actor'
import { Avatar, AvatarFallback, AvatarImage } from '@auxx/ui/components/avatar'
import { Badge } from '@auxx/ui/components/badge'
import { TreeRow, TreeRowButton } from '@auxx/ui/components/tree-row'
import { Calendar, CalendarClock, XCircle } from 'lucide-react'
import { getInitials } from '~/components/groups/utils/group-utils'
import type { RecordId } from '~/components/resources'
import { useActors } from '~/components/resources/hooks/use-actor'
import { useConfirm } from '~/hooks/use-confirm'
import { VISIT_STATUS_LABELS, type VisitStatus } from '../board/types'
import { type ExistingVisitForOverlap, SchedulePopover } from '../schedule-popover'
import { formatVisitWindow, VISIT_STATUS_BADGE_VARIANT } from './job-schedule-utils'
import type { JobVisit, UseJobVisitsResult } from './use-job-visits'

export interface VisitTreeRowProps {
  visit: JobVisit
  canEdit: boolean
  mutations: UseJobVisitsResult['mutations']
  existingVisits: ExistingVisitForOverlap[]
  /** Re-fetch after `SchedulePopover`'s own mutation (it doesn't share `mutations`). */
  onRefresh: () => void
  /** Drill into the visit-detail panel (`setItemId(visit.id)`). */
  onOpen: () => void
  depth?: number
  /** Threaded into `SchedulePopover` so it can offer the Repeats row (06 §6). */
  workOrderRecordId: RecordId
}

/**
 * One visit row — shared by the Schedule section's Upcoming/History previews AND
 * the drilled "visits" list panel (dispatch M2 build spec §F.3, written
 * jobType-agnostic: "render this job's visits"). `TreeRow` everywhere per
 * 04-ui.md §6: icon + date/window as title, assignee + status badge as
 * `secondary`, hover actions as `TreeRowButton`s, whole row clickable to drill.
 */
export function VisitTreeRow({
  visit,
  canEdit,
  mutations,
  existingVisits,
  onRefresh,
  onOpen,
  depth,
  workOrderRecordId,
}: VisitTreeRowProps) {
  const [confirm, ConfirmDialog] = useConfirm()
  const assigneeActorId = visit.assigneeUserId ? toActorId('user', visit.assigneeUserId) : null
  const hydratedAssignee = useActors(assigneeActorId ? [assigneeActorId] : [])
  const assignee = assigneeActorId ? hydratedAssignee.get(assigneeActorId) : undefined

  const canCancel = visit.status !== 'canceled' && visit.status !== 'done'
  const statusLabel = VISIT_STATUS_LABELS[visit.status as VisitStatus] ?? visit.status

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
    <>
      <TreeRow
        depth={depth}
        icon={<Calendar className='size-3.5' />}
        title={formatVisitWindow(visit)}
        secondary={
          <span className='inline-flex items-center gap-1.5'>
            {assignee ? (
              <>
                <Avatar className='size-4'>
                  <AvatarImage src={assignee.avatarUrl ?? undefined} />
                  <AvatarFallback className='text-[9px]'>
                    {getInitials(assignee.name)}
                  </AvatarFallback>
                </Avatar>
                {assignee.name}
              </>
            ) : (
              'Unassigned'
            )}
            <Badge variant={VISIT_STATUS_BADGE_VARIANT[visit.status] ?? 'default'} size='sm'>
              {statusLabel}
            </Badge>
          </span>
        }
        onToggleOpen={onOpen}
        actions={
          canEdit ? (
            <>
              <SchedulePopover
                trigger={
                  <TreeRowButton tooltipText='Reschedule'>
                    <CalendarClock />
                  </TreeRowButton>
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
              {canCancel && (
                <TreeRowButton
                  variant='destructive'
                  tooltipText='Cancel visit'
                  onClick={handleCancel}>
                  <XCircle />
                </TreeRowButton>
              )}
            </>
          ) : undefined
        }
      />
      <ConfirmDialog />
    </>
  )
}
