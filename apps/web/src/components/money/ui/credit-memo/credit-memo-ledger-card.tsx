// apps/web/src/components/money/ui/credit-memo/credit-memo-ledger-card.tsx
'use client'

// `credit_memo:ledger`, the postings filed under this memo: the issue entry
// (`Dr 4090 / Dr tax / Cr 1100`, plans/accounting/tasks/10-credit-memos.md
// §3.1) and its reversal after a void. Pins `sourceType` the way
// `accounting/ui/ledger-card-registrations.tsx` does for the invoice; the
// string is what `postings/build-credit-memo-entry.ts` files its lines under
// (`CREDIT_MEMO_SOURCE_TYPE`), the same by convention, never by construction.

import { LedgerCard } from '~/components/accounting/ui/ledger-card'
import type { DrawerTabProps } from '~/components/drawers/drawer-tab-registry'

export function CreditMemoLedgerCard(props: DrawerTabProps) {
  return <LedgerCard {...props} sourceType='credit_memo' />
}
