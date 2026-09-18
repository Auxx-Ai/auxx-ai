// apps/web/src/components/money/ui/payments/payments-list.tsx
'use client'

// Shared presentational payments list — the row markup (date / method / reference / amount)
// extracted verbatim from the invoice drawer's payments card so the work-order billing
// section can reuse it. Every row is a money-model receipt (accounting migration step 0
// dropped the legacy `PaymentTransaction` lane, and with it the Stripe charge/refund and
// manual-delete rows this list used to also render) — the one action is admin-gated Void, a
// reversing correction, never a delete.

import { EmptySection } from '@auxx/ui/components/section'
import { TreeRow, TreeRowButton } from '@auxx/ui/components/tree-row'
import { TreeRowList } from '@auxx/ui/components/tree-row-list'
import { format } from 'date-fns'
import { CreditCard, Trash2 } from 'lucide-react'
import type { ReactNode } from 'react'
import { formatCurrency } from '~/components/money/ui/line-builder/shared'
import { paymentMethodLabel } from '../invoice/payment-method-options'

/** The row shape every consumer's query answers with — `listPayments` and
 * `listPaymentsForWorkOrder` both extend this with fields this list never reads. */
interface PaymentRow {
  id: string
  date: string
  method: string | null
  reference: string | null
  amount: number
}

export interface PaymentsListProps {
  payments: PaymentRow[] | undefined
  isLoading: boolean
  currencyCode: string
  isAdmin: boolean
  onDelete: (transactionId: string) => void
  deletePending: boolean
  /** Optional slot rendered at the end of each row, after the action button — e.g. the
   * work-order billing section's invoice chip/link. */
  renderRowSuffix?: (payment: PaymentRow) => ReactNode
  /** Cap the always-visible rows behind `TreeRowList`'s inline "Show N more" collapse.
   * Omit to show all. */
  visibleLimit?: number
}

/** Presentational payments ledger list — rows, loading + empty states, and the admin-gated
 * Void action. Shared by the invoice drawer's payments card and the work-order billing
 * section's payments block. */
export function PaymentsList({
  payments,
  isLoading,
  currencyCode,
  isAdmin,
  onDelete,
  deletePending,
  renderRowSuffix,
  visibleLimit,
}: PaymentsListProps) {
  if (isLoading) return <EmptySection loading title='Loading payments' />

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
    <TreeRowList
      items={payments}
      getKey={(payment) => payment.id}
      visibleLimit={visibleLimit}
      renderRow={(payment) => (
        <TreeRow
          rowClassName='hover:bg-primary-100'
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
              {payment.reference && <span className='max-w-32 truncate'>{payment.reference}</span>}
              <span className='shrink-0 text-foreground text-sm tabular-nums'>
                {formatCurrency(payment.amount, currencyCode)}
              </span>
              {renderRowSuffix?.(payment)}
              {isAdmin && (
                <TreeRowButton
                  variant='destructive'
                  tooltipText='Void payment'
                  disabled={deletePending}
                  onClick={() => onDelete(payment.id)}>
                  <Trash2 />
                </TreeRowButton>
              )}
            </div>
          }
        />
      )}
    />
  )
}
