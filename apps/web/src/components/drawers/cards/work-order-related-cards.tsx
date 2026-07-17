// apps/web/src/components/drawers/cards/work-order-related-cards.tsx
'use client'

// Work-order drawer overview blocks — the service_request precedent (uniform
// TreeRow blocks) applied to a job's Schedule (visits) and Invoices. The Schedule
// block's per-visit Schedule/Reschedule button reuses `SchedulePopover` (the header
// ScheduleWorkOrderAction); the Invoices block's row opens the shared
// `BillingActionDialog` billing-basis router (the header CreateInvoiceAction) via
// `resolveBillingAction` — the one next-action condition every billing surface shares
// (work-order invoice flow plan §5.3). Scheduling is admin-only, matching both the
// header action and the server-side `dispatchAdminProcedure` gate.

import { Button } from '@auxx/ui/components/button'
import { TreeRow } from '@auxx/ui/components/tree-row'
import { TreeRowList } from '@auxx/ui/components/tree-row-list'
import { ArrowRight, CreditCard, ExternalLink, History, Plus, Receipt } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { Fragment, useState } from 'react'
import { splitJobVisits } from '~/components/dispatch/ui/job-schedule/job-schedule-utils'
import { ScheduleVisitRow } from '~/components/dispatch/ui/job-schedule/schedule-visit-row'
import type { JobVisit } from '~/components/dispatch/ui/job-schedule/use-job-visits'
import { useJobVisits } from '~/components/dispatch/ui/job-schedule/use-job-visits'
import { SchedulePopover } from '~/components/dispatch/ui/schedule-popover'
import { DrawerCardActions } from '~/components/drawers/drawer-card-actions'
import { BillingActionDialog } from '~/components/money/billing/billing-action-dialog'
import { resolveBillingAction } from '~/components/money/billing/types'
import { useWorkOrderBillingState } from '~/components/money/billing/use-work-order-billing-state'
import { formatCurrency } from '~/components/money/ui/line-builder/shared'
import { useOpenRecord, useRecordDrill } from '~/components/records/record-drill-panels'
import type { DrawerTabProps } from '../drawer-tab-registry'
import { EmptyRow, RowSkeleton, TREE_SECONDARY_NOTRUNCATE } from './related-record-row'

// ─────────────────────────────────────────────────────────────────────────────
// Schedule block (visits + per-visit Reschedule/Cancel)
// ─────────────────────────────────────────────────────────────────────────────

/** How many visits render before the inline "Show more" row collapses the rest. */
const VISIT_PREVIEW_LIMIT = 5

