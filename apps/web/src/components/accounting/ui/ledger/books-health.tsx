// apps/web/src/components/accounting/ui/ledger/books-health.tsx

'use client'

import type { BooksBalanceReport, UnpostedPeriod } from '@auxx/lib/postings/client'
import { Badge } from '@auxx/ui/components/badge'
import { cn } from '@auxx/ui/lib/utils'
import { CircleAlert, Loader, Scale } from 'lucide-react'
import { formatPeriodLabel } from './format'

interface BooksBalanceLineProps {
  report: BooksBalanceReport
}

/**
 * The after-the-fact balance sweep.
 *
 * 🛑 Never a bare green tick. "0 discrepancies out of 0" and "0 out of 412" are
 * very different answers, and `postingsChecked` rides along on the shipped type
 * precisely so the two can be told apart. A tick that renders identically for
 * both is a check that cannot fail (13-accounting-ui.md §5.1).
 */
export function BooksBalanceLine({ report }: BooksBalanceLineProps) {
  const count = report.discrepancies.length
  const clean = report.balanced && count === 0

  return (
    <div className='flex flex-col gap-2'>
      <div className='flex items-center gap-2 text-sm'>
        <Scale className={cn('size-4', clean ? 'text-muted-foreground' : 'text-destructive')} />
        <span className={cn(!clean && 'text-destructive')}>
          {count} {count === 1 ? 'discrepancy' : 'discrepancies'} out of {report.postingsChecked}{' '}
          {report.postingsChecked === 1 ? 'posting' : 'postings'} checked
        </span>
      </div>

      {report.postingsChecked === 0 && (
        <p className='text-xs text-muted-foreground'>
          Nothing has been posted yet, so nothing was checked. This is not the same as the books
          being in balance.
        </p>
      )}

      {count > 0 && (
        <div className='flex flex-col gap-1.5'>
          {report.discrepancies.map((discrepancy) => (
            <div
              key={discrepancy.glPostingId}
              className='rounded-lg border border-destructive/40 bg-destructive/5 p-2 text-xs'>
              <span className='font-mono'>{discrepancy.docNumber}</span>{' '}
              <span className='text-muted-foreground'>
                debits {discrepancy.totalDebitMinor}, credits {discrepancy.totalCreditMinor},
                recorded total {discrepancy.recordedTotalMinor} (minor units)
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

interface UnpostedPeriodsBannerProps {
  periods: UnpostedPeriod[]
}

/**
 * Entries that were claimed but never landed in the books.
 *
 * 🛑 `pending` and `failed` stay visually distinct. They call for different
 * actions: `pending` is claimed and in flight (or claimed by a run that died
 * mid-push, which the idempotency ladder heals), while `failed` was attempted and
 * refused and carries the reason. `attempts` and `failureReason` are on the
 * shipped row precisely so nobody is sent to the logs for a string that is
 * already in the database.
 *
 * ⚠️ Nothing is filtered out of this list. `periodMonth` throws on keys
 * `GlPosting` explicitly permits (`build` keys on the build number, `payout` on
 * the payout id), and the answer is to include the row anyway, because
 * under-reporting is the dangerous direction: a bookkeeper who is not shown an
 * entry closes the month without it. `formatPeriodLabel` returns a non-month key
 * unchanged rather than throwing.
 */
export function UnpostedPeriodsBanner({ periods }: UnpostedPeriodsBannerProps) {
  if (periods.length === 0) return null

  const failed = periods.filter((period) => period.status === 'failed')
  const pending = periods.filter((period) => period.status === 'pending')

  return (
    <div
      className={cn(
        'flex flex-col gap-3 rounded-xl border p-4',
        failed.length > 0 ? 'border-destructive/40 bg-destructive/5' : 'border-border bg-muted/40'
      )}>
      <div className='flex items-center gap-2'>
        {failed.length > 0 ? (
          <CircleAlert className='size-4 text-destructive' />
        ) : (
          <Loader className='size-4 text-muted-foreground' />
        )}
        <span className='font-medium'>
          {periods.length} {periods.length === 1 ? 'entry has' : 'entries have'} been claimed but
          are not in the books
        </span>
      </div>

      <div className='flex flex-col gap-2'>
        {[...failed, ...pending].map((period) => (
          <div
            key={period.glPostingId}
            className='flex flex-col gap-1 rounded-lg border bg-background p-3'>
            <div className='flex flex-wrap items-center gap-2 text-sm'>
              <Badge variant={period.status === 'failed' ? 'red' : 'amber'} size='sm'>
                {period.status === 'failed' ? 'Failed' : 'In flight'}
              </Badge>
              <span>{formatPeriodLabel(period.periodKey)}</span>
              <span className='font-mono text-xs text-muted-foreground'>{period.docNumber}</span>
              <span className='text-xs text-muted-foreground'>{period.postingType}</span>
              <span className='text-xs text-muted-foreground'>
                {period.attempts} {period.attempts === 1 ? 'attempt' : 'attempts'}
              </span>
            </div>
            {period.failureReason ? (
              <p className='text-sm text-muted-foreground'>{period.failureReason}</p>
            ) : (
              <p className='text-xs text-muted-foreground'>
                No failure was recorded. This entry is still in flight, or the run that claimed it
                died mid-push and the next attempt will heal it.
              </p>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
