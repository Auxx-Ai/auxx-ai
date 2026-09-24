// apps/web/src/components/accounting/ui/reports/balance-sheet.tsx

'use client'

import { toCsvRows } from '@auxx/lib/accounting/reports/client'
import { Button } from '@auxx/ui/components/button'
import { Skeleton } from '@auxx/ui/components/skeleton'
import { toastError } from '@auxx/ui/components/toast'
import { cn } from '@auxx/ui/lib/utils'
import { todayInZone } from '@auxx/utils/calendar-day'
import { Scale } from 'lucide-react'
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
  balanceSheetColumns,
  type CompareOption,
  compareAsOfFor,
  periodStartDate,
  toStatementTableRows,
} from './report-helpers'
import { ReportMessage, ReportPageLayout } from './report-page-layout'
import { reportAsOfPresets } from './report-range-presets'
import { ReportBreadcrumb, ReportToolbarActions, ReportToolbarControls } from './report-toolbar'
import { useReportAsOf } from './use-report-window'

/**
 * `/app/accounting/reports/balance-sheet` (`plans/accounting/ui-plan.md`
 * §2.4). As-of, with an optional prior-period/prior-year compare snapshot.
 * The computed retained-earnings rows and their "computed from the P&L, not
 * a posted balance" tooltip already come from `toBalanceSheetRows` via
 * `StatementRow.meta.note`, which the grid renders on its own - this
 * page only adds the "Assets = Liabilities + Equity" verdict on top of
 * the read's own `verdict` boolean.
 */
export function BalanceSheetReportPage() {
  const period = useLedgerPeriod()
  const drill = useAccountDrill()
  // The first day the books cover, and the drill-down's fallback start when no
  // range has been carried in from another report.
  const cutoff = period.options[0] ? periodStartDate(period.options[0].periodKey) : null
  const [compareParam, setCompareParam] = useQueryState('compare')

  const { asOf, from, setAsOf } = useReportAsOf(
    period.bookTimeZone,
    !!period.resolvedPeriodKey,
    period.fiscalYearStartMonth
  )
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
  const data = query.data
  const bookTimeZone = period.bookTimeZone
  const columns = useMemo(
    () => (data ? balanceSheetColumns(data, bookTimeZone) : []),
    [data, bookTimeZone]
  )
  const rows = useMemo(() => (data ? toStatementTableRows(data.rows) : []), [data])
  // Every balance-sheet account is cumulative, so its drill runs from the carried start.
  const drillRow = drill.accountId ? findAccountRow(rows, drill.accountId) : undefined
  const drillStart = drillFrom ?? ''
  const drilling = !!drill.accountId && !!data && !!drillStart
  const drillAccount = useDrillAccount(drilling ? drill.accountId : null, drillStart, asOf)
  const drillExports = useGeneralLedgerExports({
    from: drillStart,
    to: asOf,
    glAccountId: drill.accountId ?? undefined,
    currency: period.currencyCode,
    fileLabel: drillAccount.label ?? undefined,
  })

  const renderPdf = api.ledgerReports.renderStatementPdf.useMutation({
    onError: (error) => toastError({ title: 'Error generating PDF', description: error.message }),
  })

  // The handlers are `useCallback`s only because the toolbar registration below
  // is memoised over them - a fresh identity each render republishes forever.
  const renderPdfMutate = renderPdf.mutate
  const handleDownloadPdf = useCallback(() => {
    renderPdfMutate(
      { kind: 'balance-sheet', asOf, compareAsOf },
      {
        onSuccess: ({ assetId }) =>
          window.open(`/api/files/download/asset:${assetId}`, '_blank', 'noopener,noreferrer'),
      }
    )
  }, [renderPdfMutate, asOf, compareAsOf])

  const currencyCode = period.currencyCode
  const handleDownloadCsv = useCallback(() => {
    if (!data) return
    downloadCsv(toCsvRows(data.rows, columns, currencyCode), `balance-sheet-${asOf}.csv`)
  }, [data, columns, currencyCode, asOf])

  useRegisterAccountingToolbar(
    useMemo(
      () => ({
        left: (
          <>
            <ReportBreadcrumb
              reportLabel='Balance sheet'
              current={drilling ? drillAccount.label : undefined}
              onBack={drill.close}
            />
            <ReportToolbarControls
              mode='asOf'
              asOf={asOf}
              onSelectAsOf={setAsOf}
              asOfPresets={asOfPresets}
              cutoff={cutoff}
              compare={drilling ? undefined : compare}
              onSelectCompare={(next) => void setCompareParam(next === 'none' ? null : next)}
              disabled={!asOf}
            />
          </>
        ),
        right: drilling ? (
          <ReportToolbarActions
            onDownloadPdf={drillExports.downloadPdf}
            onDownloadCsv={drillExports.downloadCsv}
            through={asOf}
            isDownloadingPdf={drillExports.isDownloadingPdf}
          />
        ) : (
          <ReportToolbarActions
            onDownloadPdf={handleDownloadPdf}
            onDownloadCsv={handleDownloadCsv}
            through={asOf}
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
        asOf,
        setAsOf,
        asOfPresets,
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
    query.data.assets.length === 0 &&
    query.data.liabilities.length === 0 &&
    query.data.equity.length === 0

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
          ) : !asOf || isEmpty ? (
            <ReportMessage>
              <EmptyState
                icon={Scale}
                title='Nothing has posted yet'
                description={
                  asOf
                    ? 'The balance sheet has no accounts to show until something posts to the ledger.'
                    : 'The balance sheet has no accounts to show until the ledger is set up and something posts to it.'
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
              reportKey='balance-sheet'
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
              canRowDrill={(row) => !!row.meta?.glAccountId && !!drillFrom}
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
            reportLabel='Balance sheet'
            glAccountId={drill.accountId}
            from={drillStart}
            to={asOf}
            // The as-of column; a compare column is a different date.
            figure={drillRow?.values[0]}
            figureKind='balance'
            currency={period.currencyCode}
          />
        </div>
      )}
    </div>
  )
}
