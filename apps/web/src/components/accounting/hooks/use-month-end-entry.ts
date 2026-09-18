// apps/web/src/components/accounting/hooks/use-month-end-entry.ts

'use client'

import type { CloseBlockerItem } from '@auxx/lib/accounting/ledger/client'
import type { LedgerBlocker } from '~/components/accounting/ui/ledger/entry-blockers'
import { api } from '~/trpc/react'

interface UseMonthEndChecklistOptions {
  activePeriodKey: string
  /** False while setup is a draft, when there is no month to check. */
  enabled?: boolean
}

export interface MonthEndChecklist {
  /** One item per piece of outstanding work. Empty means the month is ready to lock. */
  items: CloseBlockerItem[]
  /** The same items as the one card `EntryBlockers` renders, or nothing. */
  blockers: LedgerBlocker[]
  isLoading: boolean
  /** Nothing outstanding: the month ties and every movement is in an entry. */
  isReady: boolean
}

/**
 * What a month still owes before it can be locked.
 *
 * 🛑 **There is no month-end entry any more.** MIGRATION step 5 deleted the
 * monthly inventory assertion: every inventory document posts its own entry
 * inside its own write's transaction, so a close has nothing to build, nothing
 * to preview and nothing to post. What it has is two checks - is every movement
 * in a posted entry, and does the ledger tie to the movements - which is what
 * this hook reads and what the closeout column renders.
 */
export function useMonthEndEntry({
  activePeriodKey,
  enabled = true,
}: UseMonthEndChecklistOptions): MonthEndChecklist {
  const query = api.ledger.closeBlockers.useQuery(
    { periodKey: activePeriodKey },
    { enabled: enabled && !!activePeriodKey, refetchOnWindowFocus: false }
  )

  const items = query.data?.items ?? []

  return {
    items,
    // One card, its rows the items - the same shape every other refusal on this
    // page takes, so the console has one treatment for all of them.
    blockers: items.length
      ? [
          {
            status: 'revenue_incomplete',
            error: `${activePeriodKey} cannot be closed yet.`,
            items,
          },
        ]
      : [],
    // 🛑 `isFetching`, not `isPending`: a DISABLED query sits at `isPending`
    // forever and would pin the checklist to a skeleton that never resolves.
    isLoading: query.isFetching,
    isReady: !query.isFetching && items.length === 0,
  }
}
