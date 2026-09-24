// apps/web/src/components/accounting/ui/reports/profit-and-loss.tsx

'use client'

import { toCsvRows } from '@auxx/lib/accounting/reports/client'
import { Button } from '@auxx/ui/components/button'
import { Skeleton } from '@auxx/ui/components/skeleton'
import { toastError } from '@auxx/ui/components/toast'
import { cn } from '@auxx/ui/lib/utils'
import { todayInZone } from '@auxx/utils/calendar-day'
import { TrendingUp } from 'lucide-react'
import Link from 'next/link'
import { useQueryState } from 'nuqs'
import { useCallback, useMemo } from 'react'
import { useRegisterAccountingToolbar } from '~/components/accounting/accounting-toolbar-outlet'
import { useLedgerPeriod } from '~/components/accounting/hooks/use-ledger-period'
import { EmptyState } from '~/components/global/empty-state'
import { downloadCsv } from '~/lib/csv'
import { api } from '~/trpc/react'
import { AccountDrillView, findAccountRow, useAccountDrill, useDrillAccount } from './account-drill'
import { useGeneralLedgerExports } from './general-ledger-view'
import { ReportErrorCard } from './report-error-card'
import { ReportGrid } from './report-grid'
import {
  type CompareOption,
  compareRangeFor,
  periodEndDate,
  periodStartDate,
  profitAndLossColumns,
  toStatementTableRows,
} from './report-helpers'
import { ReportMessage, ReportPageLayout } from './report-page-layout'
import { reportRangePresets } from './report-range-presets'
import { ReportBreadcrumb, ReportToolbarActions, ReportToolbarControls } from './report-toolbar'

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
  const drill = useAccountDrill()

  const fallbackKey = period.resolvedPeriodKey
  const from = fromParam || (fallbackKey ? periodStartDate(fallbackKey) : '')
  const to = toParam || (fallbackKey ? periodEndDate(fallbackKey) : '')
  const compare = (compareParam as CompareOption | null) ?? 'none'
  const compareRange = useMemo(
    () => (from && to ? compareRangeFor(from, to, compare) : undefined),
    [from, to, compare]
  )

  // The books' own floor and the day they run to, both in BOOK time - a
  // preset resolved against the viewer's midnight would name a different day
  // for two people looking at the same statement.
  const cutoff = period.options[0] ? periodStartDate(period.options[0].periodKey) : null
  const presets = useMemo(
    () => reportRangePresets(todayInZone(period.bookTimeZone), cutoff),
    [period.bookTimeZone, cutoff]
  )

  const query = api.ledgerReports.profitAndLoss.useQuery(
    { from, to, compare: compareRange },
    { enabled: !!from && !!to }
  )
  const renderPdf = api.ledgerReports.renderStatementPdf.useMutation({
    onError: (error) => toastError({ title: 'Error generating PDF', description: error.message }),
  })

  // The handlers are `useCallback`s only because the toolbar registration below
  // is memoised over them - a fresh identity each render republishes forever.
  const renderPdfMutate = renderPdf.mutate
  const handleDownloadPdf = useCallback(() => {
    renderPdfMutate(
      { kind: 'profit-and-loss', from, to, compare: compareRange },
      {
        onSuccess: ({ assetId }) =>
          window.open(`/api/files/download/asset:${assetId}`, '_blank', 'noopener,noreferrer'),
      }
    )
  }, [renderPdfMutate, from, to, compareRange])

  const data = query.data
  const bookTimeZone = period.bookTimeZone
  const columns = useMemo(
    () => (data ? profitAndLossColumns(data, bookTimeZone) : []),
    [data, bookTimeZone]
  )

  const rows = useMemo(() => (data ? toStatementTableRows(data.rows) : []), [data])
  // The P&L's own range; the ledger's fiscal-year opening makes its activity the row's figure.
  const drillRow = drill.accountId ? findAccountRow(rows, drill.accountId) : undefined
  const drilling = !!drill.accountId && !!data && !!from && !!to
  const drillAccount = useDrillAccount(drilling ? drill.accountId : null, from, to)
  const drillExports = useGeneralLedgerExports({
    from,
    to,
    glAccountId: drill.accountId ?? undefined,
    currency: period.currencyCode,
    fileLabel: drillAccount.label ?? undefined,
  })

  const currencyCode = period.currencyCode
  const handleDownloadCsv = useCallback(() => {
    if (!data) return
    downloadCsv(toCsvRows(data.rows, columns, currencyCode), `profit-and-loss-${from}-${to}.csv`)
  }, [data, columns, currencyCode, from, to])

  useRegisterAccountingToolbar(
    useMemo(
      () => ({
        left: (
          <>
            <ReportBreadcrumb
              reportLabel='Profit and loss'
              current={drilling ? drillAccount.label : undefined}
              onBack={drill.close}
            />
            <ReportToolbarControls
              mode='range'
              from={from}
              to={to}
              onSelectRange={(next) => {
                void setFromParam(next.from)
                void setToParam(next.to)
              }}
              presets={presets}
              cutoff={cutoff}
              compare={drilling ? undefined : compare}
              onSelectCompare={(next) => void setCompareParam(next === 'none' ? null : next)}
              disabled={!from || !to}
            />
          </>
        ),
        right: drilling ? (
          <ReportToolbarActions
            onDownloadPdf={drillExports.downloadPdf}
            onDownloadCsv={drillExports.downloadCsv}
            through={to}
            isDownloadingPdf={drillExports.isDownloadingPdf}
          />
        ) : (
          <ReportToolbarActions
            onDownloadPdf={handleDownloadPdf}
            onDownloadCsv={handleDownloadCsv}
            through={to}
            isDownloadingPdf={renderPdf.isPending}
          />
        ),
      }),
      [
        drilling,
        drillAccount.label,
        drill.close,
        drillExports.downloadPdf,
        drillExports.downloadCsv,
        drillExports.isDownloadingPdf,
        from,
        to,
        setFromParam,
        setToParam,
        presets,
        cutoff,
        compare,
        setCompareParam,
        handleDownloadPdf,
        handleDownloadCsv,
        renderPdf.isPending,
      ]
    )
  )

  const openDrill = drill.open
  const isEmpty =
    !!query.data &&
    query.data.revenue.length === 0 &&
    query.data.cogs.length === 0 &&
    query.data.operatingExpenses.length === 0

  return (
    <div className='relative flex min-h-0 min-w-0 flex-1 flex-col'>
      {/* Kept mounted while drilled in, so Back returns to the same scroll and open sections. */}
      <div
        className={cn(
          'flex min-h-0 min-w-0 flex-1 flex-col',
          drilling && 'pointer-events-none invisible'
        )}
        aria-hidden={drilling}>
        <ReportPageLayout>
          {period.isLoading ? (
            <ReportMessage>
              <Skeleton className='h-64 w-full' />
            </ReportMessage>
          ) : !from || !to || isEmpty ? (
            <ReportMessage>
              <EmptyState
                icon={TrendingUp}
                title='Nothing has posted yet'
                description={
                  from && to
                    ? 'The profit and loss statement has no activity to show until something posts to the ledger.'
                    : 'The profit and loss statement has no activity to show until the ledger is set up and something posts to it.'
                }
                button={
                  <Button asChild variant='outline' size='sm'>
                    <Link href='/app/accounting'>Go to the ledger</Link>
                  </Button>
                }
              />
            </ReportMessage>
          ) : query.isPending ? (
            <ReportMessage>
              <Skeleton className='h-64 w-full' />
            </ReportMessage>
          ) : query.error ? (
            <ReportMessage>
              <ReportErrorCard message={query.error.message} />
            </ReportMessage>
          ) : (
            <ReportGrid
              reportKey='profit-and-loss'
              columns={columns}
              rows={rows}
              currency={period.currencyCode}
              canRowDrill={(row) => !!row.meta?.glAccountId}
              onRowClick={(row) => {
                if (row.meta?.glAccountId) openDrill(row.meta.glAccountId)
              }}
            />
          )}
        </ReportPageLayout>
      </div>

      {drilling && drill.accountId && (
        <div className='absolute inset-0 flex flex-col'>
          <AccountDrillView
            reportLabel='Profit and loss'
            glAccountId={drill.accountId}
            from={from}
            to={to}
            // The current period's column; a compare column is another range.
            figure={drillRow?.values[0]}
            figureKind='activity'
            currency={period.currencyCode}
          />
        </div>
      )}
    </div>
  )
}
