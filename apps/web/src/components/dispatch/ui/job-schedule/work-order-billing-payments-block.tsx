// apps/web/src/components/dispatch/ui/job-schedule/work-order-billing-payments-block.tsx
'use client'

// Billing tab §D block 5 + §C record-payment invoice preselect
// (plans/dispatch/money/10-work-order-billing-tab.md). Thin wrapper around the shared
// `PaymentsList` (§B) — same query/mutation/confirm shape as `invoice-payments-card.tsx`, just
// cross-invoice (`listPaymentsForWorkOrder`) and invalidating both the WO-scoped query and the
// affected invoice's own `listPayments` so an open invoice drawer stays fresh. `renderRowSuffix`
// adds a small invoice chip per row (§B slot) so a mixed-invoice ledger stays legible.
//
// §C: candidates = invoices with `invoice_status !== 'void'` and `invoice_balance > 0`, handed
// down by the billing tab (it already aggregates per-invoice values for the summary strip).
// Exactly one → the dialog opens directly against it; multiple → a small `DropdownMenu`
// chooser lists each ("<number> — <balance> due"); zero → no action, and — when there are no
// invoices at all — a custom `EmptySection` explaining that, instead of `PaymentsList`'s own
// "no payments recorded" copy (which reads wrong when there's nothing to attach a payment to).

import type { RecordId } from '@auxx/types/resource'
import { getInstanceId } from '@auxx/types/resource'
import { Badge } from '@auxx/ui/components/badge'
import { Button } from '@auxx/ui/components/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@auxx/ui/components/dropdown-menu'
import { EmptySection } from '@auxx/ui/components/section'
import { toastError } from '@auxx/ui/components/toast'
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
  hasInvoices: boolean
  candidates: PaymentCandidate[]
  currencyCode: string
}

export function WorkOrderBillingPaymentsBlock({
  workOrderRecordId,
  hasInvoices,
  candidates,
  currencyCode,
}: WorkOrderBillingPaymentsBlockProps) {
  const { allowed: isAdmin } = useAdminGate()
  const [confirm, ConfirmDialog] = useConfirm()
  const [target, setTarget] = useState<PaymentCandidate | null>(null)

  const utils = api.useUtils()
  const { data: payments, isLoading } = api.money.listPaymentsForWorkOrder.useQuery({
    workOrderRecordId,
  })

  const invalidateBoth = (invoiceRecordId: RecordId) => {
    void utils.money.listPaymentsForWorkOrder.invalidate({ workOrderRecordId })
    void utils.money.listPayments.invalidate({ invoiceRecordId })
  }

  // `PaymentsList`'s `renderRowSuffix` callback is typed against the bare `listPayments` row
  // shape (no `invoiceRecordId`) — look the invoice up by transaction id from our own
  // `listPaymentsForWorkOrder` data instead of widening that shared type.
  const invoiceByTransactionId = useMemo(() => {
    const map = new Map<string, RecordId>()
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

  const openDirect = (candidate: PaymentCandidate) => setTarget(candidate)

  return (
    <div className='flex flex-col gap-1'>
      <div className='flex items-center justify-between px-4 pt-1 pb-1'>
        <span className='text-xs font-medium text-muted-foreground'>Payments</span>
        {candidates.length === 1 && (
          <Button variant='ghost' size='xs' onClick={() => openDirect(candidates[0]!)}>
            <Plus />
            Record payment
          </Button>
        )}
        {candidates.length > 1 && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant='ghost' size='xs'>
                <Plus />
                Record payment
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align='end'>
              {candidates.map((candidate) => (
                <DropdownMenuItem key={candidate.recordId} onClick={() => openDirect(candidate)}>
                  {candidate.displayName} — {formatCurrency(candidate.balance, currencyCode)} due
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>

      {!hasInvoices ? (
        <EmptySection
          icon={<CreditCard className='size-5' />}
          title='No invoices yet'
          description='Create an invoice above before recording a payment.'
        />
      ) : (
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
