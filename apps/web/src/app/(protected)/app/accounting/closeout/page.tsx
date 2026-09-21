// apps/web/src/app/(protected)/app/accounting/closeout/page.tsx

import { CloseoutPage } from '~/components/accounting/ui/ledger/closeout-page'

/**
 * Closeout — the month, at `?month=YYYY-MM` (81-one-accounting-shell.md §2).
 * The shell, the one `MainPageContent` and the topbar are the segment layout's.
 */
export default function AccountingCloseout() {
  return <CloseoutPage />
}
