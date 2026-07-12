// apps/web/src/components/dispatch/ui/job-schedule/visit-grid-row.tsx
'use client'

import { toActorId } from '@auxx/types/actor'
import { Avatar, AvatarFallback, AvatarImage } from '@auxx/ui/components/avatar'
import { GridTreeRow, TreeRowButton } from '@auxx/ui/components/tree-row'
import { cn } from '@auxx/ui/lib/utils'
import { CalendarClock, XCircle } from 'lucide-react'
import { getInitials } from '~/components/groups/utils/group-utils'
import type { RecordId } from '~/components/resources'
import { useActors } from '~/components/resources/hooks/use-actor'
import { useConfirm } from '~/hooks/use-confirm'
import { VISIT_STATUS_LABELS, type VisitStatus } from '../board/types'
import { type ExistingVisitForOverlap, SchedulePopover } from '../schedule-popover'
import { formatVisitDate, formatVisitTime, VISIT_STATUS_TEXT_CLASS } from './job-schedule-utils'
import type { JobVisit, UseJobVisitsResult } from './use-job-visits'

/** Shared grid template so every visit row's columns line up: date | time | assignee | status. */
const VISIT_GRID_COLUMNS = 'minmax(0,1fr) minmax(0,1fr) minmax(0,1.2fr) minmax(0,0.9fr)'

export interface VisitGridRowProps {
  visit: JobVisit
  canEdit: boolean
  mutations: UseJobVisitsResult['mutations']
  existingVisits: ExistingVisitForOverlap[]
  /** Re-fetch after `SchedulePopover`'s own mutation (it doesn't share `mutations`). */
  onRefresh: () => void
  /** Drill into the visit-detail panel (`setItemId(visit.id)`). */
  onOpen: () => void
  /** Threaded into `SchedulePopover` so it can offer the Repeats row (06 §6). */
  workOrderRecordId: RecordId
}

/**
 * One visit row in the Schedule/History sections, 04-mock anatomy: a
 * `GridTreeRow` with aligned columns — date · time window · assignee
 * (avatar + name) · right-aligned colored status text. No leading icon. On
 * hover (canEdit) the status swaps for the Reschedule/Cancel actions. Whole row
 * clicks through to the visit drill.
 */
export function VisitGridRow({
  visit,
  canEdit,
  mutations,
  existingVisits,
  onRefresh,
  onOpen,
  workOrderRecordId,
}: VisitGridRowProps) {
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
      <GridTreeRow
        title={<span className='text-sm font-normal'>{formatVisitDate(visit)}</span>}
        columns={VISIT_GRID_COLUMNS}
        onToggleOpen={onOpen}
        cells={[
          <span key='time' className='truncate text-sm'>
            {formatVisitTime(visit)}
          </span>,
          <span key='assignee' className='flex min-w-0 items-center gap-1.5 text-sm'>
            {assignee ? (
              <>
                <Avatar className='size-4 shrink-0'>
                  <AvatarImage src={assignee.avatarUrl ?? undefined} />
                  <AvatarFallback className='text-[9px]'>
                    {getInitials(assignee.name)}
                  </AvatarFallback>
                </Avatar>
                <span className='truncate'>{assignee.name}</span>
              </>
            ) : (
              'Unassigned'
            )}
          </span>,
          <span key='status' className='flex w-full items-center justify-end'>
            <span
              className={cn(
                'text-xs font-medium',
                VISIT_STATUS_TEXT_CLASS[visit.status] ?? 'text-muted-foreground',
                canEdit && 'group-hover/tree-row:hidden'
              )}>
              {statusLabel}
            </span>
            {canEdit && (
              <span className='hidden items-center group-hover/tree-row:flex'>
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
              </span>
            )}
          </span>,
        ]}
      />
      <ConfirmDialog />
    </>
  )
}
