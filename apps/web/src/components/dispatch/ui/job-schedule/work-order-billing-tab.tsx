// apps/web/src/components/dispatch/ui/job-schedule/work-order-billing-tab.tsx
'use client'

import { BILLING_BASIS_LABELS, BILLING_TIMING_LABELS } from '@auxx/lib/money/client'
import { Badge } from '@auxx/ui/components/badge'
import { Button } from '@auxx/ui/components/button'
import { Skeleton } from '@auxx/ui/components/skeleton'
import { TuckedSection } from '@auxx/ui/components/tucked-label'
import { cn } from '@auxx/ui/lib/utils'
import { CreditCard, ExternalLink, ReceiptText } from 'lucide-react'
import { useMemo, useState } from 'react'
import type { DetailViewTabProps } from '~/components/detail-view'
import { BillingActionDialog } from '~/components/money/billing/billing-action-dialog'
import { BillingPlanDialog } from '~/components/money/billing/billing-plan-dialog'
import { BillingScheduleDialog } from '~/components/money/billing/billing-schedule-dialog'
import { resolveBillingAction, type WorkOrderBillingView } from '~/components/money/billing/types'
import { useWorkOrderBillingState } from '~/components/money/billing/use-work-order-billing-state'
import { formatCurrency } from '~/components/money/ui/line-builder/shared'
import { useOpenRecord } from '~/components/records/record-drill-panels'
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
        <SummaryStrip billing={billing} />
        <NextAction billing={billing} onAction={() => setActionOpen(true)} />

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

        <TuckedSection label='Invoices'>
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
        initialVisitIds={billing.extraWorkVisitIds}
      />
    </div>
  )
}

function SummaryStrip({ billing }: { billing: WorkOrderBillingView }) {
  const firstLabel =
    billing.basis === 'fixed_contract'
      ? 'Contract value'
      : billing.basis === 'per_visit'
        ? 'Default visit price'
        : 'Rate per billing period'
  const showDepositHeld = billing.depositHeld > 0
  return (
    <div
      className={cn(
        'grid grid-cols-2 gap-3 border-b pb-4',
        showDepositHeld ? 'sm:grid-cols-6' : 'sm:grid-cols-5'
      )}>
      <SummaryCell label={firstLabel} value={billing.billingAmount} billing={billing} />
      <SummaryCell label='Drafted' value={billing.drafted} billing={billing} />
      <SummaryCell label='Invoiced' value={billing.invoiced} billing={billing} />
      <SummaryCell label='Remaining to invoice' value={billing.remaining} billing={billing} />
      <SummaryCell label='Balance due' value={billing.balanceDue} billing={billing} />
      {showDepositHeld && (
        <SummaryCell label='Deposit held' value={billing.depositHeld} billing={billing} />
      )}
    </div>
  )
}

function SummaryCell({
  label,
  value,
  billing,
}: {
  label: string
  value: number
  billing: WorkOrderBillingView
}) {
  return (
    <div className='flex flex-col gap-0.5'>
      <span className='text-xs text-muted-foreground'>{label}</span>
      <span className='font-medium text-sm tabular-nums'>
        {formatCurrency(value, billing.currencyCode)}
      </span>
    </div>
  )
}

function NextAction({
  billing,
  onAction,
}: {
  billing: WorkOrderBillingView
  onAction: () => void
}) {
  const openRecord = useOpenRecord()
  const action = resolveBillingAction(billing)
  const handleClick = () => {
    if (action.kind === 'create') return onAction()
    if (action.kind === 'review_draft') {
      if (action.draftInvoiceRecordId) return openRecord?.(action.draftInvoiceRecordId)
      return onAction()
    }
    if (action.kind === 'view_invoices') {
      const target = billing.invoices[0]
      if (target) openRecord?.(target.recordId)
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

function UninvoicedWork({
  billing,
  onPrimary,
  onExtra,
}: {
  billing: WorkOrderBillingView
  onPrimary: () => void
  onExtra: () => void
}) {
  if (
    billing.remaining <= 0 &&
    billing.eligibleVisits.length === 0 &&
    billing.extraWorkVisitIds.length === 0
  ) {
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
    <div className='flex items-center justify-between gap-3 p-3 text-sm'>
      <div>
        <div className='font-medium'>
          {billing.eligibleVisits.length > 0
            ? `${billing.eligibleVisits.length} eligible visit${billing.eligibleVisits.length === 1 ? '' : 's'}`
            : formatCurrency(billing.remaining, billing.currencyCode)}
        </div>
        <div className='text-xs text-muted-foreground'>
          {billing.extraWorkVisitIds.length > 0
            ? `${billing.extraWorkVisitIds.length} visit${billing.extraWorkVisitIds.length === 1 ? '' : 's'} with extra work`
            : 'Available for the next invoice'}
        </div>
      </div>
      <div className='flex gap-2'>
        {billing.extraWorkVisitIds.length > 0 && (
          <Button variant='ghost' size='sm' onClick={onExtra}>
            Invoice extra work
          </Button>
        )}
        <Button variant='outline' size='sm' onClick={onPrimary}>
          Create invoice
        </Button>
      </div>
    </div>
  )
}

function InvoiceRows({ billing }: { billing: WorkOrderBillingView }) {
  const openRecord = useOpenRecord()
  if (billing.invoices.length === 0)
    return <p className='p-3 text-sm text-muted-foreground'>No invoices yet.</p>
  return (
    <div className='divide-y'>
      {billing.invoices.map((invoice) => (
        <button
          type='button'
          key={invoice.recordId}
          onClick={() => openRecord?.(invoice.recordId)}
          className='flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-primary-100'>
          <ReceiptText className='size-4 text-muted-foreground' />
          <span className='min-w-0 flex-1'>
            <span className='block truncate text-sm font-medium'>{invoice.displayName}</span>
            <span className='text-xs text-muted-foreground'>
              {invoice.visitCount
                ? `${invoice.visitCount} visit${invoice.visitCount === 1 ? '' : 's'} · `
                : ''}
              {invoice.status}
            </span>
          </span>
          <span className='text-sm tabular-nums'>
            {formatCurrency(invoice.total, billing.currencyCode)}
          </span>
          <ExternalLink className='size-3.5 text-muted-foreground' />
        </button>
      ))}
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
  if (billing.state === 'ready_to_invoice')
    return billing.eligibleVisits.length
      ? `${billing.eligibleVisits.length} completed visit${billing.eligibleVisits.length === 1 ? '' : 's'} can be invoiced.`
      : `${formatCurrency(billing.remaining, billing.currencyCode)} is ready to invoice.`
  return 'No billing action is currently required.'
}
function formatDate(value: string) {
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(value))
}

export default WorkOrderBillingTab
