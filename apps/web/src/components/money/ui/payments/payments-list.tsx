// apps/web/src/components/money/ui/payments/payments-list.tsx
'use client'

// Shared presentational payments list — the row markup (date / method / reference / amount),
// the `stripeStatusChip` helper, and the `refundStatusByCharge` derivation, extracted verbatim
// from the invoice drawer's payments card (money MP1 build spec §K) so the work-order billing
// section (money plan 10 §B) can reuse it. Admin-gated delete (manual rows) / refund (Stripe
// rows) behavior is unchanged; callers own their own queries/mutations.

import { Badge, type Variant as BadgeVariant } from '@auxx/ui/components/badge'
import { EmptySection } from '@auxx/ui/components/section'
import { TreeRow, TreeRowButton } from '@auxx/ui/components/tree-row'
import { format } from 'date-fns'
import { CreditCard, RotateCcw, Trash2 } from 'lucide-react'
import type { ReactNode } from 'react'
import { formatCurrency } from '~/components/money/ui/line-builder/shared'
import type { RouterOutputs } from '~/trpc/react'
import { paymentMethodLabel } from '../invoice/payment-method-options'

type PaymentRow = RouterOutputs['money']['listPayments'][number]

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

export interface PaymentsListProps {
  payments: PaymentRow[] | undefined
  isLoading: boolean
  currencyCode: string
  isAdmin: boolean
  onDelete: (transactionId: string) => void
  onRefund: (transactionId: string) => void
  deletePending: boolean
  refundPending: boolean
  /** Optional slot rendered at the end of each row, after the action button/chip — e.g. the
   * work-order billing section's invoice chip/link. */
  renderRowSuffix?: (payment: PaymentRow) => ReactNode
}

/** Presentational payments ledger list — rows, loading + empty states, and the admin-gated
 * delete (manual) / refund (Stripe) actions. Shared by the invoice drawer's payments card and
 * the work-order billing section's payments block. */
export function PaymentsList({
  payments,
  isLoading,
  currencyCode,
  isAdmin,
  onDelete,
  onRefund,
  deletePending,
  refundPending,
  renderRowSuffix,
}: PaymentsListProps) {
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

  if (isLoading) return <EmptySection loading />

  if (!payments?.length) {
    return (
      <EmptySection
        icon={<CreditCard className='size-5' />}
        title='No payments recorded'
        description='Record a payment to get started.'
      />
    )
  }

  return (
    <div className='flex flex-col'>
      {payments.map((payment) => {
        const action =
          payment.provider === 'manual'
            ? isAdmin && (
                <TreeRowButton
                  variant='destructive'
                  tooltipText='Delete payment'
                  disabled={deletePending}
                  onClick={() => onDelete(payment.id)}>
                  <Trash2 />
                </TreeRowButton>
              )
            : payment.kind === 'charge' &&
                payment.status === 'succeeded' &&
                !refundStatusByCharge.has(payment.id)
              ? isAdmin && (
                  <TreeRowButton
                    tooltipText='Refund payment'
                    disabled={refundPending}
                    onClick={() => onRefund(payment.id)}>
                    <RotateCcw />
                  </TreeRowButton>
                )
              : (() => {
                  const chip = stripeStatusChip(payment, refundStatusByCharge.get(payment.id))
                  return (
                    <Badge variant={chip.variant} size='sm' className='shrink-0'>
                      {chip.label}
                    </Badge>
                  )
                })()

        return (
          <TreeRow
            key={payment.id}
            icon={<CreditCard className='size-4' />}
            title={
              <span className='truncate text-sm'>
                {paymentMethodLabel(payment.method ?? 'other')}
              </span>
            }
            secondary={
              <span className='tabular-nums'>{format(new Date(payment.date), 'MMM d, yyyy')}</span>
            }
            actions={
              <div className='flex items-center gap-3 text-xs text-muted-foreground'>
                {payment.reference && (
                  <span className='max-w-32 truncate'>{payment.reference}</span>
                )}
                <span className='shrink-0 text-foreground text-sm tabular-nums'>
                  {formatCurrency(payment.amount, currencyCode)}
                </span>
                {renderRowSuffix?.(payment)}
                {action}
              </div>
            }
          />
        )
      })}
    </div>
  )
}
