// apps/web/src/components/dispatch/ui/job-schedule/work-order-billing-tab.tsx
'use client'

// WorkOrderBillingTab — registered as `work_order:billing`
// (plans/dispatch/money/10-work-order-billing-tab.md §D/§E). The job view's money surface:
// summary strip, the ready-to-invoice callout (locked decision 4), the invoicing schedule
// (`BillingScheduleRow`, moved here from the line-items section), the invoices block, and the
// shared payments block (§B/§C). Follows `WorkOrderLineItemsTab`'s `variant` handling — bounded
// `max-h` + `overflow-auto` in `section` mode, full-height flex in `tab` mode. The wrapping
// `<Section>` (`DetailViewSections`) owns the "Billing" heading — this component renders content
// only.

import { cn } from '@auxx/ui/lib/utils'
import { CalendarClock, TriangleAlert } from 'lucide-react'
import { useCallback, useMemo, useState } from 'react'
import type { DetailViewTabProps } from '~/components/detail-view'
import type { InvoiceBillingValues } from '~/components/money/hooks/use-work-order-invoices'
import { useWorkOrderInvoices } from '~/components/money/hooks/use-work-order-invoices'
import { formatCurrency } from '~/components/money/ui/line-builder/shared'
import { TuckedLabel } from '~/components/money/ui/tucked-label'
import { useSystemValues } from '~/components/resources/hooks/use-system-values'
import { useSettings } from '~/hooks/use-settings'
import { api } from '~/trpc/react'
import { BillingScheduleRow } from './billing-schedule-row'
import { WorkOrderBillingInvoicesBlock } from './work-order-billing-invoices-block'
import type { PaymentCandidate } from './work-order-billing-payments-block'
import { WorkOrderBillingPaymentsBlock } from './work-order-billing-payments-block'

/** Timings whose invoice drafts are generated automatically (vs `as_needed`, manual). */
const AUTOMATED_TIMINGS = new Set(['per_visit_completed', 'on_completion', 'custom_schedule'])

/** Quiet sub-block header — the Attio-style tucked label the block below stacks into. */
function BlockLabel({ children }: { children: React.ReactNode }) {
  return <TuckedLabel className=' mt-2'>{children}</TuckedLabel>
}

