// apps/web/src/components/dispatch/ui/job-schedule/recurring-engagement-card.tsx
'use client'

import { describeRecurrence, type RecurrencePattern } from '@auxx/lib/recurrence/client'
import { Badge } from '@auxx/ui/components/badge'
import { Button } from '@auxx/ui/components/button'
import { toastError } from '@auxx/ui/components/toast'
import { Pause, Play, XCircle } from 'lucide-react'
import { useMemo } from 'react'
import type { RecordId } from '~/components/resources'
import { useConfirm } from '~/hooks/use-confirm'
import { useSettings } from '~/hooks/use-settings'
import { api } from '~/trpc/react'
import { scalarSetting } from '../recurrence/recurrence-utils'
import { type ExistingVisitForOverlap, SchedulePopover } from '../schedule-popover'
import type { JobVisit } from './use-job-visits'

const ENGAGEMENT_BADGE: Record<string, { label: string; variant: 'green' | 'amber' | 'gray' }> = {
  active: { label: 'Active', variant: 'green' },
  paused: { label: 'Paused', variant: 'amber' },
  ended: { label: 'Ended', variant: 'gray' },
}

export interface RecurringEngagementCardProps {
  recordId: RecordId
  /** `work_order_status` value — gates which of Pause/Resume/End are shown (06 §4.1). */
  status: string
  /** Admin/owner gate — engine mutations are `dispatchAdminProcedure` (members are read-only). */
  canEdit: boolean
  /** The next-upcoming visit — the Edit action reschedules/re-configures through it. */
  primaryVisit: JobVisit | undefined
  existingVisits: ExistingVisitForOverlap[]
  onRefresh: () => void
}

/**
 * The Job view's recurring Schedule section variant (dispatch M2 build spec §F.3,
 * 06-recurring-engine.md §6): recurrence summary (`describeRecurrence`) + Edit (reopens the
 * same #7 `SchedulePopover`, scoped to the next-upcoming visit, which already carries the
 * Repeats row) + Pause/Resume/End actions gated on the engagement's `work_order_status`.
 * Renders nothing pre-rule ("recurring, not yet scheduled" — `VisitCard`'s own Schedule
 * button/Repeats row is where that gets configured, 04-ui.md §7 jobType convergence).
 */
export function RecurringEngagementCard({
  recordId,
  status,
  canEdit,
  primaryVisit,
  existingVisits,
  onRefresh,
}: RecurringEngagementCardProps) {
  const utils = api.useUtils()
  const [confirm, ConfirmDialog] = useConfirm()
  const { getSetting } = useSettings({ scope: 'GENERAL' })
  const weekStart = (scalarSetting(getSetting('organization.weekStart')) ?? 'monday') as
    | 'monday'
    | 'sunday'
    | 'saturday'

  const ruleQuery = api.dispatch.getRecurrence.useQuery({ workOrderRecordId: recordId })

  const summary = useMemo(() => {
    if (!ruleQuery.data) return null
    return describeRecurrence(ruleQuery.data.pattern as unknown as RecurrencePattern, {
      weekStart,
    })
  }, [ruleQuery.data, weekStart])

  const invalidate = () => {
    void utils.dispatch.getRecurrence.invalidate({ workOrderRecordId: recordId })
    onRefresh()
  }

  const pauseEngagement = api.dispatch.pauseEngagement.useMutation({
    onError: (error) =>
      toastError({ title: 'Error pausing engagement', description: error.message }),
    onSuccess: invalidate,
  })
  const resumeEngagement = api.dispatch.resumeEngagement.useMutation({
    onError: (error) =>
      toastError({ title: 'Error resuming engagement', description: error.message }),
    onSuccess: invalidate,
  })
  const endEngagement = api.dispatch.endEngagement.useMutation({
    onError: (error) =>
      toastError({ title: 'Error ending engagement', description: error.message }),
    onSuccess: invalidate,
  })

  if (!ruleQuery.data) return null

  const badge = ENGAGEMENT_BADGE[status] ?? ENGAGEMENT_BADGE.active

  const handlePause = async () => {
    const confirmed = await confirm({
      title: 'Pause this engagement?',
      description:
        'Future scheduled visits are removed — manual reschedules on future visits are lost. Skipped visits stay skipped.',
      confirmText: 'Pause',
      cancelText: 'Keep active',
      destructive: true,
    })
    if (!confirmed) return
    pauseEngagement.mutate({ workOrderRecordId: recordId })
  }

  const handleEnd = async () => {
    const confirmed = await confirm({
      title: 'End this engagement?',
      description:
        'This is terminal — future scheduled visits are removed and the series cannot be resumed. Create a new job to start again.',
      confirmText: 'End engagement',
      cancelText: 'Keep active',
      destructive: true,
    })
    if (!confirmed) return
    endEngagement.mutate({ workOrderRecordId: recordId })
  }

  return (
    <div className='space-y-3 rounded-lg border p-4'>
      <div className='flex items-center justify-between gap-2'>
        <div className='flex items-center gap-2'>
          <span className='text-sm font-medium'>{summary}</span>
          <Badge variant={badge.variant} size='sm'>
            {badge.label}
          </Badge>
        </div>

        {canEdit && status !== 'ended' && primaryVisit && (
          <SchedulePopover
            trigger={
              <Button variant='outline' size='sm'>
                Edit
              </Button>
            }
            visitId={primaryVisit.id}
            initialStartTime={primaryVisit.startTime ? new Date(primaryVisit.startTime) : undefined}
            initialEndTime={primaryVisit.endTime ? new Date(primaryVisit.endTime) : undefined}
            initialAssigneeUserId={primaryVisit.assigneeUserId}
            existingVisits={existingVisits}
            workOrderRecordId={recordId}
            recurrenceRuleId={primaryVisit.recurrenceRuleId}
            onScheduled={invalidate}
            onUnscheduled={invalidate}
          />
        )}
      </div>

      {canEdit && status !== 'ended' && (
        <div className='flex items-center gap-2'>
          {status === 'paused' ? (
            <Button
              variant='outline'
              size='sm'
              onClick={() => resumeEngagement.mutate({ workOrderRecordId: recordId })}
              loading={resumeEngagement.isPending}>
              <Play /> Resume
            </Button>
          ) : (
            <Button
              variant='outline'
              size='sm'
              onClick={handlePause}
              loading={pauseEngagement.isPending}>
              <Pause /> Pause
            </Button>
          )}
          <Button variant='ghost' size='sm' onClick={handleEnd} loading={endEngagement.isPending}>
            <XCircle /> End
          </Button>
        </div>
      )}

      <ConfirmDialog />
    </div>
  )
}
