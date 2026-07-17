// apps/web/src/components/dispatch/ui/job-schedule/visit-detail-panel.tsx
'use client'

import { FieldType } from '@auxx/database/enums'
import { toActorId } from '@auxx/types/actor'
import { type RecordId, toRecordId } from '@auxx/types/resource'
import { Avatar, AvatarFallback, AvatarImage } from '@auxx/ui/components/avatar'
import { Badge } from '@auxx/ui/components/badge'
import { Button } from '@auxx/ui/components/button'
import { ScrollArea } from '@auxx/ui/components/scroll-area'
import { toastError } from '@auxx/ui/components/toast'
import { TuckedSection } from '@auxx/ui/components/tucked-label'
import { format } from 'date-fns'
import {
  CalendarClock,
  CircleDollarSign,
  ReceiptText,
  RotateCcw,
  Send,
  User,
  XCircle,
} from 'lucide-react'
import { useState } from 'react'
import { FieldInputAdapter } from '~/components/fields/inputs/field-input-adapter'
import { FieldPanel, FieldPanelRow } from '~/components/global/forms/field-panel'
import { getInitials } from '~/components/groups/utils/group-utils'
import { BillingActionDialog } from '~/components/money/billing/billing-action-dialog'
import { useWorkOrderBillingState } from '~/components/money/billing/use-work-order-billing-state'
import { LineBuilder } from '~/components/money/ui/line-builder/line-builder'
import { type RecordDrillContext, useOpenRecord } from '~/components/records/record-drill-panels'
import { useActors } from '~/components/resources/hooks/use-actor'
import { BaseType } from '~/components/workflow/types'
import { useConfirm } from '~/hooks/use-confirm'
import { api } from '~/trpc/react'
import { visitStatusLabel } from '../board/types'
import { SchedulePopover } from '../schedule-popover'
import {
  isVisitDispatchable,
  movedFromLabel,
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
  const openRecord = useOpenRecord()
  // Plan 20 §4.1a — explicit duration write. Never touches the schedule; draft state so a
  // blur/Enter commits and an Escape reverts without re-render churn on every keystroke.
  const [durationDraft, setDurationDraft] = useState<number | undefined | null>(null)
  const [billingOpen, setBillingOpen] = useState(false)
  const { billing } = useWorkOrderBillingState(recordId)
  const setVisitDuration = api.dispatch.setVisitDuration.useMutation({
    onError: (error) => toastError({ title: 'Error saving duration', description: error.message }),
    onSuccess: refresh,
  })
  const utils = api.useUtils()
  const addExtrasToContract = api.money.addVisitExtrasToContract.useMutation({
    onSuccess: () =>
      utils.money.getWorkOrderBillingState.invalidate({ workOrderRecordId: recordId }),
    onError: (error) =>
      toastError({ title: 'Error adding extras to contract', description: error.message }),
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

  const isSeries = Boolean(visit.recurrenceRuleId)
  const canCancel = visit.status !== 'canceled' && visit.status !== 'done'
  const canRestore = visit.status === 'canceled'
  const resolvedDurationMinutes = resolveVisitDurationMinutes(visit)
  const moved = movedFromLabel(visit)
  const start = visit.startTime ? new Date(visit.startTime) : null
  const end = visit.endTime ? new Date(visit.endTime) : null
  const isProvisionalTime = Boolean(start) && visit.timeConfirmedAt == null
  const billingVisit = visit as typeof visit & {
    invoiceState?: 'uninvoiced' | 'drafted' | 'invoiced'
    invoiceCount?: number
    invoiceId?: string
  }
  const invoiceState = billingVisit.invoiceState ?? 'uninvoiced'
  const invoiceLabel =
    visit.status !== 'done'
      ? 'Not ready'
      : invoiceState === 'drafted'
        ? 'In draft'
        : invoiceState === 'invoiced'
          ? 'Invoiced'
          : 'Ready to invoice'

  const commitDuration = () => {
    if (durationDraft === null) return
    setDurationDraft(null)
    const nextValue = durationDraft ?? null
    if (nextValue !== null && (Number.isNaN(nextValue) || nextValue < 1 || nextValue > 1440)) return
    if (nextValue === (visit.durationMinutes ?? null)) return
    setVisitDuration.mutate({ visitId: visit.id, durationMinutes: nextValue })
  }

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
                {visitStatusLabel(visit.status, visit.recurrenceRuleId)}
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
            {moved && <div className='text-xs text-muted-foreground'>{moved}</div>}
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
            {canRestore && (
              <Button
                variant='outline'
                size='sm'
                loading={mutations.restoreVisit.isPending}
                onClick={() => mutations.restoreVisit.mutate({ visitId: visit.id })}>
                <RotateCcw /> Restore
              </Button>
            )}
            {isVisitDispatchable(visit) && (
              <Button
                variant='outline'
                size='sm'
                onClick={() => mutations.dispatchVisit.mutate({ visitId: visit.id })}
                loading={mutations.dispatchVisit.isPending}
                disabled={!visit.assigneeUserId}>
                <Send /> {visit.dispatchedAt ? 'Re-dispatch' : 'Dispatch'}
              </Button>
            )}
            {canCancel && (
              <Button variant='ghost' size='sm' onClick={handleCancel}>
                <XCircle /> {isSeries ? 'Skip visit' : 'Cancel visit'}
              </Button>
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

        <div className='flex items-center justify-between gap-3 rounded-xl border bg-primary-100 p-3'>
          <div className='flex min-w-0 items-center gap-2'>
            <CircleDollarSign className='size-4 shrink-0 text-muted-foreground' />
            <div>
              <div className='text-sm font-medium'>{invoiceLabel}</div>
              {(billingVisit.invoiceCount ?? 0) > 1 && (
                <div className='text-xs text-muted-foreground'>
                  {billingVisit.invoiceCount} linked invoices
                </div>
              )}
            </div>
          </div>
          {billing.basis === 'per_visit' &&
            visit.status === 'done' &&
            invoiceState === 'uninvoiced' && (
              <Button variant='outline' size='sm' onClick={() => setBillingOpen(true)}>
                Invoice this visit
              </Button>
            )}
          {billingVisit.invoiceId && (billingVisit.invoiceCount ?? 0) === 1 && (
            <Button
              variant='ghost'
              size='sm'
              onClick={() =>
                openRecord?.(
                  billingVisit.invoiceId!.includes(':')
                    ? (billingVisit.invoiceId as RecordId)
                    : toRecordId('invoice', billingVisit.invoiceId!)
                )
              }>
              View invoice
            </Button>
          )}
          {billing.basis === 'fixed_contract' &&
            billing.extraWorkVisitIds.includes(visit.id) &&
            invoiceState === 'uninvoiced' && (
              <div className='flex gap-2'>
                <Button
                  variant='ghost'
                  size='sm'
                  loading={addExtrasToContract.isPending}
                  loadingText='Adding...'
                  onClick={() =>
                    addExtrasToContract.mutate({ workOrderRecordId: recordId, visitId: visit.id })
                  }>
                  Add to contract
                </Button>
                <Button variant='outline' size='sm' onClick={() => setBillingOpen(true)}>
                  Bill as extra work
                </Button>
              </div>
            )}
        </div>

        {/* Visit line items (occurrence extras) — money 01-ui #13: the shared LineBuilder
            scoped to this visit via `visitId` (stamps/filters `line_item_visit_id`, the
            plain-text bridge — visits aren't entities). Canceled visits are read-only.
            TuckedLabel + card, matching the proof-of-work block above. */}
        <TuckedSection
          icon={<ReceiptText />}
          label="This visit's extras"
          // LineBuilder brings its own framed box, so strip the wrapper card and
          // bump the frame's radius to match the tucked look.
          contentClassName='border-0 bg-transparent p-0 [&_[data-slot=line-builder-frame]]:rounded-xl'>
          <LineBuilder
            documentRecordId={recordId}
            documentType='work_order'
            visitId={visit.id}
            readOnly={!canEdit || visit.status === 'canceled'}
          />
        </TuckedSection>

        <ConfirmDialog />
        <BillingActionDialog
          open={billingOpen}
          onOpenChange={setBillingOpen}
          workOrderRecordId={recordId}
          billing={billing}
          initialVisitIds={[visit.id]}
          mode={billing.basis === 'fixed_contract' ? 'extra' : 'primary'}
        />
      </div>
    </ScrollArea>
  )
}
