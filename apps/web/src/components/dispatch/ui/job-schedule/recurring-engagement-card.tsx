// apps/web/src/components/dispatch/ui/job-schedule/recurring-engagement-card.tsx
'use client'

import { describeRecurrenceParts } from '@auxx/lib/recurrence/client'
import { Badge } from '@auxx/ui/components/badge'
import { Button } from '@auxx/ui/components/button'
import { toastError } from '@auxx/ui/components/toast'
import { TREE_SECONDARY_NOTRUNCATE, TreeRow, TreeRowButton } from '@auxx/ui/components/tree-row'
import { CalendarOff, Pause, Pencil, Play, Repeat, XCircle } from 'lucide-react'
import { useMemo } from 'react'
import { DetailSectionActions, DetailSectionTitleExtra } from '~/components/detail-view'
import type { RecordId } from '~/components/resources'
import { useConfirm } from '~/hooks/use-confirm'
import { useSettings } from '~/hooks/use-settings'
import { api } from '~/trpc/react'
import { scalarSetting } from '../recurrence/recurrence-utils'
import { type ExistingVisitForOverlap, SchedulePopover } from '../schedule-popover'
import { SeriesEndEditor, useSeriesRule } from './series-end'
import type { JobVisit } from './use-job-visits'

const DEFAULT_ENGAGEMENT_BADGE = { label: 'Active', variant: 'green' } as const
const ENGAGEMENT_BADGE: Record<string, { label: string; variant: 'green' | 'amber' | 'gray' }> = {
  active: DEFAULT_ENGAGEMENT_BADGE,
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
  /** All of the job's visits — skip count + the end editor's shorten-confirm count (plan 36). */
  visits: JobVisit[]
  onRefresh: () => void
}

/**
 * The Job view's recurring Schedule section variant (dispatch M2 build spec §F.3,
 * 04 mock): a borderless TreeRow with the recurrence frequency as title and the
 * end condition ("until Aug 29" / "12 visits") as secondary, rendered ABOVE the
 * primary visit card. The engagement badge and the Pause/Resume + Edit actions
 * are portaled into the surrounding Section header via `DetailSectionTitleExtra`
 * / `DetailSectionActions`; End stays a destructive hover action on the row.
 * Renders nothing pre-rule ("recurring, not yet scheduled" — `VisitCard`'s own Schedule
 * button/Repeats row is where that gets configured, 04-ui.md §7 jobType convergence).
 */
export function RecurringEngagementCard({
  recordId,
  status,
  canEdit,
  primaryVisit,
  existingVisits,
  visits,
  onRefresh,
}: RecurringEngagementCardProps) {
  const utils = api.useUtils()
  const [confirm, ConfirmDialog] = useConfirm()
  const { getSetting } = useSettings({ scope: 'GENERAL' })
  const weekStart = (scalarSetting(getSetting('organization.weekStart')) ?? 'monday') as
    | 'monday'
    | 'sunday'
    | 'saturday'

  const { rule, pattern, until, windowEmpty } = useSeriesRule(recordId)

  const summary = useMemo(() => {
    if (!pattern) return null
    return describeRecurrenceParts(pattern, { weekStart })
  }, [pattern, weekStart])

  const invalidate = () => {
    void utils.dispatch.getRecurrence.invalidate({
      workOrderRecordId: recordId,
    })
    onRefresh()
  }

  const pauseEngagement = api.dispatch.pauseEngagement.useMutation({
    onError: (error) =>
      toastError({
        title: 'Error pausing engagement',
        description: error.message,
      }),
    onSuccess: invalidate,
  })
  const resumeEngagement = api.dispatch.resumeEngagement.useMutation({
    onError: (error) =>
      toastError({
        title: 'Error resuming engagement',
        description: error.message,
      }),
    onSuccess: invalidate,
  })
  const endEngagement = api.dispatch.endEngagement.useMutation({
    onError: (error) =>
      toastError({
        title: 'Error ending engagement',
        description: error.message,
      }),
    onSuccess: invalidate,
  })

  if (!rule) return null

  const badge = ENGAGEMENT_BADGE[status] ?? DEFAULT_ENGAGEMENT_BADGE
  // Plan 36 §B.2/§B.4 — the always-visible series state: end date, skip count, and the
  // dead-window read-time guard ("Series ended" when a scope edit re-anchored the pattern
  // past its own end — nothing can generate even though the status may still read Active).
  const skipped = visits.filter(
    (visit) => visit.status === 'canceled' && visit.recurrenceRuleId
  ).length
  const endsLine = windowEmpty
    ? 'Series ended — no further visits will be generated'
    : [
        summary?.ends ?? (canEdit && status !== 'ended' ? 'no end date' : null),
        skipped > 0 ? `${skipped} skipped` : null,
      ]
        .filter(Boolean)
        .join(' · ')

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
    <div className={TREE_SECONDARY_NOTRUNCATE}>
      <DetailSectionTitleExtra>
        <Badge variant={badge.variant} size='xs'>
          {badge.label}
        </Badge>
      </DetailSectionTitleExtra>

      {canEdit && status !== 'ended' && (
        <DetailSectionActions>
          {status === 'paused' ? (
            <Button
              variant='outline'
              size='xs'
              disabled={resumeEngagement.isPending}
              onClick={() => resumeEngagement.mutate({ workOrderRecordId: recordId })}>
              <Play />
              Resume
            </Button>
          ) : (
            <Button
              variant='outline'
              size='xs'
              disabled={pauseEngagement.isPending}
              onClick={handlePause}>
              <Pause />
              Pause
            </Button>
          )}
          {primaryVisit && (
            <SchedulePopover
              trigger={
                <Button variant='outline' size='xs'>
                  <Pencil />
                  Edit
                </Button>
              }
              visitId={primaryVisit.id}
              initialStartTime={
                primaryVisit.startTime ? new Date(primaryVisit.startTime) : undefined
              }
              initialEndTime={primaryVisit.endTime ? new Date(primaryVisit.endTime) : undefined}
              initialAssigneeWorkerId={primaryVisit.assigneeWorkerId}
              existingVisits={existingVisits}
              workOrderRecordId={recordId}
              recurrenceRuleId={primaryVisit.recurrenceRuleId}
              onScheduled={invalidate}
              onUnscheduled={invalidate}
            />
          )}
        </DetailSectionActions>
      )}

      <TreeRow
        icon={<Repeat className='size-4' />}
        title={<span className='text-sm'>{summary?.frequency}</span>}
        secondary={
          endsLine ? <span className='text-xs text-muted-foreground'>{endsLine}</span> : undefined
        }
        actions={
          canEdit && status !== 'ended' ? (
            <>
              {/* Plan 36 §B.2 — the series end date is ownable here: set, move, or clear. */}
              <SeriesEndEditor
                workOrderRecordId={recordId}
                until={until}
                visits={visits}
                onChanged={() => {
                  invalidate()
                  onRefresh()
                }}
                trigger={
                  <TreeRowButton tooltipText={until ? 'Change end date' : 'Set end date'}>
                    <CalendarOff />
                  </TreeRowButton>
                }
              />
              <TreeRowButton
                variant='destructive'
                tooltipText='End engagement'
                disabled={endEngagement.isPending}
                onClick={handleEnd}>
                <XCircle />
              </TreeRowButton>
            </>
          ) : undefined
        }
      />

      <ConfirmDialog />
    </div>
  )
}
