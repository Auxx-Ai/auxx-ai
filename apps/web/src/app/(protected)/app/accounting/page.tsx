// apps/web/src/app/(protected)/app/accounting/page.tsx

import { LedgerPage } from '~/components/accounting/ui/ledger/ledger-page'

/**
 * Module home — the RESOLVED period (13-accounting-ui.md §5.1).
 *
 * 🛑 Renders, never redirects. A redirect would make the module home URL
 * unstable and break "Accounting" as a bookmark. `LedgerPage` with no
 * `periodKey` resolves one itself: the earliest unposted month, else the most
 * recent posted one — and when setup is not finalized it renders the
 * getting-started checklist instead.
 */
export default function AccountingHome() {
  return <LedgerPage />
}
