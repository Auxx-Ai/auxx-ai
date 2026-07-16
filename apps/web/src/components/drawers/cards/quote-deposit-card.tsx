// apps/web/src/components/drawers/cards/quote-deposit-card.tsx
'use client'

// Quote drawer's deposit visibility card (deposit-accounting plan 16 §D.5). Sibling of
// `quote-jobs-card.tsx`: fetches on drawer open (no realtime for v1 — the ledger read isn't a
// field value), and renders an empty state when the quote has no deposit charge yet. One row per
// deposit charge (v1 supports N — see plan §I) showing amount + held/applied/refunded state.
// Refund detection reuses `payments-list.tsx`'s convention: a refund row whose
// `refundedTransactionId` points at the charge, excluding failed/canceled refund attempts —
// no extra query, `listPaymentsForQuote` already returns both rows for the quote.

import { Badge, type Variant } from '@auxx/ui/components/badge'
import { EmptySection } from '@auxx/ui/components/section'
import { TreeRow } from '@auxx/ui/components/tree-row'
import { CreditCard } from 'lucide-react'
import { formatCurrency } from '~/components/money/ui/line-builder/shared'
import { useSettings } from '~/hooks/use-settings'
import type { RouterOutputs } from '~/trpc/react'
import { api } from '~/trpc/react'
import type { DrawerTabProps } from '../drawer-tab-registry'

type PaymentRow = RouterOutputs['money']['listPaymentsForQuote'][number]

type DepositState = {
  label: string
  variant: Variant
  summary: string
}

/** Derives the one-line summary + badge for a deposit charge row, checking for a linked refund
 * first (a refunded charge row keeps `status: 'succeeded'` — see `payments-list.tsx`'s
 * `stripeStatusChip`, so held/applied amounts alone would misreport a refunded deposit as
 * "held"). */
function describeDeposit(
  deposit: PaymentRow,
  refunds: PaymentRow[],
  currencyCode: string
): DepositState {
  const amountLabel = formatCurrency(deposit.amount, currencyCode)
  const refund = refunds.find(
    (r) =>
      r.refundedTransactionId === deposit.id && r.status !== 'failed' && r.status !== 'canceled'
  )

  if (refund) {
    if (refund.status === 'succeeded') {
      return { label: 'Refunded', variant: 'gray', summary: `Deposit of ${amountLabel} — refunded` }
    }
    return {
      label: 'Refund pending',
      variant: 'amber',
      summary: `Deposit of ${amountLabel} — refund pending`,
    }
  }

  if (deposit.heldAmount === 0 && deposit.allocatedAmount > 0) {
    return {
      label: 'Applied',
      variant: 'green',
      summary: `Deposit of ${amountLabel} — applied to invoice`,
    }
  }

  if (deposit.allocatedAmount > 0 && deposit.heldAmount > 0) {
    const appliedLabel = formatCurrency(deposit.allocatedAmount, currencyCode)
    const heldLabel = formatCurrency(deposit.heldAmount, currencyCode)
    return {
      label: 'Partially applied',
      variant: 'amber',
      summary: `Deposit of ${amountLabel} — ${appliedLabel} applied to invoice, ${heldLabel} held`,
    }
  }

  return { label: 'Held', variant: 'amber', summary: `Deposit of ${amountLabel} received — held` }
}

/**
 * QuoteDepositCard — the deposit(s) held/applied/refunded against this quote (deposit-accounting
 * plan 16 §D.5). Registered as 'quote:deposit' in `drawer-tab-registry.tsx`. Renders an empty
 * state when the quote has no deposit charge — most quotes never take one.
 */
export function QuoteDepositCard({ recordId }: DrawerTabProps) {
  const { getSetting } = useSettings({})
  const currencyCode = (getSetting('organization.currency') as string | null) ?? 'USD'

  const { data: payments, isLoading } = api.money.listPaymentsForQuote.useQuery({
    quoteRecordId: recordId,
  })

  if (isLoading) return <EmptySection loading title='Loading deposits' />

  const deposits = payments?.filter((p) => p.kind === 'charge') ?? []
  if (deposits.length === 0)
    return (
      <EmptySection
        icon={<CreditCard className='size-5' />}
        title='No deposit'
        description='This quote has no deposit charge yet'
      />
    )

  const refunds = payments?.filter((p) => p.kind === 'refund') ?? []

  return (
    <div className='space-y-0.5'>
      {deposits.map((deposit) => {
        const state = describeDeposit(deposit, refunds, currencyCode)
        return (
          <TreeRow
            key={deposit.id}
            icon={<CreditCard className='size-4' />}
            title={<span className='truncate text-sm'>{state.summary}</span>}
            secondary={
              <Badge variant={state.variant} size='xs'>
                {state.label}
              </Badge>
            }
          />
        )
      })}
    </div>
  )
}
