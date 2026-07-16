// apps/web/src/components/dispatch/ui/job-schedule/work-order-billing-payments-block.tsx
'use client'

// Billing tab §D block 5 + §C record-payment invoice preselect
// (plans/dispatch/money/10-work-order-billing-tab.md). Thin wrapper around the shared
// `PaymentsList` (§B) — same query/mutation/confirm shape as `invoice-payments-card.tsx`, just
// cross-invoice (`listPaymentsForWorkOrder`) and invalidating both the WO-scoped query and the
// affected invoice's own `listPayments` so an open invoice drawer stays fresh. `renderRowSuffix`
// adds a small invoice chip per row (§B slot) so a mixed-invoice ledger stays legible.
//
// Layout mirrors `WorkOrderBillingInvoicesBlock` exactly: the label + bordered container live in
// the parent tab, this component renders only rows + the "record" affordance as a `TreeRow` at
// the bottom (matching "Create invoice"). `PaymentsList` owns the loading/empty state — no
// second empty-state branch here.
//
// §C: candidates = invoices with `invoice_status !== 'void'` and `invoice_balance > 0`, handed
// down by the billing tab (it already aggregates per-invoice values for the summary strip).
// Exactly one → the Record-payment row opens the dialog against it; multiple → that row becomes
// a `DropdownMenu` chooser ("<number> — <balance> due"); zero → the row is hidden.

import type { RecordId } from '@auxx/types/resource'
import { getInstanceId } from '@auxx/types/resource'
import { Badge } from '@auxx/ui/components/badge'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@auxx/ui/components/dropdown-menu'
import { toastError } from '@auxx/ui/components/toast'
import { TreeRow } from '@auxx/ui/components/tree-row'
import { CreditCard, Plus } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useMemo, useState } from 'react'
import { useAdminGate } from '~/components/global/admin-gate'
import { RecordPaymentDialog } from '~/components/money/ui/invoice/record-payment-dialog'
import { formatCurrency } from '~/components/money/ui/line-builder/shared'
import { PaymentsList } from '~/components/money/ui/payments/payments-list'
import { useRecord } from '~/components/resources'
import { useConfirm } from '~/hooks/use-confirm'
import { api } from '~/trpc/react'

export interface PaymentCandidate {
  recordId: RecordId
  balance: number
  displayName: string
}

export interface WorkOrderBillingPaymentsBlockProps {
  workOrderRecordId: RecordId
  candidates: PaymentCandidate[]
  currencyCode: string
  /** Called after a payment is recorded/deleted/refunded, in addition to this block's own
   * ledger invalidation — lets the composed `getWorkOrderBillingState` read (balance due,
   * next-action state) stay in sync without waiting for the realtime revision round-trip. */
  onSettled?: () => void
}

