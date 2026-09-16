// apps/web/src/components/accounting/ui/reports/statement-notices.tsx

'use client'

import { CompletenessBanner } from './completeness-banner'
import { ProviderSyncMarker } from './provider-sync-marker'

export interface StatementNoticesProps {
  /**
   * The LAST date the statement covers - `asOf` for a balance sheet, an aging or
   * a trial balance, `to` for a P&L or a general ledger, December 31st for the
   * 1099 summary. Both notices are bounded by it, and every page has always
   * passed the same date to each.
   */
  through: string
}

/**
 * What a reader should know before reading the figures: what is missing from
 * them ({@link CompletenessBanner}) and how far the provider has been read
 * ({@link ProviderSyncMarker}), as two adjacent `TreeRow`s above the statement.
 *
 * 🛑 It exists for the `gap-0.5`. The two rows are one list and have to sit
 * tight against each other; the statement pages lay their column out at
 * `gap-3`, which is right between a toolbar, a table and a card and wrong
 * between two rows of the same list - at that distance they read as two
 * unrelated notices rather than one block of caveats. Pairing them here rather
 * than wrapping them on each of the six pages keeps that spacing decision in
 * one place, and neither row renders anything when it has nothing to say, so
 * the wrapper collapses to nothing on a healthy org.
 */
export function StatementNotices({ through }: StatementNoticesProps) {
  return (
    <div className='flex flex-col gap-0.5'>
      <CompletenessBanner asOf={through} />
      <ProviderSyncMarker through={through} />
    </div>
  )
}
