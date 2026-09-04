// apps/web/src/components/accounting/ui/reports/profit-and-loss.tsx

'use client'

import { toCsvRows } from '@auxx/lib/postings/client'
import { Button } from '@auxx/ui/components/button'
import { ScrollArea } from '@auxx/ui/components/scroll-area'
import { Skeleton } from '@auxx/ui/components/skeleton'
import { toastError } from '@auxx/ui/components/toast'
import { TrendingUp } from 'lucide-react'
import Link from 'next/link'
import { useQueryState } from 'nuqs'
import { useState } from 'react'
import { useLedgerPeriod } from '~/components/accounting/hooks/use-ledger-period'
import { EmptyState } from '~/components/global/empty-state'
import { downloadCsv } from '~/lib/csv'
import { api } from '~/trpc/react'
import { AccountLinesDialog, type AccountLinesDialogTarget } from './account-lines-dialog'
import { CompletenessBanner } from './completeness-banner'
import { ReportErrorCard } from './report-error-card'
import {
  type CompareOption,
  compareRangeFor,
  periodEndDate,
  periodKeyFromDate,
  periodStartDate,
  profitAndLossColumns,
  toStatementTableRows,
} from './report-helpers'
import { ReportToolbar } from './report-toolbar'
import { StatementTable } from './statement-table'

/**
 * `/app/accounting/reports/profit-and-loss` (`plans/accounting/ui-plan.md`
 * §2.4). A from/to period RANGE, unlike the other two statements' single
 * as-of point - the P&L is an activity report, not a point-in-time snapshot.
 * Gross profit and net income already arrive as `'computed'`/`'total'` rows
 * from `toProfitAndLossRows`; this page adds nothing on top beyond the
 * column labels, which need `bookTimeZone` for display and so cannot come
 * from the lib adapter (see `report-helpers.ts`'s `profitAndLossColumns`).
 */
export function ProfitAndLossReportPage() {
  const period = useLedgerPeriod()
  const [fromParam, setFromParam] = useQueryState('from')
  const [toParam, setToParam] = useQueryState('to')
  const [compareParam, setCompareParam] = useQueryState('compare')
  const [drillDown, setDrillDown] = useState<AccountLinesDialogTarget | null>(null)

  const fallbackKey = period.resolvedPeriodKey
  const from = fromParam || (fallbackKey ? periodStartDate(fallbackKey) : '')
  const to = toParam || (fallbackKey ? periodEndDate(fallbackKey) : '')
  const compare = (compareParam as CompareOption | null) ?? 'none'
  const compareRange = from && to ? compareRangeFor(from, to, compare) : undefined

  const query = api.ledgerReports.profitAndLoss.useQuery(
    { from, to, compare: compareRange },
    { enabled: !!from && !!to }
  )
  const renderPdf = api.ledgerReports.renderStatementPdf.useMutation({
    onError: (error) => toastError({ title: 'Error generating PDF', description: error.message }),
  })

  function handleDownloadPdf() {
    renderPdf.mutate(
      { kind: 'profit-and-loss', from, to, compare: compareRange },
      {
        onSuccess: ({ assetId }) =>
          window.open(`/api/files/download/asset:${assetId}`, '_blank', 'noopener,noreferrer'),
      }
    )
  }

  const columns = query.data ? profitAndLossColumns(query.data, period.bookTimeZone) : []

  function handleDownloadCsv() {
    if (!query.data) return
    downloadCsv(
      toCsvRows(query.data.rows, columns, period.currencyCode),
      `profit-and-loss-${from}-${to}.csv`
    )
  }

  const rows = query.data ? toStatementTableRows(query.data.rows) : []
  const isEmpty =
    !!query.data &&
    query.data.revenue.length === 0 &&
    query.data.cogs.length === 0 &&
    query.data.operatingExpenses.length === 0

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
        compare={compare}
        onSelectCompare={(next) => void setCompareParam(next === 'none' ? null : next)}
        onDownloadPdf={handleDownloadPdf}
        onDownloadCsv={handleDownloadCsv}
        isDownloadingPdf={renderPdf.isPending}
        disabled={!from || !to}
      />
      <ScrollArea className='min-h-0 flex-1' scrollbarClassName='w-1.5'>
        <div className='mx-auto flex w-full max-w-5xl flex-col gap-3 p-4'>
          <CompletenessBanner asOf={to} />
          {period.isLoading ? (
            <Skeleton className='h-64 w-full' />
          ) : !from || !to ? (
            // No periods exist for this org at all - see trial-balance.tsx's
            // matching branch for why this is distinct from `isEmpty` below.
            <EmptyState
              icon={TrendingUp}
              title='Nothing has posted yet'
              description='The profit and loss statement has no activity to show until the ledger is set up and something posts to it.'
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
              icon={TrendingUp}
              title='Nothing has posted yet'
              description='The profit and loss statement has no activity to show until something posts to the ledger.'
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
              onRowClick={(row) =>
                row.meta?.accountCode
                  ? setDrillDown({ accountCode: row.meta.accountCode, from, to })
                  : undefined
              }
            />
          )}
        </div>
      </ScrollArea>
      <AccountLinesDialog
        target={drillDown}
        onOpenChange={(open) => !open && setDrillDown(null)}
        currencyCode={period.currencyCode}
        bookTimeZone={period.bookTimeZone}
      />
    </div>
  )
}
