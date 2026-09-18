// apps/web/src/components/drawers/cards/quote-deposit-card.tsx
'use client'

// Quote drawer's deposit visibility card (deposit-accounting plan 16 §D.5). Sibling of
// `quote-jobs-card.tsx`.

import { EmptySection } from '@auxx/ui/components/section'
import { CreditCard } from 'lucide-react'
import { api } from '~/trpc/react'
import type { DrawerTabProps } from '../drawer-tab-registry'

/**
 * QuoteDepositCard — the deposit(s) held/applied/refunded against this quote. Registered as
 * 'quote:deposit' in `drawer-tab-registry.tsx`.
 */
export function QuoteDepositCard({ recordId }: DrawerTabProps) {
  const { data: payments, isLoading } = api.money.listPaymentsForQuote.useQuery({
    quoteRecordId: recordId,
  })

  if (isLoading) return <EmptySection loading title='Loading deposits' />

  if (!payments?.length)
    return (
      <EmptySection
        icon={<CreditCard className='size-5' />}
        title='No deposit'
        description='This quote has no deposit charge yet'
      />
    )

  return (
    <div className='space-y-2'>
      {payments.map((payment) => (
        <div
          key={payment.id}
          className='flex items-center justify-between rounded-md border px-3 py-2 text-sm'>
          <span className='text-muted-foreground'>
            {new Date(payment.date).toLocaleDateString()}
          </span>
          <span>
            {formatCurrency(payment.amount)}
            {payment.heldAmount > 0 ? ` · ${formatCurrency(payment.heldAmount)} held` : ''}
          </span>
        </div>
      ))}
    </div>
  )
}

function formatCurrency(minor: number): string {
  return (minor / 100).toLocaleString(undefined, { style: 'currency', currency: 'USD' })
}
