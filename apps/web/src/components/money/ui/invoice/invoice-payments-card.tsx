// apps/web/src/components/money/ui/invoice/invoice-payments-card.tsx
'use client'

// Invoice drawer's "Payments" tab card — registered as 'invoice:payments' (money MI1 build
// spec §J.1; money MP1 build spec §K adds the provider-aware per-row action). Lists the
// `PaymentTransaction` ledger rows (`money.listPayments` — reads the ledger, not the
// `payment` entity mirrors, so Stripe rows show with zero data-fetch change), admin-gated
// delete (manual rows, decision 8) / refund (Stripe rows), and the "Record payment" footer
// action (§J.3).

import { Badge, type Variant as BadgeVariant } from '@auxx/ui/components/badge'
import { Button } from '@auxx/ui/components/button'
import { EmptySection } from '@auxx/ui/components/section'
import { toastError } from '@auxx/ui/components/toast'
import { format } from 'date-fns'
import { CreditCard, Plus, RotateCcw, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { DrawerCardActions } from '~/components/drawers/drawer-card-actions'
import type { DrawerTabProps } from '~/components/drawers/drawer-tab-registry'
import { useAdminGate } from '~/components/global/admin-gate'
import { formatCurrency } from '~/components/money/ui/line-builder/shared'
import { useSystemValues } from '~/components/resources/hooks'
import { useConfirm } from '~/hooks/use-confirm'
import { useSettings } from '~/hooks/use-settings'
import { api } from '~/trpc/react'
import { paymentMethodLabel } from './payment-method-options'
import { RecordPaymentDialog } from './record-payment-dialog'

/** Non-actionable Stripe rows render a status chip instead of an action — a refund-in-progress,
 * an already-refunded charge, or a disputed one. A refunded CHARGE row deliberately keeps
 * `status: 'succeeded'` (the refund row does the subtracting in the ledger math), so
 * refunded-ness is derived from the linked refund row's status, not the charge's own. */
function stripeStatusChip(
  payment: { kind: string; status: string },
  linkedRefundStatus?: string
): {
  label: string
  variant: BadgeVariant
} {
  if (payment.kind === 'refund') {
    if (payment.status === 'succeeded') return { label: 'Refunded', variant: 'gray' }
    if (payment.status === 'pending') return { label: 'Refund pending', variant: 'amber' }
    return { label: 'Refund failed', variant: 'red' }
  }
  if (linkedRefundStatus) {
    return linkedRefundStatus === 'succeeded'
      ? { label: 'Refunded', variant: 'gray' }
      : { label: 'Refund pending', variant: 'amber' }
  }
  if (payment.status === 'refunded') return { label: 'Refunded', variant: 'gray' }
  if (payment.status === 'disputed') return { label: 'Disputed', variant: 'red' }
  if (payment.status === 'pending') return { label: 'Processing', variant: 'amber' }
  return { label: payment.status, variant: 'gray' }
}

const INVOICE_ATTRS = ['invoice_status', 'invoice_balance'] as const

export function InvoicePaymentsCard({ recordId }: DrawerTabProps) {
  const { allowed: isAdmin } = useAdminGate()
  const [confirm, ConfirmDialog] = useConfirm()
  const [dialogOpen, setDialogOpen] = useState(false)

  const { getSetting } = useSettings({})
  const currencyCode = (getSetting('organization.currency') as string | null) ?? 'USD'

  const { values } = useSystemValues(recordId, [...INVOICE_ATTRS], { autoFetch: true })
  const status = (values.invoice_status as string | undefined) ?? 'draft'
  const balance = (values.invoice_balance as number | null | undefined) ?? 0

  const utils = api.useUtils()
  const { data: payments, isLoading } = api.money.listPayments.useQuery({
    invoiceRecordId: recordId,
  })

  const deletePayment = api.money.deletePayment.useMutation({
    onSuccess: () => {
      void utils.money.listPayments.invalidate({ invoiceRecordId: recordId })
    },
    onError: (error) => toastError({ title: 'Error deleting payment', description: error.message }),
  })

  const refundTransaction = api.money.refundTransaction.useMutation({
    onSuccess: () => {
      void utils.money.listPayments.invalidate({ invoiceRecordId: recordId })
    },
    onError: (error) =>
      toastError({ title: 'Error refunding payment', description: error.message }),
  })

  const handleDelete = async (transactionId: string) => {
    const confirmed = await confirm({
      title: 'Delete this payment?',
      description: 'Invoice balance will be recalculated.',
      confirmText: 'Delete',
      cancelText: 'Cancel',
      destructive: true,
    })
    if (confirmed) deletePayment.mutate({ transactionId })
  }

  const handleRefund = async (transactionId: string) => {
    const confirmed = await confirm({
      title: 'Refund this payment in full?',
      description: 'The platform fee is refunded too.',
      confirmText: 'Refund',
      cancelText: 'Cancel',
      destructive: true,
    })
    if (confirmed) refundTransaction.mutate({ transactionId })
  }

  const canRecordPayment = status !== 'void' && balance > 0

  // Charge id → its open/succeeded refund's status. A charge with a linked refund is no longer
  // refundable (the server would reject it) — it renders a chip instead of the Refund action.
  const refundStatusByCharge = new Map<string, string>()
  for (const p of payments ?? []) {
    if (
      p.kind === 'refund' &&
      p.refundedTransactionId &&
      p.status !== 'failed' &&
      p.status !== 'canceled'
    ) {
      refundStatusByCharge.set(p.refundedTransactionId, p.status)
    }
  }

  return (
    <div className='flex flex-col gap-2'>
      {canRecordPayment && (
        <DrawerCardActions>
          <Button variant='ghost' size='xs' onClick={() => setDialogOpen(true)}>
            <Plus />
            Record payment
          </Button>
        </DrawerCardActions>
      )}

      {isLoading ? (
        <EmptySection loading />
      ) : !payments?.length ? (
        <EmptySection
          icon={<CreditCard className='size-5' />}
          title='No payments recorded'
          description='Record a payment to get started.'
        />
      ) : (
        <div className='flex flex-col divide-y divide-primary-200/50 dark:divide-[#1e2227]'>
          {payments.map((payment) => (
            <div key={payment.id} className='group flex items-center gap-2 py-1.5 text-sm'>
              <span className='w-24 shrink-0 tabular-nums text-muted-foreground'>
                {format(new Date(payment.date), 'MMM d, yyyy')}
              </span>
              <span className='w-28 shrink-0 truncate text-muted-foreground'>
                {paymentMethodLabel(payment.method ?? 'other')}
              </span>
              <span className='min-w-0 flex-1 truncate text-muted-foreground text-xs'>
                {payment.reference ?? ''}
              </span>
              <span className='shrink-0 tabular-nums'>
                {formatCurrency(payment.amount, currencyCode)}
              </span>
              {payment.provider === 'manual'
                ? isAdmin && (
                    <Button
                      variant='ghost'
                      size='icon-sm'
                      className='shrink-0 text-destructive/70 opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100'
                      loading={deletePayment.isPending}
                      onClick={() => handleDelete(payment.id)}>
                      <Trash2 />
                    </Button>
                  )
                : payment.kind === 'charge' &&
                    payment.status === 'succeeded' &&
                    !refundStatusByCharge.has(payment.id)
                  ? isAdmin && (
                      <Button
                        variant='ghost'
                        size='icon-sm'
                        className='shrink-0 text-muted-foreground opacity-0 transition-opacity hover:text-foreground group-hover:opacity-100'
                        loading={refundTransaction.isPending}
                        onClick={() => handleRefund(payment.id)}>
                        <RotateCcw />
                      </Button>
                    )
                  : (() => {
                      const chip = stripeStatusChip(payment, refundStatusByCharge.get(payment.id))
                      return (
                        <Badge variant={chip.variant} size='sm' className='shrink-0'>
                          {chip.label}
                        </Badge>
                      )
                    })()}
            </div>
          ))}
        </div>
      )}

      <RecordPaymentDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        invoiceRecordId={recordId}
        balance={balance}
        currencyCode={currencyCode}
        onRecorded={() => {
          void utils.money.listPayments.invalidate({ invoiceRecordId: recordId })
        }}
      />

      <ConfirmDialog />
    </div>
  )
}
