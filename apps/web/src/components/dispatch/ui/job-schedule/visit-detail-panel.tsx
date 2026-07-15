// apps/web/src/components/dispatch/ui/job-schedule/visit-detail-panel.tsx
'use client'

import { FieldType } from '@auxx/database/enums'
import { toActorId } from '@auxx/types/actor'
import { Avatar, AvatarFallback, AvatarImage } from '@auxx/ui/components/avatar'
import { Badge } from '@auxx/ui/components/badge'
import { Button } from '@auxx/ui/components/button'
import { ScrollArea } from '@auxx/ui/components/scroll-area'
import { toastError } from '@auxx/ui/components/toast'
import { format } from 'date-fns'
import { CalendarClock, ReceiptText, Send, User, XCircle } from 'lucide-react'
import { useState } from 'react'
import { FieldInputAdapter } from '~/components/fields/inputs/field-input-adapter'
import { FieldPanel, FieldPanelRow } from '~/components/global/forms/field-panel'
import { getInitials } from '~/components/groups/utils/group-utils'
import { LineBuilder } from '~/components/money/ui/line-builder/line-builder'
import { TuckedLabel } from '~/components/money/ui/tucked-label'
import type { RecordDrillContext } from '~/components/records/record-drill-panels'
import { useActors } from '~/components/resources/hooks/use-actor'
import { BaseType } from '~/components/workflow/types'
import { useConfirm } from '~/hooks/use-confirm'
import { api } from '~/trpc/react'
import { VISIT_STATUS_LABELS, type VisitStatus } from '../board/types'
import { SchedulePopover } from '../schedule-popover'
import {
  isPastVisit,
  resolveVisitDurationMinutes,
  VISIT_STATUS_BADGE_VARIANT,
} from './job-schedule-utils'
import { useJobVisits } from './use-job-visits'
import { VisitDateBlock } from './visit-date-block'
import { VisitProofOfWork } from './visit-proof-of-work'

/**
 * VisitDetailPanel — the third stack level (`visits:item`), dispatch M2 build
 * spec §F.3: full visit info, the per-visit proof-of-work block (worker-captured
 * QC checklist notes/photos, read-only — plan 17 Part A, `VisitProofOfWork`), the
 * visit line items block (occurrence extras — money 01-ui #13, `visitId`-scoped
 * `LineBuilder`, plan 17 Part B), and the row actions.
 */
export function VisitDetailPanel({ recordId, itemId }: RecordDrillContext) {
  const { visits, isLoading, canEdit, mutations, existingVisits, refresh } = useJobVisits(recordId)
  const visit = visits.find((v) => v.id === itemId)
  const [confirm, ConfirmDialog] = useConfirm()
  // Plan 20 §4.1a — explicit duration write. Never touches the schedule; draft state so a
  // blur/Enter commits and an Escape reverts without re-render churn on every keystroke.
  const [durationDraft, setDurationDraft] = useState<number | undefined | null>(null)
  const setVisitDuration = api.dispatch.setVisitDuration.useMutation({
    onError: (error) => toastError({ title: 'Error saving duration', description: error.message }),
    onSuccess: refresh,
  })

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
  const resolvedDurationMinutes = resolveVisitDurationMinutes(visit)
  const isHistory = isPastVisit(visit)
  const start = visit.startTime ? new Date(visit.startTime) : null
  const end = visit.endTime ? new Date(visit.endTime) : null
  const isProvisionalTime = Boolean(start) && visit.timeConfirmedAt == null

  const commitDuration = () => {
    if (durationDraft === null) return
    setDurationDraft(null)
    const nextValue = durationDraft ?? null
    if (nextValue !== null && (Number.isNaN(nextValue) || nextValue < 1 || nextValue > 1440)) return
    if (nextValue === (visit.durationMinutes ?? null)) return
    setVisitDuration.mutate({ visitId: visit.id, durationMinutes: nextValue })
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
    <ScrollArea className='h-full' scrollbarClassName='w-1.5 z-20' noFade>
      <div className='flex flex-col gap-4 p-4'>
        <div className='flex items-center gap-3'>
          <VisitDateBlock startTime={visit.startTime} />
          <div className='min-w-0 flex-1'>
            <div className='flex items-center gap-2 text-sm font-medium'>
              <span className='truncate'>
                {start ? `Visit · ${format(start, 'EEE, MMM d')}` : 'Not scheduled yet'}
              </span>
              <Badge variant={VISIT_STATUS_BADGE_VARIANT[visit.status] ?? 'default'} size='sm'>
                {VISIT_STATUS_LABELS[visit.status as VisitStatus] ?? visit.status}
              </Badge>
            </div>
            <div className='flex items-center gap-2 text-sm text-muted-foreground'>
              {start && (
                <span
                  title={
                    isProvisionalTime ? 'Estimated from route plan — not confirmed' : undefined
                  }>
                  {isProvisionalTime && '~'}
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
            {!isHistory && (
              <>
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
              </>
            )}
          </div>
        )}

        {/* Intended on-site duration (plan 20 §4.1a). An explicit value overrides the resolved
            fallback (scheduled span, then 60 minutes), without changing the schedule itself. */}
        <FieldPanel className='p-0'>
          <FieldPanelRow title='Duration' type={BaseType.NUMBER} showIcon>
            <div
              onBlur={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget)) commitDuration()
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.currentTarget.querySelector<HTMLInputElement>('input')?.blur()
                }
                if (event.key === 'Escape') setDurationDraft(null)
              }}>
              <FieldInputAdapter
                fieldType={FieldType.NUMBER}
                value={
                  durationDraft === null ? (visit.durationMinutes ?? undefined) : durationDraft
                }
                onChange={(value) => setDurationDraft(value as number | undefined)}
                placeholder={`${resolvedDurationMinutes} min (default)`}
                disabled={!canEdit || setVisitDuration.isPending}
              />
            </div>
          </FieldPanelRow>
        </FieldPanel>

        {/* Per-visit proof of work — the worker's captured QC checklist (notes + photos),
            read-only dispatcher-side. Authoring stays on the worker surface's Notes tab. */}
        <VisitProofOfWork visitId={visit.id} />

        {/* Visit line items (occurrence extras) — money 01-ui #13: the shared LineBuilder
            scoped to this visit via `visitId` (stamps/filters `line_item_visit_id`, the
            plain-text bridge — visits aren't entities). Canceled visits are read-only.
            TuckedLabel + card, matching the proof-of-work block above. */}
        <div className='flex flex-col'>
          <TuckedLabel icon={<ReceiptText />}>This visit's extras</TuckedLabel>
          <LineBuilder
            documentRecordId={recordId}
            documentType='work_order'
            visitId={visit.id}
            readOnly={!canEdit || visit.status === 'canceled'}
          />
        </div>

        <ConfirmDialog />
      </div>
    </ScrollArea>
  )
}