/** Payments block — the shared ledger list + "Record payment" (billing tab §D block 5). */
export function WorkOrderBillingPaymentsBlock({
  workOrderRecordId,
  candidates,
  currencyCode,
  onSettled,
}: WorkOrderBillingPaymentsBlockProps) {
  const { allowed: isAdmin } = useAdminGate()
  const [confirm, ConfirmDialog] = useConfirm()
  const [target, setTarget] = useState<PaymentCandidate | null>(null)

  const utils = api.useUtils()
  const { data: payments, isLoading } = api.money.listPaymentsForWorkOrder.useQuery({
    workOrderRecordId,
  })
  const hasPayments = (payments?.length ?? 0) > 0

  const invalidateBoth = (invoiceRecordId: RecordId | null) => {
    onSettled?.()
    void utils.money.listPaymentsForWorkOrder.invalidate({ workOrderRecordId })
    // Held deposits (money MP2) carry no invoice link until settle — nothing to invalidate.
    if (invoiceRecordId) void utils.money.listPayments.invalidate({ invoiceRecordId })
  }

  // `PaymentsList`'s `renderRowSuffix` callback is typed against the bare `listPayments` row
  // shape (no `invoiceRecordId`) — look the invoice up by transaction id from our own
  // `listPaymentsForWorkOrder` data instead of widening that shared type.
  const invoiceByTransactionId = useMemo(() => {
    const map = new Map<string, RecordId | null>()
    for (const payment of payments ?? []) map.set(payment.id, payment.invoiceRecordId)
    return map
  }, [payments])

  const deletePayment = api.money.deletePayment.useMutation({
    onError: (error) => toastError({ title: 'Error deleting payment', description: error.message }),
  })

  const refundTransaction = api.money.refundTransaction.useMutation({
    onError: (error) =>
      toastError({ title: 'Error refunding payment', description: error.message }),
  })

  const handleDelete = async (transactionId: string) => {
    const payment = payments?.find((p) => p.id === transactionId)
    const confirmed = await confirm({
      title: 'Delete this payment?',
      description: 'Invoice balance will be recalculated.',
      confirmText: 'Delete',
      cancelText: 'Cancel',
      destructive: true,
    })
    if (!confirmed) return
    deletePayment.mutate(
      { transactionId },
      { onSuccess: () => payment && invalidateBoth(payment.invoiceRecordId) }
    )
  }

  const handleRefund = async (transactionId: string) => {
    const payment = payments?.find((p) => p.id === transactionId)
    const confirmed = await confirm({
      title: 'Refund this payment in full?',
      description: 'The platform fee is refunded too.',
      confirmText: 'Refund',
      cancelText: 'Cancel',
      destructive: true,
    })
    if (!confirmed) return
    refundTransaction.mutate(
      { transactionId },
      { onSuccess: () => payment && invalidateBoth(payment.invoiceRecordId) }
    )
  }

  return (
    <div>
      <PaymentsList
        payments={payments}
        isLoading={isLoading}
        currencyCode={currencyCode}
        isAdmin={isAdmin}
        onDelete={handleDelete}
        onRefund={handleRefund}
        deletePending={deletePayment.isPending}
        refundPending={refundTransaction.isPending}
        renderRowSuffix={(payment) => {
          const invoiceRecordId = invoiceByTransactionId.get(payment.id)
          return invoiceRecordId ? <PaymentInvoiceChip invoiceRecordId={invoiceRecordId} /> : null
        }}
      />

      {candidates.length > 0 && (
        <RecordPaymentRow
          candidates={candidates}
          hasPayments={hasPayments}
          currencyCode={currencyCode}
          onSelect={setTarget}
        />
      )}

      {target && (
        <RecordPaymentDialog
          open={!!target}
          onOpenChange={(open) => !open && setTarget(null)}
          invoiceRecordId={target.recordId}
          balance={target.balance}
          currencyCode={currencyCode}
          onRecorded={() => invalidateBoth(target.recordId)}
        />
      )}

      <ConfirmDialog />
    </div>
  )
}

/** "Record payment" affordance — a single TreeRow when there's one open invoice to bill, a
 * dropdown-backed TreeRow when there are several. Shares its icon/title so both stay in sync. */
function RecordPaymentRow({
  candidates,
  hasPayments,
  currencyCode,
  onSelect,
}: {
  candidates: PaymentCandidate[]
  hasPayments: boolean
  currencyCode: string
  onSelect: (candidate: PaymentCandidate) => void
}) {
  const icon = hasPayments ? <Plus className='size-4' /> : <CreditCard className='size-4' />
  const title = <span className='text-muted-foreground text-sm'>Record payment</span>

  if (candidates.length === 1) {
    return <TreeRow icon={icon} title={title} onToggleOpen={() => onSelect(candidates[0]!)} />
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <div>
          <TreeRow rowClassName='cursor-pointer' icon={icon} title={title} />
        </div>
      </DropdownMenuTrigger>
      <DropdownMenuContent align='start'>
        {candidates.map((candidate) => (
          <DropdownMenuItem key={candidate.recordId} onClick={() => onSelect(candidate)}>
            {candidate.displayName} — {formatCurrency(candidate.balance, currencyCode)} due
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/** Small invoice chip in a payment row's trailing slot — click opens that invoice's drawer. */
function PaymentInvoiceChip({ invoiceRecordId }: { invoiceRecordId: RecordId }) {
  const router = useRouter()
  const { record } = useRecord({ recordId: invoiceRecordId, enabled: true })

  return (
    <button
      type='button'
      className='shrink-0 cursor-pointer'
      onClick={() => router.push(`/app/invoices?id=${getInstanceId(invoiceRecordId)}`)}>
      <Badge variant='secondary' size='xs' className='hover:bg-primary-150'>
        {record?.displayName ?? '—'}
      </Badge>
    </button>
  )
}
