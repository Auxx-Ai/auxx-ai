// apps/web/src/app/(protected)/app/accounting/outbox/page.tsx

import { OutboxPage } from '~/components/accounting/ui/ledger/outbox-page'

/**
 * The Outbox — every period, at `?tab=` (81-one-accounting-shell.md §2).
 * It takes no `?month=`: nothing it lists is bound to one.
 */
export default function AccountingOutbox() {
  return <OutboxPage />
}
