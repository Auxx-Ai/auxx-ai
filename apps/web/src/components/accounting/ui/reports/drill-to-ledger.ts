// apps/web/src/components/accounting/ui/reports/drill-to-ledger.ts

'use client'

/**
 * "Show me the lines behind this figure", for a row click on any statement.
 *
 * 🛑 The general ledger IS that answer, narrowed to one account — its own file
 * header calls itself "the same query without the `glAccountId` filter,
 * grouped". So a statement row links there rather than opening a second
 * drill-down surface that has to agree with it. The dialog that used to do
 * this was a third copy of the same read, it covered the figure that prompted
 * the question, and it could not be linked to.
 */

import { useRouter } from 'next/navigation'
import { useCallback } from 'react'

export interface DrillToLedgerRange {
  /** `YYYY-MM-DD`. The statement's own start, or the books' floor for an as-of report. */
  from: string
  /** `YYYY-MM-DD`, inclusive. */
  to: string
}

/**
 * Opens `/app/accounting/reports/general-ledger` for one account over `range`.
 *
 * ⚠️ An AS-OF statement (the trial balance, the balance sheet) has no start
 * date, and its figures are cumulative from the beginning of the books. Pass
 * the cutoff as `from` — omitting it would land on the ledger's own default
 * month and show a fraction of the balance that was clicked.
 */
export function useDrillToLedger() {
  const router = useRouter()
  return useCallback(
    (glAccountId: string, range: DrillToLedgerRange) => {
      const params = new URLSearchParams({
        account: glAccountId,
        from: range.from,
        to: range.to,
      })
      router.push(`/app/accounting/reports/general-ledger?${params.toString()}`)
    },
    [router]
  )
}
