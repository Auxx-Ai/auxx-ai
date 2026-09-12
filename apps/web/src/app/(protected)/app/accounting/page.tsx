// apps/web/src/app/(protected)/app/accounting/page.tsx

import { LedgerPage } from '~/components/accounting/ui/ledger/ledger-page'

/**
 * The ledger — the module's ONE route (13-accounting-ui.md §5.1).
 *
 * 🛑 Renders, never redirects. A redirect would make the module home URL
 * unstable and break "Accounting" as a bookmark. The month rides on this URL as
 * `?month=YYYY-MM` (`useAccountingMonth`); with no param `LedgerPage` resolves
 * one itself — the earliest unposted month, else the most recent posted one —
 * and when setup is not finalized it renders the getting-started checklist
 * instead.
 */
export default function AccountingHome() {
  return <LedgerPage />
}