export function WorkOrderBillingTab({ recordId, variant = 'tab' }: DetailViewTabProps) {
  const isSection = variant === 'section'
  const { getSetting } = useSettings({})
  const currencyCode = (getSetting('organization.currency') as string | null) ?? 'USD'
  const autoEnabled = (getSetting('documents.invoice.autoEnabled') as boolean | null) ?? true

  // Same fallback the line-items tab used — `per_visit_completed` is the field's static
  // default, and defaulting to `as_needed` here would flash the ready-to-invoice callout on
  // automated jobs while the value loads.
  const { values } = useSystemValues(recordId, ['work_order_invoice_timing'], { autoFetch: true })
  const invoiceTiming =
    (values.work_order_invoice_timing as string | undefined) ?? 'per_visit_completed'

  const { invoiceRecordIds, isLoading: invoicesLoading } = useWorkOrderInvoices(recordId)

  const { data: uninvoicedLines } = api.money.listUninvoicedLines.useQuery({
    workOrderRecordId: recordId,
  })
  const { data: visits } = api.dispatch.listVisits.useQuery({ workOrderRecordId: recordId })

  // Per-invoice values map, fed by each `InvoiceBillingRow` as its own read resolves (billing
  // tab build spec §D.1 — no batch field-value hook exists yet).
  const [invoiceValuesById, setInvoiceValuesById] = useState<Record<string, InvoiceBillingValues>>(
    {}
  )
  const handleInvoiceValues = useCallback(
    (invoiceRecordId: string, invoiceValues: InvoiceBillingValues) => {
      setInvoiceValuesById((prev) => ({ ...prev, [invoiceRecordId]: invoiceValues }))
    },
    []
  )

  const knownInvoiceValues = useMemo(
    () =>
      invoiceRecordIds
        .map((id) => invoiceValuesById[id])
        .filter((v): v is InvoiceBillingValues => !!v),
    [invoiceRecordIds, invoiceValuesById]
  )
  const nonVoidValues = useMemo(
    () => knownInvoiceValues.filter((v) => v.status !== 'void'),
    [knownInvoiceValues]
  )

  const invoicedTotal = nonVoidValues.reduce((sum, v) => sum + v.total, 0)
  const paidTotal = nonVoidValues.reduce((sum, v) => sum + v.amountPaid, 0)
  const balanceTotal = nonVoidValues.reduce((sum, v) => sum + v.balance, 0)
  const uninvoicedTotal = (uninvoicedLines ?? []).reduce((sum, line) => sum + line.lineTotal, 0)

  // §C candidates — invoices with a positive balance that aren't void.
  const candidates: PaymentCandidate[] = useMemo(
    () =>
      nonVoidValues
        .filter((v) => v.balance > 0)
        .map((v) => ({ recordId: v.recordId, balance: v.balance, displayName: v.displayName })),
    [nonVoidValues]
  )

  const anyDoneVisit = (visits ?? []).some((v) => v.status === 'done')
  const hasUninvoicedLines = (uninvoicedLines ?? []).length > 0
  const effectiveManual = invoiceTiming === 'as_needed' || autoEnabled === false
  const showReadyToInvoiceCallout = anyDoneVisit && hasUninvoicedLines && effectiveManual

  const showOrgDisabledWarning = autoEnabled === false && AUTOMATED_TIMINGS.has(invoiceTiming)

  return (
    <div className={cn('flex flex-col', isSection ? '' : 'h-full min-h-0')}>
      <div
        className={cn(
          'flex flex-col',
          isSection ? 'max-h-[70vh] overflow-auto' : 'min-h-0 flex-1'
        )}>
        {/* Block a — summary strip */}
        <div className='flex items-stretch gap-6  pt-2 pb-3'>
          <SummaryCell label='Invoiced' value={formatCurrency(invoicedTotal, currencyCode)} />
          <SummaryCell label='Paid' value={formatCurrency(paidTotal, currencyCode)} />
          <SummaryCell label='Balance due' value={formatCurrency(balanceTotal, currencyCode)} />
          <SummaryCell label='Uninvoiced' value={formatCurrency(uninvoicedTotal, currencyCode)} />
        </div>

        {/* Block b — ready-to-invoice callout (locked decision 4) */}
        {showReadyToInvoiceCallout && (
          <div className='mx-4 mb-2 flex items-center gap-1.5 rounded-md bg-amber-500/10 px-3 py-2 text-amber-700 text-xs dark:text-amber-400'>
            <TriangleAlert className='size-3.5 shrink-0' />
            This job has completed work that hasn't been invoiced.
          </div>
        )}

        {/* Block c — invoicing schedule */}
        <BillingScheduleRow workOrderRecordId={recordId} invoiceTiming={invoiceTiming} />
        {showOrgDisabledWarning && (
          <div className='flex items-center gap-1.5  pt-1 pb-2 text-xs text-amber-700 dark:text-amber-400'>
            <CalendarClock className='size-3.5 shrink-0' />
            Automatic invoicing is turned off for your organization.
          </div>
        )}
        <div className='me-4'>
          {/* Block d — invoices */}
          <BlockLabel>Invoices</BlockLabel>
          <div className='bg-primary-100 border rounded-xl mb-4'>
            <WorkOrderBillingInvoicesBlock
              workOrderRecordId={recordId}
              invoiceRecordIds={invoiceRecordIds}
              isLoading={invoicesLoading}
              currencyCode={currencyCode}
              onInvoiceValues={handleInvoiceValues}
            />
          </div>

          {/* Block e — payments */}
          <WorkOrderBillingPaymentsBlock
            workOrderRecordId={recordId}
            hasInvoices={invoiceRecordIds.length > 0}
            candidates={candidates}
            currencyCode={currencyCode}
          />
        </div>
      </div>
    </div>
  )
}

function SummaryCell({ label, value }: { label: string; value: string }) {
  return (
    <div className='flex flex-col gap-0.5'>
      <span className='text-xs text-muted-foreground'>{label}</span>
      <span className='font-medium text-sm tabular-nums'>{value}</span>
    </div>
  )
}

export default WorkOrderBillingTab
