// apps/web/src/components/accounting/ui/reports/balance-sheet.tsx

'use client'

import { toCsvRows } from '@auxx/lib/postings/client'
import { Button } from '@auxx/ui/components/button'
import { ScrollArea } from '@auxx/ui/components/scroll-area'
import { Skeleton } from '@auxx/ui/components/skeleton'
import { toastError } from '@auxx/ui/components/toast'
import { todayInZone } from '@auxx/utils/calendar-day'
import { Scale } from 'lucide-react'
import Link from 'next/link'
import { useQueryState } from 'nuqs'
import { useMemo } from 'react'
import { useLedgerPeriod } from '~/components/accounting/hooks/use-ledger-period'
import { EmptyState } from '~/components/global/empty-state'
import { downloadCsv } from '~/lib/csv'
import { api } from '~/trpc/react'
import { useDrillToLedger } from './drill-to-ledger'
import { ReportErrorCard } from './report-error-card'
import {
  balanceSheetColumns,
  type CompareOption,
  compareAsOfFor,
  periodStartDate,
  toStatementTableRows,
} from './report-helpers'
import { reportAsOfPresets } from './report-range-presets'
import { ReportToolbar } from './report-toolbar'
import { StatementNotices } from './statement-notices'
import { StatementTable } from './statement-table'
import { useReportAsOf } from './use-report-window'

/**
 * `/app/accounting/reports/balance-sheet` (`plans/accounting/ui-plan.md`
 * §2.4). As-of, with an optional prior-period/prior-year compare snapshot.
 * The computed retained-earnings rows and their "computed from the P&L, not
 * a posted balance" tooltip already come from `toBalanceSheetRows` via
 * `StatementRow.meta.note`, which `StatementTable` renders on its own - this
 * page only adds the "Assets = Liabilities + Equity" verdict on top of
 * the read's own `verdict` boolean.
 */
export function BalanceSheetReportPage() {
  const period = useLedgerPeriod()
  const drillToLedger = useDrillToLedger()
  // The first day the books cover, and the drill-down's fallback start when no
  // range has been carried in from another report.
  const cutoff = period.options[0] ? periodStartDate(period.options[0].periodKey) : null
  const [compareParam, setCompareParam] = useQueryState('compare')

  const { asOf, from, setAsOf } = useReportAsOf(period.bookTimeZone, !!period.resolvedPeriodKey)
  // The carried range start when another report set one, else the books' floor.
  // Either way the ledger's own "Opening balance" row absorbs what came before,
  // so the drill-down still ties to the figure that was clicked.
  const drillFrom = from ?? cutoff
  const asOfPresets = useMemo(
    () => reportAsOfPresets(todayInZone(period.bookTimeZone), cutoff),
    [period.bookTimeZone, cutoff]
  )
  const compare = (compareParam as CompareOption | null) ?? 'none'
  const compareAsOf = asOf ? compareAsOfFor(asOf, compare) : undefined

  const query = api.ledgerReports.balanceSheet.useQuery({ asOf, compareAsOf }, { enabled: !!asOf })
  const columns = query.data ? balanceSheetColumns(query.data, period.bookTimeZone) : []
  const renderPdf = api.ledgerReports.renderStatementPdf.useMutation({
    onError: (error) => toastError({ title: 'Error generating PDF', description: error.message }),
  })

  function handleDownloadPdf() {
    renderPdf.mutate(
      { kind: 'balance-sheet', asOf, compareAsOf },
      {
        onSuccess: ({ assetId }) =>
          window.open(`/api/files/download/asset:${assetId}`, '_blank', 'noopener,noreferrer'),
      }
    )
  }

  function handleDownloadCsv() {
    if (!query.data) return
    downloadCsv(
      toCsvRows(query.data.rows, columns, period.currencyCode),
      `balance-sheet-${asOf}.csv`
    )
  }

  const rows = query.data ? toStatementTableRows(query.data.rows) : []
  const isEmpty =
    !!query.data &&
    query.data.assets.length === 0 &&
    query.data.liabilities.length === 0 &&
    query.data.equity.length === 0

  // One `MainPageContent` per screen, and it is the reports LAYOUT's - see
  // `accounting/settings/layout.tsx` for the same split. A second one here
  // nested a `PanelFrame` inside a `PanelFrame`, which doubled the border and
  // the padding on every report.
  return (
    <div className='flex h-full min-h-0 w-full flex-1 flex-col'>
      <ReportToolbar
        mode='asOf'
        asOf={asOf}
        onSelectAsOf={setAsOf}
        asOfPresets={asOfPresets}
        cutoff={cutoff}
        compare={compare}
        onSelectCompare={(next) => void setCompareParam(next === 'none' ? null : next)}
        onDownloadPdf={handleDownloadPdf}
        onDownloadCsv={handleDownloadCsv}
        through={asOf}
        isDownloadingPdf={renderPdf.isPending}
        disabled={!asOf}
      />
      <ScrollArea className='min-h-0 flex-1' scrollbarClassName='w-1.5'>
        <div className='mx-auto flex w-full max-w-5xl flex-1 flex-col gap-3 p-4'>
          <StatementNotices through={asOf} />
          {period.isLoading ? (
            <Skeleton className='h-64 w-full' />
          ) : !asOf ? (
            // No periods exist for this org at all - see trial-balance.tsx's
            // matching branch for why this is distinct from `isEmpty` below.
            <EmptyState
              icon={Scale}
              title='Nothing has posted yet'
              description='The balance sheet has no accounts to show until the ledger is set up and something posts to it.'
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
            <EmptyState
              icon={Scale}
              title='Nothing has posted yet'
              description='The balance sheet has no accounts to show until something posts to the ledger.'
              button={
                <Button asChild variant='outline' size='sm'>
                  <Link href='/app/accounting'>Go to the ledger</Link>
                </Button>
              }
            />
          ) : (
            <StatementTable
              columns={columns}
              rows={rows}
              currency={period.currencyCode}
              verdict={
                // States the outcome, not the test - see `trial-balance.tsx`.
                query.data
                  ? query.data.verdict
                    ? {
                        label: 'Balanced.',
                        ok: true,
                        detail: 'Assets equal liabilities plus equity.',
                      }
                    : {
                        label: 'Out of balance.',
                        ok: false,
                        detail: 'Assets do not equal liabilities plus equity.',
                      }
                  : undefined
              }
              canRowDrill={(row) => !!row.meta?.glAccountId}
              onRowClick={(row) =>
                row.meta?.glAccountId && drillFrom
                  ? drillToLedger(row.meta.glAccountId, { from: drillFrom, to: asOf })
                  : undefined
              }
            />
          )}
        </div>
      </ScrollArea>
    </div>
  )
}
