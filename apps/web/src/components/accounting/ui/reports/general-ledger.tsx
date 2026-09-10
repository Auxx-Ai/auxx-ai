// apps/web/src/components/accounting/ui/reports/general-ledger.tsx

'use client'

import { GENERAL_LEDGER_COLUMNS, toCsvRows } from '@auxx/lib/postings/client'
import { Button } from '@auxx/ui/components/button'
import { ScrollArea } from '@auxx/ui/components/scroll-area'
import { Skeleton } from '@auxx/ui/components/skeleton'
import { toastError } from '@auxx/ui/components/toast'
import { BookOpen, TriangleAlert } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useQueryState } from 'nuqs'
import { useMemo } from 'react'
import { useLedgerPeriod } from '~/components/accounting/hooks/use-ledger-period'
import { EmptyState } from '~/components/global/empty-state'
import { downloadCsv } from '~/lib/csv'
import { api } from '~/trpc/react'
import { CompletenessBanner } from './completeness-banner'
import { ProviderSyncMarker } from './provider-sync-marker'
import { ReportErrorCard } from './report-error-card'
import {
  periodEndDate,
  periodKeyFromDate,
  periodStartDate,
  toStatementTableRows,
} from './report-helpers'
import { ReportToolbar } from './report-toolbar'
import { StatementTable } from './statement-table'

/**
 * What a truncated ledger says on the screen.
 *
 * 🛑 This is the THIRD place the same fact is stated, not the only one.
 * `toGeneralLedgerRows` prepends its own `INCOMPLETE` row ahead of every
 * account, so the warning is already row 1 of the table, row 1 of the CSV and
 * row 1 of the PDF - the exports carry it because they render the same rows
 * this page does. This card and the verdict strip below the table are the
 * screen's own, louder copies, because a person scanning figures reads a
 * bordered red card and does not read row 1.
 */
const TRUNCATED_HEADLINE = 'This general ledger is incomplete'

/**
 * `/app/accounting/reports/general-ledger` (`plans/accounting/tasks/
 * 21-the-books-stand-alone.md` §5) - the sixth statement, and the one a
 * filing accountant asks for first.
 *
 * A from/to RANGE like the P&L, not an as-of point: a general ledger is every
 * posted line over a period, one section per account, each with its opening
 * balance, its lines and its ending balance. The row model, the toolbar, the
 * completeness banner and the drill-down are all the siblings' - see
 * `trial-balance.tsx` for the shape.
 *
 * 🛑 The one thing this report does that the other five do not is
 * `truncated`. Every other statement is bounded by the CHART; this one is
 * bounded by TRANSACTION VOLUME, so a wide range hits the router's
 * `GENERAL_LEDGER_MAX_LINES` cap and comes back partial - and a partial
 * general ledger does not tie to the trial balance for the same range, with
 * nothing in the figures to say why. It is stated FOUR times when it happens:
 * the adapter's own `INCOMPLETE` first row (which is what reaches the CSV and
 * the PDF), `TruncatedBanner` above the table, the verdict strip below it, and
 * the `-INCOMPLETE` suffix on the CSV filename.
 */
