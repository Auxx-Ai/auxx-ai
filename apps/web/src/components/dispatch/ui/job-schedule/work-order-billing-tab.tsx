// apps/web/src/components/dispatch/ui/job-schedule/work-order-billing-tab.tsx
'use client'

import { BILLING_BASIS_LABELS, BILLING_TIMING_LABELS } from '@auxx/lib/money/client'
import { Badge } from '@auxx/ui/components/badge'
import { Button } from '@auxx/ui/components/button'
import { EmptySection } from '@auxx/ui/components/section'
import { Skeleton } from '@auxx/ui/components/skeleton'
import { TREE_SECONDARY_NOTRUNCATE } from '@auxx/ui/components/tree-row'
import { TreeRowList } from '@auxx/ui/components/tree-row-list'
import { TuckedSection } from '@auxx/ui/components/tucked-label'
import { cn } from '@auxx/ui/lib/utils'
import { CreditCard, Receipt } from 'lucide-react'
import { useMemo, useState } from 'react'
import type { DetailViewTabProps } from '~/components/detail-view'
import { BillingActionDialog } from '~/components/money/billing/billing-action-dialog'
import { BillingPlanDialog } from '~/components/money/billing/billing-plan-dialog'
import { BillingScheduleDialog } from '~/components/money/billing/billing-schedule-dialog'
import { BillingSummaryStrip } from '~/components/money/billing/billing-summary-strip'
import { InvoiceTreeRow } from '~/components/money/billing/invoice-tree-row'
import { NewWorkOrderInvoiceButton } from '~/components/money/billing/new-work-order-invoice-button'
import { resolveBillingAction, type WorkOrderBillingView } from '~/components/money/billing/types'
import { useWorkOrderBillingState } from '~/components/money/billing/use-work-order-billing-state'
import { formatCurrency } from '~/components/money/ui/line-builder/shared'
import { useRecordDrill } from '~/components/records/record-drill-panels'
import { api } from '~/trpc/react'
import { BillingScheduleRow } from './billing-schedule-row'
import type { PaymentCandidate } from './work-order-billing-payments-block'
import { WorkOrderBillingPaymentsBlock } from './work-order-billing-payments-block'

