// apps/web/src/components/accounting/ui/ledger/ledger-stats.tsx

'use client'

import type { BooksBalanceReport, ClosePeriod } from '@auxx/lib/postings/client'
import { StatCards } from '@auxx/ui/components/stat-card'
import { BookOpenCheck, FileText, Lock, Scale } from 'lucide-react'
import { EMPTY_CELL, formatMinor } from './format'

type PeriodState = ClosePeriod['state']

const STATE_LABEL: Record<PeriodState, string> = {
  open: 'Open',
  posted: 'Posted',
  locked: 'Locked',
}

/** The title's tint per state, on the same scale the banking stats use. */
const STATE_COLOR: Record<PeriodState, string> = {
  open: 'text-accent-500',
  posted: 'text-good-500',
  locked: 'text-comparison-500',
}

interface LedgerStatsProps {
  loading: boolean
  /** `undefined` when no month resolved at all. */
  period: ClosePeriod | undefined
  periodLabel: string
  /** The month-end entry's total - projected for an open month, stored for a posted one. */
  entryTotalMinor: number | null
  /** True while the projection is still being built. */
  entryPending: boolean
  /** How many refusals stand between this month and a close. */
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
 * ⚠️ The entry card distinguishes three states that a single number would
 * flatten: a projection that is still building, a month whose entry was REFUSED
 * (the refusals are the whole of what happened, so there is no total), and a
 * real total. An entry that could not be built must not read as $0.00.
 */
export function LedgerStats({
  loading,
  period,
  periodLabel,
  entryTotalMinor,
  entryPending,
  blockerCount,
  entryCount,
  draftCount,
  balanceReport,
  currencyCode,
}: LedgerStatsProps) {
  const mono = 'font-mono tabular-nums'
  // An amount is wider than a count, so it gets a smaller size than the card's
  // default 2xl, which overflows a narrow column.
  const amountMono = 'font-mono tabular-nums text-lg'

  const state = period?.state
  const isPosted = !!state && state !== 'open'
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
          description: period?.docNumber ? (
            <span className='font-mono'>{period.docNumber}</span>
          ) : (
            'No month-end entry yet'
          ),
        },
        {
          title: 'Month-end entry',
          icon: <BookOpenCheck className='size-4' />,
          body: (
            <span className={amountMono}>
              {entryPending
                ? EMPTY_CELL
                : entryTotalMinor === null
                  ? EMPTY_CELL
                  : formatMinor(entryTotalMinor, currencyCode)}
            </span>
          ),
          description: entryPending
            ? 'Building the projection'
            : entryTotalMinor === null
              ? blockerCount > 0
                ? `Not built - ${blockerCount === 1 ? 'one refusal' : `${blockerCount} refusals`} below`
                : 'Not built'
              : isPosted
                ? 'Posted, exactly as stored'
                : 'Projected - nothing is posted yet',
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
