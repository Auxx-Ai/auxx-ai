// apps/web/src/components/drawers/cards/quote-deposit-card.tsx
'use client'

// Quote drawer's deposit visibility card (deposit-accounting plan 16 §D.5). Sibling of
// `quote-jobs-card.tsx`. Accounting migration step 0 dropped `PaymentTransaction`, the only
// source a quote deposit charge was ever recorded against — quote deposits have no
// money-model equivalent yet, so `listPaymentsForQuote` is always empty and this card always
// renders its "no deposit" state until a money-model deposit lane exists.

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

  return null
}
