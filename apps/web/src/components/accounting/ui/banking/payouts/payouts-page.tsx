// apps/web/src/components/accounting/ui/banking/payouts/payouts-page.tsx

'use client'

import { useQueryState } from 'nuqs'
import { PayoutEvidencePage } from './payout-evidence-page'
import { SettlementHistory } from './settlement-history'

/** Inspect imported payouts, with access to the existing settlement history. */
export function PayoutsPage() {
  const [view, setView] = useQueryState('view')

  if (view === 'settlements') {
    return <SettlementHistory onEvidence={() => void setView(null)} />
  }

  return <PayoutEvidencePage onHistory={() => void setView('settlements')} />
}
