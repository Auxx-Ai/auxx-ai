// apps/web/src/components/accounting/ui/ledger/ledger-stats.tsx

'use client'

import type { BooksBalanceReport, ClosePeriod } from '@auxx/lib/postings/client'
import { StatCards } from '@auxx/ui/components/stat-card'
import { BookOpenCheck, FileText, Lock, Scale } from 'lucide-react'
import { EMPTY_CELL } from './format'

type PeriodState = ClosePeriod['state']

const STATE_LABEL: Record<PeriodState, string> = {
  open: 'Open',
  locked: 'Locked',
}

/** The title's tint per state, on the same scale the banking stats use. */
const STATE_COLOR: Record<PeriodState, string> = {
  open: 'text-accent-500',
  locked: 'text-comparison-500',
}

interface LedgerStatsProps {
  loading: boolean
  /** `undefined` when no month resolved at all. */
  period: ClosePeriod | undefined
  periodLabel: string
  /** True while the close checklist is still being read. */
  entryPending: boolean
  /** How many pieces of work stand between this month and a close. */
  blockerCount: number
  /** Other entries this month: postings plus drafts nobody has posted. */
  entryCount: number | null
  draftCount: number | null
  balanceReport: BooksBalanceReport | undefined
  currencyCode: string
}

/**
 * The four numbers somebody opens the ledger to see, on the same `StatCards`
 * strip the banking review queue uses.
 *
 * 🛑 The Books card is NEVER a bare green tick. "0 discrepancies out of 0" and
 * "0 out of 412" are very different answers, which is why `postingsChecked`
 * rides along in the description - a tick that renders identically for both is a
 * check that cannot fail.
 *
 * ⚠️ The Ready card distinguishes "still checking" from "nothing to do": a
 * zero painted before the check answered is a claim nobody made.
 */
export function LedgerStats({
  loading,
  period,
  periodLabel,
  entryPending,
  blockerCount,
  entryCount,
  draftCount,
  balanceReport,
  currencyCode,
}: LedgerStatsProps) {
  const mono = 'font-mono tabular-nums'
  const state = period?.state
  const discrepancies = balanceReport?.discrepancies.length ?? 0

  return (
    <StatCards
      loading={loading}
      cards={[
        {
          title: periodLabel || 'No month',
          icon: state === 'locked' ? <Lock className='size-4' /> : <Scale className='size-4' />,
          color: state ? STATE_COLOR[state] : undefined,
          body: <span className='text-2xl'>{state ? STATE_LABEL[state] : EMPTY_CELL}</span>,
          description: state === 'locked' ? 'Nothing can post into it' : 'Still accepting entries',
        },
        {
          // 🛑 The close POSTS nothing (MIGRATION step 5). What it owes is a
          // list of work, so this card counts that rather than an entry total.
          title: 'Ready to close',
          icon: <BookOpenCheck className='size-4' />,
          color: blockerCount > 0 ? 'text-bad-500' : undefined,
          body: <span className={mono}>{entryPending ? EMPTY_CELL : blockerCount}</span>,
          description: entryPending
            ? 'Checking the month'
            : blockerCount === 0
              ? 'Every movement is in an entry and inventory ties'
              : `${blockerCount === 1 ? 'thing' : 'things'} to do before locking`,
        },
        {
          title: 'Entries this month',
          icon: <FileText className='size-4' />,
          body: <span className={mono}>{entryCount ?? EMPTY_CELL}</span>,
          description:
            draftCount && draftCount > 0
              ? `${draftCount} ${draftCount === 1 ? 'draft is' : 'drafts are'} waiting`
              : 'Everything here is posted',
        },
        {
          title: 'Books',
          icon: <Scale className='size-4' />,
          color: discrepancies > 0 ? 'text-bad-500' : undefined,
          body: <span className={mono}>{balanceReport ? discrepancies : EMPTY_CELL}</span>,
          description: balanceReport
            ? `${discrepancies === 1 ? 'discrepancy' : 'discrepancies'} out of ${balanceReport.postingsChecked} ${balanceReport.postingsChecked === 1 ? 'posting' : 'postings'} checked`
            : 'The balance sweep has not answered yet',
        },
      ]}
    />
  )
}