export function WorkOrderBillingTab({ recordId, variant = 'tab' }: DetailViewTabProps) {
  const [actionOpen, setActionOpen] = useState(false)
  const [extraOpen, setExtraOpen] = useState(false)
  const [planOpen, setPlanOpen] = useState(false)
  const [scheduleOpen, setScheduleOpen] = useState(false)
  const { billing, isLoading } = useWorkOrderBillingState(recordId)
  const utils = api.useUtils()
  // In-place invoice drill (the schedule-visit pattern) — `?panel=invoices&item=<recordId>`
  // pushes the InvoiceDetailPanel over this page/drawer surface.
  const drill = useRecordDrill()
  const isSection = variant === 'section'
  const paymentCandidates: PaymentCandidate[] = useMemo(
    () =>
      billing.invoices
        .filter((invoice) => invoice.status !== 'void' && invoice.balance > 0)
        .map((invoice) => ({
          recordId: invoice.recordId,
          balance: invoice.balance,
          displayName: invoice.displayName,
        })),
    [billing.invoices]
  )

  if (isLoading) return <BillingSkeleton />

  return (
    <div className={cn('flex flex-col', !isSection && 'h-full min-h-0')}>
      {/* Section variant: `pe-3` matches the Line-items section's right inset so
          the whole page column shares one right edge, clear of the scrollbar. */}
      <div
        className={cn(
          'flex flex-col gap-4 py-2',
          isSection ? 'overflow-auto pe-3' : 'min-h-0 flex-1 overflow-auto'
        )}>
        <BillingSummaryStrip billing={billing} className='border-b pb-4' />
        <NextAction
          billing={billing}
          onAction={() => setActionOpen(true)}
          onExtra={() => setExtraOpen(true)}
        />

        <TuckedSection
          label='Billing plan'
          action={
            <Button variant='ghost' size='xs' onClick={() => setPlanOpen(true)}>
              Edit billing plan
            </Button>
          }>
          <div className='grid gap-3 p-3 text-sm sm:grid-cols-3'>
            <PlanValue label='Basis' value={BILLING_BASIS_LABELS[billing.basis]} />
            <PlanValue label='Timing' value={BILLING_TIMING_LABELS[billing.timing]} />
            <PlanValue
              label='Automation'
              value={
                billing.nextInvoiceDate
                  ? `Next ${formatDate(billing.nextInvoiceDate)}`
                  : 'No date scheduled'
              }
            />
          </div>
          {billing.timing === 'custom_schedule' && (
            <BillingScheduleRow workOrderRecordId={recordId} invoiceTiming={billing.timing} />
          )}
        </TuckedSection>

        {billing.basis === 'fixed_contract' && (
          <TuckedSection
            label='Payment schedule'
            action={
              <Button variant='ghost' size='xs' onClick={() => setScheduleOpen(true)}>
                {billing.installments.length > 0 ? 'Edit schedule' : 'Set up payment schedule'}
              </Button>
            }>
            {billing.installments.length === 0 ? (
              <p className='p-3 text-sm text-muted-foreground'>No payment schedule configured.</p>
            ) : (
              <div className='divide-y'>
                {billing.installments.map((item) => (
                  <div
                    key={item.id}
                    className='flex items-center justify-between gap-3 px-3 py-2 text-sm'>
                    <span>
                      <span className='font-medium'>{item.name}</span>
                      {item.scheduledDate && (
                        <span className='ml-2 text-muted-foreground'>
                          {formatDate(item.scheduledDate)}
                        </span>
                      )}
                    </span>
                    <span className='flex items-center gap-2'>
                      <Badge variant='outline' size='sm'>
                        {item.status}
                      </Badge>
                      <span className='tabular-nums'>
                        {formatCurrency(item.amount, billing.currencyCode)}
                      </span>
                    </span>
                  </div>
                ))}
              </div>
            )}
          </TuckedSection>
        )}

        <TuckedSection label='Uninvoiced work'>
          <UninvoicedWork
            billing={billing}
            onPrimary={() => setActionOpen(true)}
            onExtra={() => setExtraOpen(true)}
          />
        </TuckedSection>

        <TuckedSection
          label='Invoices'
          action={
            <NewWorkOrderInvoiceButton
              workOrderRecordId={recordId}
              onOpenInvoice={(invoiceRecordId) => drill.open('invoices', invoiceRecordId)}
            />
          }>
          <InvoiceRows billing={billing} />
        </TuckedSection>

        <TuckedSection label='Payments'>
          <WorkOrderBillingPaymentsBlock
            workOrderRecordId={recordId}
            candidates={paymentCandidates}
            currencyCode={billing.currencyCode}
            onSettled={() =>
              void utils.money.getWorkOrderBillingState.invalidate({ workOrderRecordId: recordId })
            }
          />
        </TuckedSection>
      </div>

      <BillingActionDialog
        open={actionOpen}
        onOpenChange={setActionOpen}
        workOrderRecordId={recordId}
        billing={billing}
      />
      <BillingPlanDialog
        open={planOpen}
        onOpenChange={setPlanOpen}
        workOrderRecordId={recordId}
        basis={billing.basis}
        timing={billing.timing}
      />
      <BillingScheduleDialog
        open={scheduleOpen}
        onOpenChange={setScheduleOpen}
        workOrderRecordId={recordId}
        billing={billing}
      />
      <BillingActionDialog
        open={extraOpen}
        onOpenChange={setExtraOpen}
        workOrderRecordId={recordId}
        billing={billing}
        mode='extra'
      />
    </div>
  )
}

