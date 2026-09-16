// apps/web/src/components/accounting/ui/ledger/books-health.tsx

'use client'

import type {
  BooksBalanceReport,
  DuplicateMovementFinding,
  SyncQueueRow,
} from '@auxx/lib/postings/client'
import { describeIncompleteRevenue } from '@auxx/lib/postings/client'
import { Alert, AlertDescription, AlertTitle } from '@auxx/ui/components/alert'
import { Badge } from '@auxx/ui/components/badge'
import { Button } from '@auxx/ui/components/button'
import { toastError } from '@auxx/ui/components/toast'
import { CircleAlert, RefreshCw, TriangleAlert } from 'lucide-react'
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
    (report.unissuedChannelCreditMemos ?? 0) > 0 ||
    (report.unpostedCreditMemos ?? 0) > 0
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
 * What the month on screen still owes the ledger: one line per outstanding job.
 *
 * 🛑 This sits under the balance sweep because the two answer different
 * questions and the first one alone is misleading. Every entry can tie perfectly
 * while a month is short a week of revenue - shipments logged and never posted,
 * a channel refund still sitting as a draft, or a refund already granted whose
 * entry nobody has run - and a Books section that showed only "0 discrepancies"
 * would report green books that are incomplete. These are the same three counts
 * the close refuses on, shown before somebody presses Post rather than after.
 *
 * ⚠️ The words come from `describeIncompleteRevenue`, the same function that
 * builds the refusal the close console renders and the sentence the refusal is
 * stored with. They used to be written out again here, and the page therefore
 * told an operator about the same fourteen draft memos twice, in two different
 * voices, a few hundred pixels apart.
 *
 * ⚠️ `null` means the question was not asked (no month on screen), and renders
 * nothing. It is NOT zero: asserting completeness that was never checked is the
 * one thing this line must not do. A zero renders nothing either - a clean month
 * needs no sentence, the way `CompletenessBanner` shows no card for complete
 * books.
 */
function CompletenessLines({ report }: BooksBalanceLineProps) {
  if (!report.month) return null

  const items = describeIncompleteRevenue({
    periodKey: report.month,
    shipments: report.unpostedShipments ?? 0,
    draftChannelMemos: report.unissuedChannelCreditMemos ?? 0,
    unpostedCreditMemos: report.unpostedCreditMemos ?? 0,
  })
  if (items.length === 0) return null

  return (
    <div className='flex flex-col gap-1'>
      {items.map((item) => (
        <p key={item.key} className='text-amber-600 text-xs'>
          {item.label}. {item.remedy}
        </p>
      ))}
    </div>
  )
}

interface FailedExportsBannerProps {
  /** ONLY refused rows. Held and in-flight ones belong in the sync queue. */
  exports: SyncQueueRow[]
  /** 🔌 Never a vendor name. `UNKNOWN_PROVIDER_LABEL` when nothing is connected. */
  providerLabel: string
  /** Opens the sync queue view, where the rest of the outstanding copies live. */
  onOpenSyncQueue: () => void
}

/**
 * Entries that ARE in the books and that the provider REFUSED.
 *
 * 🛑 **Refusals only, and that is a change** (53 §7.2.2). This banner used to
 * list every `pending` row as well, which was right while `pending` meant "in
 * flight": the hold was off, so a row resting there was a push that had not
 * answered. With the hold ON (`quickbooks.postJournalEntries` off) `pending`
 * becomes the resting state of every entry the organization posts, and a banner
 * listing all of them would be permanently open, permanently long, and
 * permanently wrong about what it was reporting - a healthy hold rendered as
 * forty problems. Held entries are the SYNC QUEUE's, reached from the rail.
 *
 * ⚠️ `hasBooksFindings` never counted exports at all, so the rail's Books group
 * was never at risk here; this banner was.
 *
 * 🛑 The wording matters. These entries are NOT missing from the statements -
 * they are in the books and it is the COPY that is outstanding. See
 * plans/accounting/export-state-split.md.
 *
 * ⚠️ Nothing is filtered by period. `periodMonth` throws on keys `GlPosting`
 * explicitly permits (`build` keys on the build number, `payout` on the payout
 * id), and the answer is to include the row anyway. `formatPeriodLabel` returns
 * a non-month key unchanged rather than throwing.
 */
export function FailedExportsBanner({
  exports: refused,
  providerLabel,
  onOpenSyncQueue,
}: FailedExportsBannerProps) {
  const utils = api.useUtils()
  // Same write as the sync queue's own Sync, deliberately: one verb must not
  // mean "release to the worker" on one surface and "push now" on another when
  // both sit on this page. An export is 3 to 5 sequential round trips to a
  // rate-limited provider, so it belongs on the queue either way - the entry
  // moves to `Sending` and the worker finishes it.
  const syncExports = api.ledger.syncExports.useMutation({
    onSuccess: (result) => {
      const refusal = result.outcomes.find((outcome) => outcome.status === 'error')
      if (refusal) {
        toastError({
          title: `Could not sync it`,
          description: refusal.message ?? 'No reason was recorded.',
        })
      }
      void utils.ledger.failedExports.invalidate()
      void utils.ledger.listPostings.invalidate()
    },
    onError: (error) => {
      toastError({ title: 'Could not sync it', description: error.message })
    },
  })

  if (refused.length === 0) return null

  return (
    <Alert variant='warning'>
      <CircleAlert />
      <AlertTitle className='flex-wrap'>
        {providerLabel} refused {refused.length} {refused.length === 1 ? 'entry' : 'entries'}. They
        are still in your books
      </AlertTitle>

      <div className='mt-2 flex flex-col gap-2'>
        {refused.map((row) => (
          <div
            key={row.glPostingId}
            className='flex flex-col gap-1 rounded-lg border bg-background p-3'>
            <div className='flex flex-wrap items-center gap-2 text-sm'>
              <Badge variant='amber' size='sm'>
                Refused
              </Badge>
              <span>{formatPeriodLabel(row.periodKey)}</span>
              <span className='font-mono text-muted-foreground text-xs'>{row.docNumber}</span>
              <span className='text-muted-foreground text-xs'>{row.postingType}</span>
              <span className='text-muted-foreground text-xs'>
                {row.attempts} {row.attempts === 1 ? 'attempt' : 'attempts'}
              </span>
              <Button
                variant='outline'
                size='sm'
                className='ml-auto'
                loading={
                  syncExports.isPending &&
                  syncExports.variables?.glPostingIds.includes(row.glPostingId)
                }
                loadingText='Syncing...'
                onClick={() => syncExports.mutate({ glPostingIds: [row.glPostingId] })}>
                <RefreshCw />
                Sync again
              </Button>
            </div>
            {row.failureReason ? (
              <p className='text-muted-foreground text-sm'>{row.failureReason}</p>
            ) : (
              <p className='text-muted-foreground text-xs'>
                No refusal was recorded. Open the sync queue to see where this one stands.
              </p>
            )}
          </div>
        ))}
      </div>

      <div className='mt-2'>
        <Button variant='ghost' size='sm' onClick={onOpenSyncQueue}>
          <RefreshCw />
          Open the sync queue
        </Button>
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
