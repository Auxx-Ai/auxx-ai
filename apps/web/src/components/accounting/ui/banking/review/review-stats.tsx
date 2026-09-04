// apps/web/src/components/accounting/ui/banking/review/review-stats.tsx

'use client'

import type { ReviewQueueStats } from '@auxx/lib/banking/review/client'
import { StatCards } from '@auxx/ui/components/stat-card'
import { CalendarClock, Inbox, TrendingDown, TrendingUp } from 'lucide-react'
import { EMPTY_CELL, formatMinor } from '../../ledger/format'

interface ReviewStatsProps {
  stats: ReviewQueueStats | undefined
  loading: boolean
  currencyCode: string
  /** Whether one account is selected. The coverage card is per account. */
  accountSelected: boolean
}

/**
 * The four numbers a bookkeeper opens this page to see
 * (plans/accounting/ui-plan.md §2.8).
 *
 * 🛑 The fourth card is the COVERAGE FLOOR, and it is here rather than buried in
 * settings because a balance sheet that spans a hole in the bank data renders
 * happily and is wrong (bank plan 01 §4.1). The one moment somebody is looking
 * at bank lines is the moment to tell them where the record actually starts.
 *
 * ⚠️ Coverage is per ACCOUNT, so with "All accounts" selected the card says so
 * rather than showing the first account's floor - a date that would be wrong for
 * every other account on the screen.
 */
export function ReviewStats({ stats, loading, currencyCode, accountSelected }: ReviewStatsProps) {
  const mono = 'font-mono tabular-nums'

  return (
    <StatCards
      loading={loading}
      cards={[
        {
          title: 'For review',
          icon: <Inbox className='size-4' />,
          body: <span className={mono}>{stats?.forReviewCount ?? 0}</span>,
          description:
            stats && stats.unreviewedCount > stats.forReviewCount
              ? `${stats.unreviewedCount - stats.forReviewCount} more have a suggestion waiting`
              : 'Lines with nothing proposed yet',
        },
        {
          title: 'Oldest unreviewed',
          icon: <CalendarClock className='size-4' />,
          body: <span className={mono}>{stats?.oldestUnreviewedDate ?? EMPTY_CELL}</span>,
          description: 'How far back the queue reaches. A backlog is measured in months, not rows',
        },
        {
          title: 'Unreviewed in',
          icon: <TrendingUp className='size-4' />,
          body: (
            <span className={mono}>{formatMinor(stats?.unreviewedInMinor ?? 0, currencyCode)}</span>
          ),
          description: 'Money that arrived and has not been matched or coded',
        },
        {
          title: accountSelected ? 'Coverage from' : 'Unreviewed out',
          icon: accountSelected ? (
            <CalendarClock className='size-4' />
          ) : (
            <TrendingDown className='size-4' />
          ),
          body: (
            <span className={mono}>
              {accountSelected
                ? (stats?.coverageFrom ?? EMPTY_CELL)
                : formatMinor(stats?.unreviewedOutMinor ?? 0, currencyCode)}
            </span>
          ),
          description: accountSelected
            ? stats && stats.coverageGapCount > 0
              ? `${stats.coverageGapCount} possible gap${stats.coverageGapCount === 1 ? '' : 's'} in this account's data`
              : 'The earliest date this account holds data for'
            : 'Money that left and has not been matched or coded',
        },
      ]}
    />
  )
}
