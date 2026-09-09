// apps/web/src/components/accounting/ui/ledger/books-health.tsx

'use client'

import type { BooksBalanceReport, FailedExport } from '@auxx/lib/postings/client'
import { Badge } from '@auxx/ui/components/badge'
import { Button } from '@auxx/ui/components/button'
import { toastError } from '@auxx/ui/components/toast'
import { cn } from '@auxx/ui/lib/utils'
import { CircleAlert, Loader, RefreshCw, Scale } from 'lucide-react'
import { api } from '~/trpc/react'
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

      <CompletenessLines report={report} />

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

/**
 * What the month on screen still owes the ledger: one sentence per count.
 *
 * 🛑 This sits under the balance sweep because the two answer different
 * questions and the first one alone is misleading. Every entry can tie perfectly
 * while a month is short a week of revenue - shipments logged and never posted,
 * or a channel refund still sitting as a draft - and a Books section that showed
 * only "0 discrepancies" would report green books that are incomplete. These are
 * the same two counts the close refuses on, shown before somebody presses Post
 * rather than after.
 *
 * ⚠️ `null` means the question was not asked (no month on screen), and renders
 * nothing. It is NOT zero: asserting completeness that was never checked is the
 * one thing this line must not do. A zero renders nothing either - a clean month
 * needs no sentence, the way `CompletenessBanner` shows no card for complete
 * books.
 */
function CompletenessLines({ report }: BooksBalanceLineProps) {
  const shipments = report.unpostedShipments ?? 0
  const memos = report.unissuedChannelCreditMemos ?? 0
  if (shipments === 0 && memos === 0) return null

  const month = report.month ? formatPeriodLabel(report.month) : 'this month'

  return (
    <div className='flex flex-col gap-1'>
      {shipments > 0 && (
        <p className='text-xs text-amber-600'>
          {shipments} {shipments === 1 ? 'shipment in' : 'shipments in'} {month}{' '}
          {shipments === 1 ? 'has' : 'have'} not been posted, so that revenue is not in the books
          yet.
        </p>
      )}
      {memos > 0 && (
        <p className='text-xs text-amber-600'>
          {memos} channel credit {memos === 1 ? 'memo' : 'memos'} dated in {month}{' '}
          {memos === 1 ? 'is' : 'are'} still a draft. Issue or void {memos === 1 ? 'it' : 'them'}{' '}
          before closing.
        </p>
      )}
    </div>
  )
}

interface FailedExportsBannerProps {
  exports: FailedExport[]
}

/**
 * Entries that ARE in the books and have not reached the accounting system.
 *
 * 🛑 The wording matters and it is the whole point of the export split. This
 * banner used to say these entries were "claimed but not in the books", which
 * was true only because a refused push took them out of the books. It no longer
 * does, so the banner must not imply the statements are short - they are not.
 * What is outstanding is the COPY. See plans/accounting/export-state-split.md.
 *
 * 🛑 `pending` and `failed` stay visually distinct. They call for different
 * actions: `pending` is owed and has not been refused (in flight, or claimed by
 * a run that died before the push), while `failed` was attempted and refused and
 * carries the reason. `attempts` and `failureReason` are on the shipped row
 * precisely so nobody is sent to the logs for a string already in the database.
 *
 * ⚠️ Nothing is filtered out of this list. `periodMonth` throws on keys
 * `GlPosting` explicitly permits (`build` keys on the build number, `payout` on
 * the payout id), and the answer is to include the row anyway.
 * `formatPeriodLabel` returns a non-month key unchanged rather than throwing.
 */
export function FailedExportsBanner({ exports: owed }: FailedExportsBannerProps) {
  const utils = api.useUtils()
  const retryExport = api.ledger.retryExport.useMutation({
    onSuccess: (result) => {
      if (result.exportStatus === 'failed') {
        toastError({
          title: 'The accounting system refused it again',
          description: result.error ?? 'No reason was recorded.',
        })
      }
      void utils.ledger.failedExports.invalidate()
      void utils.ledger.listPostings.invalidate()
    },
    onError: (error) => {
      toastError({ title: 'Could not retry the export', description: error.message })
    },
  })

  if (owed.length === 0) return null

  const failed = owed.filter((row) => row.exportStatus === 'failed')
  const pending = owed.filter((row) => row.exportStatus === 'pending')

  return (
    <div
      className={cn(
        'flex flex-col gap-3 rounded-xl border p-4',
        failed.length > 0 ? 'border-amber-500/40 bg-amber-500/5' : 'border-border bg-muted/40'
      )}>
      <div className='flex items-center gap-2'>
        {failed.length > 0 ? (
          <CircleAlert className='size-4 text-amber-600' />
        ) : (
          <Loader className='size-4 text-muted-foreground' />
        )}
        <span className='font-medium'>
          {owed.length} {owed.length === 1 ? 'entry is' : 'entries are'} in your books but not in
          the accounting system
        </span>
      </div>

      <div className='flex flex-col gap-2'>
        {[...failed, ...pending].map((row) => (
          <div
            key={row.glPostingId}
            className='flex flex-col gap-1 rounded-lg border bg-background p-3'>
            <div className='flex flex-wrap items-center gap-2 text-sm'>
              <Badge variant={row.exportStatus === 'failed' ? 'amber' : 'gray'} size='sm'>
                {row.exportStatus === 'failed' ? 'Export refused' : 'Export pending'}
              </Badge>
              <span>{formatPeriodLabel(row.periodKey)}</span>
              <span className='font-mono text-xs text-muted-foreground'>{row.docNumber}</span>
              <span className='text-xs text-muted-foreground'>{row.postingType}</span>
              <span className='text-xs text-muted-foreground'>
                {row.attempts} {row.attempts === 1 ? 'attempt' : 'attempts'}
              </span>
              <Button
                variant='outline'
                size='sm'
                className='ml-auto'
                loading={
                  retryExport.isPending && retryExport.variables?.glPostingId === row.glPostingId
                }
                loadingText='Retrying...'
                onClick={() => retryExport.mutate({ glPostingId: row.glPostingId })}>
                <RefreshCw />
                Retry export
              </Button>
            </div>
            {row.failureReason ? (
              <p className='text-sm text-muted-foreground'>{row.failureReason}</p>
            ) : (
              <p className='text-xs text-muted-foreground'>
                No refusal was recorded. This export is still in flight, or the run that claimed the
                entry died before pushing it.
              </p>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