export function GeneralLedgerReportPage() {
  const period = useLedgerPeriod()
  const router = useRouter()
  const [fromParam, setFromParam] = useQueryState('from')
  const [toParam, setToParam] = useQueryState('to')

  // The current period, same default the P&L takes - the month a person is
  // working in is the range they almost always want, and it is also the range
  // least likely to truncate.
  const fallbackKey = period.resolvedPeriodKey
  const from = fromParam || (fallbackKey ? periodStartDate(fallbackKey) : '')
  const to = toParam || (fallbackKey ? periodEndDate(fallbackKey) : '')

  const query = api.ledgerReports.generalLedger.useQuery({ from, to }, { enabled: !!from && !!to })
  const renderPdf = api.ledgerReports.renderStatementPdf.useMutation({
    onError: (error) => toastError({ title: 'Error generating PDF', description: error.message }),
  })

  const truncated = !!query.data?.truncated

  function handleDownloadPdf() {
    renderPdf.mutate(
      { kind: 'general-ledger', from, to },
      {
        onSuccess: ({ assetId }) =>
          window.open(`/api/files/download/asset:${assetId}`, '_blank', 'noopener,noreferrer'),
      }
    )
  }

  function handleDownloadCsv() {
    if (!query.data) return
    // `rows[0]` is already the adapter's `INCOMPLETE` row when the read
    // truncated, so the warning is in the file without anything being added
    // here. The FILENAME is this page's own contribution: a file that gets
    // forwarded, renamed or attached is read by its name long before anyone
    // opens it.
    downloadCsv(
      toCsvRows(query.data.rows, GENERAL_LEDGER_COLUMNS, period.currencyCode),
      `general-ledger-${from}-to-${to}${truncated ? '-INCOMPLETE' : ''}.csv`
    )
  }

  const rows = query.data ? toStatementTableRows(query.data.rows) : []
  const isEmpty = !!query.data && query.data.accounts.length === 0
  const txnDateByPostingId = useMemo(() => buildTxnDateIndex(query.data?.accounts), [query.data])

  // One `MainPageContent` per screen, and it is the reports LAYOUT's - see
  // `accounting/settings/layout.tsx` for the same split. A second one here
  // nested a `PanelFrame` inside a `PanelFrame`, which doubled the border and
  // the padding on every report.
  return (
    <div className='flex h-full min-h-0 w-full flex-1 flex-col'>
      <ReportToolbar
        mode='range'
        periodOptions={period.options}
        fromPeriodKey={from ? periodKeyFromDate(from) : undefined}
        toPeriodKey={to ? periodKeyFromDate(to) : undefined}
        onSelectFrom={(key) => void setFromParam(periodStartDate(key))}
        onSelectTo={(key) => void setToParam(periodEndDate(key))}
        onDownloadPdf={handleDownloadPdf}
        onDownloadCsv={handleDownloadCsv}
        isDownloadingPdf={renderPdf.isPending}
        // 🛑 Both exports stay ENABLED while the ledger is truncated, and that
        // is a deliberate call. `renderStatementPdf` reads under the SAME
        // `GENERAL_LEDGER_MAX_LINES` cap and renders through the SAME
        // `toGeneralLedgerRows`, so the printed copy opens on the identical
        // `INCOMPLETE` row the screen does - the export cannot leave the
        // building looking finished. Disabling them would only push a person
        // toward screenshotting a partial ledger instead, which carries no
        // warning at all.
        disabled={!from || !to}
      />
      <ScrollArea className='min-h-0 flex-1' scrollbarClassName='w-1.5'>
        <div className='mx-auto flex w-full max-w-5xl flex-1 flex-col gap-3 p-4'>
          {truncated && <TruncatedBanner maxLines={query.data?.maxLines} />}
          <CompletenessBanner asOf={to} />
          <ProviderSyncMarker through={to} />
          {period.isLoading ? (
            <Skeleton className='h-64 w-full' />
          ) : !from || !to ? (
            // No periods exist for this org at all - setup was never
            // finalized, so there is no month for a ledger to cover. Distinct
            // from `isEmpty` below (periods exist, nothing posted in the
            // range), and see `trial-balance.tsx`'s matching branch.
            <EmptyState
              icon={BookOpen}
              title='Nothing has posted yet'
              description='The general ledger has no lines to show until the ledger is set up and something posts to it.'
              button={
                <Button asChild variant='outline' size='sm'>
                  <Link href='/app/accounting'>Go to the ledger</Link>
                </Button>
              }
            />
          ) : query.isPending ? (
            <Skeleton className='h-64 w-full' />
          ) : query.error ? (
            <ReportErrorCard message={query.error.message} />
          ) : isEmpty ? (
            // Not an error and not a setup problem: the books are fine, this
            // range simply has no posted lines in it.
            <EmptyState
              icon={BookOpen}
              title='No posted lines in this range'
              description='Nothing posted between these two dates. Widen the range, or pick a month with activity.'
            />
          ) : (
            <StatementTable
              columns={GENERAL_LEDGER_COLUMNS}
              rows={rows}
              currency={period.currencyCode}
              searchable
              expandAllByDefault
              verdict={
                query.data
                  ? truncated
                    ? {
                        label: TRUNCATED_HEADLINE,
                        ok: false,
                        detail: 'Debits and credits cannot tie on a partial read.',
                      }
                    : { label: 'Debits = Credits', ok: query.data.balanced }
                  : undefined
              }
              onRowClick={(row) => {
                const glPostingId = row.meta?.glPostingId
                if (!glPostingId) return
                const txnDate = txnDateByPostingId.get(glPostingId)
                if (!txnDate) return
                // The same destination `AccountLinesDialog`'s doc-number links
                // use: the posting, open on the ledger page for the month the
                // line actually landed in.
                router.push(`/app/accounting/${periodKeyFromDate(txnDate)}?posting=${glPostingId}`)
              }}
            />
          )}
        </div>
      </ScrollArea>
    </div>
  )
}

/**
 * `glPostingId` -> the date that posting landed on, for the drill-down route.
 *
 * The row carries the posting id itself on `meta.glPostingId`
 * (`toGeneralLedgerRows` sets it), so the only thing still missing is the
 * month to open the ledger page at. That comes from the SAME typed response,
 * keyed on a real id rather than on a composed row-id string.
 *
 * ⚠️ An earlier version keyed this map on the adapter's row `id`
 * (`account:posting:date:docNumber`), which coupled this file to a string
 * shape assembled in lib. `meta.glPostingId` was added to the row contract to
 * retire that; do not reintroduce id parsing here.
 *
 * The opening-balance and "Ending balance" rows never appear: they carry no
 * `glPostingId` because they are positions, not entries, and there is nothing
 * to open.
 */
function buildTxnDateIndex(
  accounts: readonly { lines: readonly { glPostingId: string; txnDate: string }[] }[] | undefined
): Map<string, string> {
  const index = new Map<string, string>()
  for (const account of accounts ?? []) {
    for (const line of account.lines) index.set(line.glPostingId, line.txnDate)
  }
  return index
}

/**
 * The warning above the table.
 *
 * `ReportErrorCard`'s destructive tone rather than `CompletenessBanner`'s
 * neutral one, and deliberately: completeness says "here is what this report
 * does not cover", which is context. This says "the numbers under this are
 * wrong", which is a refusal to be read past. It sits ABOVE the completeness
 * banner for the same reason.
 */
function TruncatedBanner({ maxLines }: { maxLines?: number }) {
  return (
    <div className='flex items-start gap-3 rounded-xl border border-destructive/40 bg-destructive/5 p-4'>
      <TriangleAlert className='mt-0.5 size-5 shrink-0 text-destructive' />
      <div className='flex flex-col gap-1'>
        <span className='font-medium'>{TRUNCATED_HEADLINE}</span>
        <p className='text-sm'>
          This range is bigger than one read can return
          {maxLines ? `, so it stopped at ${maxLines.toLocaleString('en-US')} lines` : ''}. The
          accounts and figures below are only part of the ledger, and they will not tie to the trial
          balance for the same range.{' '}
          <span className='font-medium'>Narrow the range - a month at a time always fits.</span>
        </p>
        <p className='text-muted-foreground text-sm'>
          The CSV and the PDF are still available and carry this same warning as their first row,
          but neither one is a ledger you can file against until the range fits.
        </p>
      </div>
    </div>
  )
}
