// apps/web/src/components/accounting/ui/ledger/books-health.tsx

'use client'

import type {
  BooksBalanceReport,
  DuplicateMovementFinding,
  FailedExport,
} from '@auxx/lib/postings/client'
import { Alert, AlertDescription, AlertTitle } from '@auxx/ui/components/alert'
import { Badge } from '@auxx/ui/components/badge'
import { Button } from '@auxx/ui/components/button'
import { toastError } from '@auxx/ui/components/toast'
import { CircleAlert, Loader, RefreshCw, TriangleAlert } from 'lucide-react'
import { useState } from 'react'
import { AccountLabel } from '~/components/accounting/ui/account-label'
import { PostingLinesDialog } from '~/components/accounting/ui/ledger-card'
import { api } from '~/trpc/react'
import { formatAccountingDate, formatMinor, formatPeriodLabel } from './format'

interface BooksBalanceLineProps {
  report: BooksBalanceReport
}

/**
 * Whether the sweep found anything that needs room on screen.
 *
 * 🛑 The COUNT is not a finding. "0 discrepancies out of 46 postings checked" is
 * the standing answer and it belongs on the stats strip (`ledger-stats.tsx`),
 * which renders it whether it is news or not. Repeating it in the rail said the
 * same sentence twice on one screen, next to an icon whose only job was to
 * decorate it. What the rail is for is the rest of this file: the entries that
 * did NOT tie, the months that are short, and the caveat that nothing was
 * checked at all.
 */
export function hasBooksFindings(report: BooksBalanceReport): boolean {
  return (
    report.discrepancies.length > 0 ||
    report.postingsChecked === 0 ||
    (report.unpostedShipments ?? 0) > 0 ||
    (report.unissuedChannelCreditMemos ?? 0) > 0
  )
}

/**
 * What the after-the-fact balance sweep FOUND - never the fact that it ran.
 *
 * 🛑 "Nothing was checked" is still a finding, which is why `postingsChecked
 * === 0` gets its own line rather than being folded into a clean result.
 * "0 discrepancies out of 0" and "0 out of 412" are very different answers, and
 * `postingsChecked` rides along on the shipped type precisely so the two can be
 * told apart (13-accounting-ui.md §5.1). What this must never do is render the
 * same for both.
 */
export function BooksBalanceLine({ report }: BooksBalanceLineProps) {
  const count = report.discrepancies.length

  return (
    <div className='flex flex-col gap-2'>
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
    <Alert variant={failed.length > 0 ? 'warning' : 'neutral'}>
      {failed.length > 0 ? <CircleAlert /> : <Loader />}
      <AlertTitle className='flex-wrap'>
        {owed.length} {owed.length === 1 ? 'entry is' : 'entries are'} in your books but not in the
        accounting system
      </AlertTitle>

      <div className='mt-2 flex flex-col gap-2'>
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
    </Alert>
  )
}

/** `'bank_transaction'` reads `'bank coding'` - what a person did, not the enum. */
const SOURCE_TYPE_LABELS: Record<string, string> = {
  payout: 'payout',
  bank_transaction: 'bank coding',
  bank_deposit: 'bank deposit',
}

function sourceTypeLabel(sourceType: string): string {
  return SOURCE_TYPE_LABELS[sourceType] ?? sourceType.replace(/_/g, ' ')
}

interface DuplicateMovementsCardProps {
  findings: DuplicateMovementFinding[]
  currencyCode: string
  bookTimeZone: string
}

/**
 * The duplicate detector's card (plans/accounting/tasks/18-two-feeds-one-
 * author.md §1, DECIDED "no matter what"): two or more posted lines that moved
 * one bank account by the same amount, in the same direction, from more than
 * one source, within a couple of days of each other.
 *
 * 🛑 **Never auto-fixed, and there is no action button beyond opening a
 * posting.** A detector that "resolved" a duplicate would have guessed which
 * entry was real; the remedy is a person choosing to reverse one in auxx or
 * delete one in QuickBooks (§1.1 c's mockup, verbatim in the closing sentence
 * below). A CARD, never a toast - `FailedExportsBanner` above follows the same
 * rule and for the same reason: this is a finding on ledger surfaces, not a
 * transient notice.
 */
export function DuplicateMovementsCard({
  findings,
  currencyCode,
  bookTimeZone,
}: DuplicateMovementsCardProps) {
  const [openPostingId, setOpenPostingId] = useState<string | null>(null)

  if (findings.length === 0) return null

  return (
    <div className='flex flex-col gap-3'>
      {findings.map((finding) => {
        const key = `${finding.glAccountId}-${finding.amountMinor}-${finding.direction}-${finding.entries[0]?.glPostingId ?? ''}`
        return (
          <Alert key={key} variant='warning'>
            <TriangleAlert />
            <AlertTitle className='flex-wrap items-baseline'>
              Possible duplicate
              <span className='opacity-70'>-</span>
              <AccountLabel
                account={{ code: finding.accountCode, name: finding.accountName }}
                density='compact'
              />
            </AlertTitle>
            <AlertDescription>
              {finding.entries.length} entries move this account by{' '}
              {formatMinor(finding.amountMinor, currencyCode)} from different sources.
            </AlertDescription>

            <div className='mt-2 flex flex-col gap-1.5'>
              {finding.entries.map((entry) => (
                <button
                  key={entry.glPostingId}
                  type='button'
                  className='flex flex-wrap items-center gap-2 rounded-lg border bg-background px-3 py-2 text-left text-sm hover:bg-muted/40'
                  onClick={() => setOpenPostingId(entry.glPostingId)}>
                  <span className='font-mono'>{entry.docNumber}</span>
                  <span className='text-xs text-muted-foreground'>
                    {sourceTypeLabel(entry.sourceType)}
                  </span>
                  <span className='ml-auto text-xs text-muted-foreground'>
                    posted {formatAccountingDate(entry.txnDate, bookTimeZone)}
                  </span>
                </button>
              ))}
            </div>

            <AlertDescription className='text-xs'>
              Nothing was changed. Reverse one, or delete it in QuickBooks.
            </AlertDescription>
          </Alert>
        )
      })}

      <PostingLinesDialog
        postingId={openPostingId}
        onOpenChange={(open) => !open && setOpenPostingId(null)}
        currencyCode={currencyCode}
      />
    </div>
  )
}