function NextAction({
  billing,
  onAction,
  onExtra,
}: {
  billing: WorkOrderBillingView
  onAction: () => void
  onExtra: () => void
}) {
  const drill = useRecordDrill()
  const action = resolveBillingAction(billing)
  const handleClick = () => {
    if (action.kind === 'create') return onAction()
    if (action.kind === 'create_extra') return onExtra()
    if (action.kind === 'review_draft') {
      if (action.draftInvoiceRecordId) return drill.open('invoices', action.draftInvoiceRecordId)
      return onAction()
    }
    if (action.kind === 'view_invoices') {
      const target = billing.invoices[0]
      if (target) drill.open('invoices', target.recordId)
    }
  }
  return (
    <div className='flex items-center justify-between gap-4 rounded-xl border bg-primary-100 p-3'>
      <div className='flex min-w-0 items-start gap-3'>
        <div className='rounded-md border bg-background p-2'>
          <CreditCard className='size-4' />
        </div>
        <div>
          <div className='flex items-center gap-2'>
            <span className='font-medium text-sm'>Next action</span>
            <BillingStateBadge state={billing.state} />
          </div>
          <p className='mt-0.5 text-xs text-muted-foreground'>{nextActionDescription(billing)}</p>
        </div>
      </div>
      {action.kind !== 'none' && (
        <Button variant='outline' size='sm' onClick={handleClick}>
          {action.label}
        </Button>
      )}
    </div>
  )
}

/** The two billing streams rendered distinctly (plan money/19 §F): the base
 * (contract/visit/period) row, a done-visit extra-work row, and a muted hint for extras staged
 * on visits that haven't happened yet — deliberately billable, never claimed as ready. */
function UninvoicedWork({
  billing,
  onPrimary,
  onExtra,
}: {
  billing: WorkOrderBillingView
  onPrimary: () => void
  onExtra: () => void
}) {
  const doneExtras = billing.extraWork.filter((row) => row.visitStatus === 'done')
  const plannedExtras = billing.extraWork.filter((row) => row.visitStatus !== 'done')
  const doneExtraVisitCount = new Set(doneExtras.map((row) => row.visitId)).size
  const doneExtraTotal = doneExtras.reduce((sum, row) => sum + row.amount, 0)
  const plannedExtraTotal = plannedExtras.reduce((sum, row) => sum + row.amount, 0)
  const showBase =
    billing.basis === 'per_visit' ? billing.eligibleVisits.length > 0 : billing.remaining > 0
  const extraIsPrimary = resolveBillingAction(billing).kind === 'create_extra'

  if (!showBase && billing.extraWork.length === 0) {
    return (
      <p className='p-3 text-sm text-muted-foreground'>
        {billing.basis === 'fixed_contract'
          ? 'This contract is fully invoiced.'
          : billing.basis === 'recurring_flat' && billing.nextInvoiceDate
            ? `The next draft is scheduled for ${formatDate(billing.nextInvoiceDate)}.`
            : 'No completed visits are ready to invoice.'}
      </p>
    )
  }
  return (
    <div className='divide-y'>
      {showBase && (
        <div className='flex items-center justify-between gap-3 p-3 text-sm'>
          <div>
            <div className='font-medium'>
              {billing.basis === 'per_visit'
                ? `${billing.eligibleVisits.length} eligible visit${billing.eligibleVisits.length === 1 ? '' : 's'}`
                : formatCurrency(billing.remaining, billing.currencyCode)}
            </div>
            <div className='text-xs text-muted-foreground'>
              {billing.basis === 'per_visit'
                ? formatCurrency(
                    billing.eligibleVisits.reduce((sum, visit) => sum + visit.amount, 0),
                    billing.currencyCode
                  )
                : 'Available for the next invoice'}
            </div>
          </div>
          <Button variant='outline' size='sm' onClick={onPrimary}>
            Create invoice
          </Button>
        </div>
      )}
      {doneExtras.length > 0 && (
        <div className='flex items-center justify-between gap-3 p-3 text-sm'>
          <div>
            <div className='font-medium'>
              Extra work on {doneExtraVisitCount} visit{doneExtraVisitCount === 1 ? '' : 's'}
            </div>
            <div className='text-xs text-muted-foreground'>
              {formatCurrency(doneExtraTotal, billing.currencyCode)}
            </div>
          </div>
          <Button variant={extraIsPrimary ? 'outline' : 'ghost'} size='sm' onClick={onExtra}>
            Invoice extra work
          </Button>
        </div>
      )}
      {plannedExtras.length > 0 && (
        <div className='flex items-center justify-between gap-3 p-3 text-sm'>
          <p className='text-xs text-muted-foreground'>
            {formatCurrency(plannedExtraTotal, billing.currencyCode)} staged on upcoming visits
          </p>
          {doneExtras.length === 0 && (
            <Button variant='ghost' size='sm' onClick={onExtra}>
              Invoice extra work
            </Button>
          )}
        </div>
      )}
    </div>
  )
}