export function WorkOrderScheduleCard({ recordId }: DrawerTabProps) {
  const drill = useRecordDrill()
  const { visits, isLoading, canEdit, mutations, existingVisits, refresh } = useJobVisits(recordId)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [addOpen, setAddOpen] = useState(false)

  const loading = isLoading && visits.length === 0
  const { upcoming, history } = splitJobVisits(visits)

  const renderVisitRow = (visit: JobVisit) => (
    <ScheduleVisitRow
      visit={visit}
      canEdit={canEdit}
      mutations={mutations}
      existingVisits={existingVisits}
      workOrderRecordId={recordId}
      onRefresh={refresh}
      onOpen={() => drill.open('visits', visit.id)}
    />
  )

  return (
    <div className={`space-y-0.5 ${TREE_SECONDARY_NOTRUNCATE}`}>
      {canEdit && (
        <DrawerCardActions>
          {/* CREATE-mode SchedulePopover (no visitId) — nothing exists until Schedule commits,
           * which creates + schedules the rule-less extra visit in one addVisit call. */}
          <SchedulePopover
            open={addOpen}
            onOpenChange={setAddOpen}
            workOrderRecordId={recordId}
            existingVisits={existingVisits}
            onScheduled={() => {
              setAddOpen(false)
              refresh()
            }}
            trigger={
              <Button variant='ghost' size='xs'>
                <Plus /> Add visit
              </Button>
            }
          />
        </DrawerCardActions>
      )}
      {!loading && !visits.length ? (
        <EmptyRow label='No visits yet' />
      ) : (
        <TreeRowList
          items={upcoming}
          loading={loading}
          getKey={(visit) => visit.id}
          visibleLimit={VISIT_PREVIEW_LIMIT}
          renderRow={renderVisitRow}
        />
      )}
      {history.length > 0 && (
        <TreeRow
          icon={<History className='size-4' />}
          rowClassName='hover:bg-primary-100'
          title={<span className='text-sm text-muted-foreground'>{history.length} in history</span>}
          expandable
          isOpen={historyOpen}
          onToggleOpen={() => setHistoryOpen((open) => !open)}>
          {history.map((visit) => (
            <Fragment key={visit.id}>{renderVisitRow(visit)}</Fragment>
          ))}
        </TreeRow>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Invoices block (+ header-parity "Create invoice")
// ─────────────────────────────────────────────────────────────────────────────

export function WorkOrderBillingCard({ recordId, entityInstanceId }: DrawerTabProps) {
  const [dialogOpen, setDialogOpen] = useState(false)
  const { billing, isLoading } = useWorkOrderBillingState(recordId)
  const openRecord = useOpenRecord()
  const router = useRouter()
  const action = resolveBillingAction(billing)
  const doneExtraVisitCount = new Set(
    billing.extraWork.filter((row) => row.visitStatus === 'done').map((row) => row.visitId)
  ).size
  const isActionable =
    action.kind === 'create' || action.kind === 'create_extra' || action.kind === 'review_draft'
  const handleToggleOpen = () => {
    if (action.kind === 'review_draft' && action.draftInvoiceRecordId) {
      openRecord?.(action.draftInvoiceRecordId)
      return
    }
    setDialogOpen(true)
  }

  if (isLoading) return <RowSkeleton />

  return (
    <div className={`space-y-0.5 ${TREE_SECONDARY_NOTRUNCATE}`}>
      <div className='grid grid-cols-2 gap-2 pb-2 text-xs'>
        <div>
          <span className='block text-muted-foreground'>Balance due</span>
          <span className='font-medium tabular-nums'>
            {formatCurrency(billing.balanceDue, billing.currencyCode)}
          </span>
        </div>
        <div>
          <span className='block text-muted-foreground'>Uninvoiced</span>
          <span className='font-medium tabular-nums'>
            {formatCurrency(billing.remaining, billing.currencyCode)}
          </span>
        </div>
      </div>
      <TreeRow
        rowClassName='hover:bg-primary-100'
        icon={<CreditCard className='size-4' />}
        title={<span className='text-sm font-medium'>{billing.state.replaceAll('_', ' ')}</span>}
        secondary={
          <span className='text-xs'>
            {billing.eligibleVisits.length
              ? `${billing.eligibleVisits.length} eligible visit${billing.eligibleVisits.length === 1 ? '' : 's'}`
              : action.kind === 'create_extra'
                ? `Extra work on ${doneExtraVisitCount} visit${doneExtraVisitCount === 1 ? '' : 's'}`
                : billing.nextInvoiceDate
                  ? new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(
                      new Date(billing.nextInvoiceDate)
                    )
                  : 'No action required'}
          </span>
        }
        trailing={isActionable ? <ArrowRight className='size-4' /> : undefined}
        onToggleOpen={isActionable ? handleToggleOpen : undefined}
      />
      {billing.invoices.slice(0, 3).map((invoice) => (
        <TreeRow
          key={invoice.recordId}
          rowClassName='hover:bg-primary-100'
          icon={<Receipt className='size-4' />}
          title={<span className='text-sm'>{invoice.displayName}</span>}
          secondary={
            <span className='text-xs'>
              {invoice.status} · {formatCurrency(invoice.total, billing.currencyCode)}
            </span>
          }
          onToggleOpen={() => openRecord?.(invoice.recordId)}
        />
      ))}
      <TreeRow
        rowClassName='hover:bg-primary-100'
        icon={<ExternalLink className='size-4' />}
        title={<span className='text-sm text-muted-foreground'>View full billing</span>}
        onToggleOpen={() => router.push(`/app/work-orders/${entityInstanceId}?tab=billing`)}
      />
      <BillingActionDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        workOrderRecordId={recordId}
        billing={billing}
        mode={action.kind === 'create_extra' ? 'extra' : 'primary'}
      />
    </div>
  )
}
