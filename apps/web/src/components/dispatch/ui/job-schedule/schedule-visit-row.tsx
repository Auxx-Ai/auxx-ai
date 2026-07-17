// apps/web/src/components/dispatch/ui/job-schedule/schedule-visit-row.tsx
'use client'

import { toActorId } from '@auxx/types/actor'
import { Avatar, AvatarFallback, AvatarImage } from '@auxx/ui/components/avatar'
import { Badge } from '@auxx/ui/components/badge'
import { TreeRow, TreeRowButton } from '@auxx/ui/components/tree-row'
import { CalendarClock, Repeat, RotateCcw, XCircle } from 'lucide-react'
import { getInitials } from '~/components/groups/utils/group-utils'
import type { RecordId } from '~/components/resources'
import { useActors } from '~/components/resources/hooks/use-actor'
import { useConfirm } from '~/hooks/use-confirm'
import { visitStatusLabel } from '../board/types'
import { type ExistingVisitForOverlap, SchedulePopover } from '../schedule-popover'
import { formatVisitWindow, movedFromLabel, VISIT_STATUS_BADGE_VARIANT } from './job-schedule-utils'
import type { JobVisit, UseJobVisitsResult } from './use-job-visits'

export interface ScheduleVisitRowProps {
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
  depth?: number
}

/**
 * ScheduleVisitRow — THE single visit row across every surface that lists a
 * work order's visits: the drawer's Schedule block, the job detail view's
 * Schedule/History sections, and the drilled "visits" list panel. The
 * work-order drawer card's `TreeRow` anatomy: `CalendarClock` icon + date/window
 * title, assignee (avatar + name) + colored status badge as `secondary`, and on
 * hover (canEdit) Reschedule (`SchedulePopover`) + Cancel actions. Whole row
 * clicks through to the visit drill.
 */
export function ScheduleVisitRow({
  visit,
  canEdit,
  mutations,
  existingVisits,
  onRefresh,
  onOpen,
  workOrderRecordId,
  depth,
}: ScheduleVisitRowProps) {
  const [confirm, ConfirmDialog] = useConfirm()
  const assigneeActorId = visit.assigneeUserId ? toActorId('user', visit.assigneeUserId) : null
  const hydratedAssignee = useActors(assigneeActorId ? [assigneeActorId] : [])
  const assignee = assigneeActorId ? hydratedAssignee.get(assigneeActorId) : undefined

  const isSeries = Boolean(visit.recurrenceRuleId)
  const canCancel = visit.status !== 'canceled' && visit.status !== 'done'
  const canRestore = visit.status === 'canceled'
  const statusLabel = visitStatusLabel(visit.status, visit.recurrenceRuleId)
  const moved = movedFromLabel(visit)

  const handleCancel = async () => {
    const confirmed = await confirm(
      isSeries
        ? {
            title: 'Skip this visit?',
            description:
              "The visit stays in the job's history as skipped and won't be regenerated. This does not affect other visits.",
            confirmText: 'Skip visit',
            cancelText: 'Keep visit',
            destructive: true,
          }
        : {
            title: 'Cancel this visit?',
            description:
              "The visit stays in the job's history as canceled. This does not cancel the job.",
            confirmText: 'Cancel visit',
            cancelText: 'Keep visit',
            destructive: true,
          }
    )
    if (!confirmed) return
    mutations.setVisitStatus.mutate({ visitId: visit.id, status: 'canceled' })
  }

  return (
    <>
      <TreeRow
        depth={depth}
        rowClassName='hover:bg-primary-100'
        icon={<CalendarClock className='size-4' />}
        title={
          <span className='flex min-w-0 flex-col'>
            <span className='inline-flex items-center gap-1 truncate text-sm'>
              {isSeries && <Repeat className='size-3 shrink-0 text-muted-foreground' />}
              <span className='truncate'>{formatVisitWindow(visit)}</span>
            </span>
            {moved && <span className='truncate text-xs text-muted-foreground'>{moved}</span>}
          </span>
        }
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
        onDrill={onOpen}
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
              {canRestore && (
                <TreeRowButton
                  tooltipText='Restore'
                  disabled={mutations.restoreVisit.isPending}
                  onClick={() => mutations.restoreVisit.mutate({ visitId: visit.id })}>
                  <RotateCcw />
                </TreeRowButton>
              )}
              {canCancel && (
                <TreeRowButton
                  variant='destructive'
                  tooltipText={isSeries ? 'Skip visit' : 'Cancel visit'}
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