/** How many invoices render before the inline "Show more" row collapses the rest. */
const INVOICE_PREVIEW_LIMIT = 5

/** Single-line invoice rows — the same `TreeRow` recipe as the work-order
 * drawer's Billing section (`WorkOrderBillingCard`), capped behind the shared
 * `TreeRowList` show-more collapse. */
function InvoiceRows({ billing }: { billing: WorkOrderBillingView }) {
  const drill = useRecordDrill()
  if (billing.invoices.length === 0)
    return (
      <EmptySection
        icon={<Receipt className='size-5' />}
        title='No invoices yet'
        description='Create an invoice to get started.'
      />
    )
  return (
    <div className='p-1.5'>
      <TreeRowList
        items={billing.invoices}
        getKey={(invoice) => invoice.recordId}
        visibleLimit={INVOICE_PREVIEW_LIMIT}
        className={`space-y-0.5 ${TREE_SECONDARY_NOTRUNCATE}`}
        renderRow={(invoice) => (
          <InvoiceTreeRow
            invoice={invoice}
            currencyCode={billing.currencyCode}
            onOpen={() => drill.open('invoices', invoice.recordId)}
          />
        )}
      />
    </div>
  )
}

function PlanValue({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className='text-xs text-muted-foreground'>{label}</div>
      <div className='font-medium'>{value}</div>
    </div>
  )
}
function BillingStateBadge({ state }: { state: string }) {
  return (
    <Badge
      variant={
        state === 'attention_required'
          ? 'destructive'
          : state === 'ready_to_invoice'
            ? 'default'
            : 'outline'
      }
      size='sm'>
      {state.replaceAll('_', ' ')}
    </Badge>
  )
}
function BillingSkeleton() {
  return (
    <div className='space-y-3 py-2'>
      <Skeleton className='h-12 w-full' />
      <Skeleton className='h-20 w-full' />
      <Skeleton className='h-28 w-full' />
    </div>
  )
}
function nextActionDescription(billing: WorkOrderBillingView) {
  if (billing.state === 'attention_required')
    return 'The billing plan needs attention before another invoice can be created.'
  if (billing.state === 'draft_pending') return 'An editable invoice draft is waiting for review.'
  if (billing.state === 'awaiting_payment')
    return `${formatCurrency(billing.balanceDue, billing.currencyCode)} remains due on issued invoices.`
  if (billing.state === 'scheduled' && billing.nextInvoiceDate)
    return `The next draft is scheduled for ${formatDate(billing.nextInvoiceDate)}.`
  if (billing.state === 'ready_to_invoice') {
    if (billing.eligibleVisits.length) {
      return `${billing.eligibleVisits.length} completed visit${billing.eligibleVisits.length === 1 ? '' : 's'} can be invoiced.`
    }
    const extraVisitCount = new Set(
      billing.extraWork.filter((row) => row.visitStatus === 'done').map((row) => row.visitId)
    ).size
    if (extraVisitCount > 0) {
      return `Extra work on ${extraVisitCount} visit${extraVisitCount === 1 ? '' : 's'} can be invoiced.`
    }
    return `${formatCurrency(billing.remaining, billing.currencyCode)} is ready to invoice.`
  }
  return 'No billing action is currently required.'
}
function formatDate(value: string) {
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(value))
}

export default WorkOrderBillingTab
