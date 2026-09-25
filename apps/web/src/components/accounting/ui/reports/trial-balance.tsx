// apps/web/src/components/accounting/ui/reports/trial-balance.tsx

'use client'

import { fiscalYearStart, toCsvRows } from '@auxx/lib/accounting/reports/client'
import { Button } from '@auxx/ui/components/button'
import { Skeleton } from '@auxx/ui/components/skeleton'
import { toastError } from '@auxx/ui/components/toast'
import { cn } from '@auxx/ui/lib/utils'
import { todayInZone } from '@auxx/utils/calendar-day'
import { ListChecks } from 'lucide-react'
import Link from 'next/link'
import { useCallback, useMemo } from 'react'
import { useLedgerPeriod } from '~/components/accounting/hooks/use-ledger-period'
import { EmptyState } from '~/components/global/empty-state'
import { useRegisterModuleToolbar } from '~/components/global/module-toolbar-outlet'
import { ReportGrid } from '~/components/global/report-grid/report-grid'
import { ReportMessage, ReportPageLayout } from '~/components/global/report-grid/report-page-layout'
import { downloadCsv } from '~/lib/csv'
import { api } from '~/trpc/react'
import { AccountDrillView, findAccountRow, useAccountDrill, useDrillAccount } from './account-drill'
import { useGeneralLedgerExports } from './general-ledger-view'
import { ReportErrorCard } from './report-error-card'
import { periodStartDate, toStatementTableRows } from './report-helpers'
import { reportAsOfPresets } from './report-range-presets'
import { ReportBreadcrumb, ReportToolbarActions, ReportToolbarControls } from './report-toolbar'
import { useReportAsOf } from './use-report-window'

/**
 * `/app/accounting/reports/trial-balance` (`plans/accounting/ui-plan.md` §2.4).
 * As-of only, no compare: balance-sheet accounts cumulative through `to`,
 * revenue and expense reset at the fiscal year, the difference in a computed
 * retained-earnings row (`docs/accounting-architecture-guide.md` §12.1).
 *
 * The computed row has no `glAccountId`, so it is never drillable: there is no
 * ledger behind a figure nobody posted.
 */
export function TrialBalanceReportPage() {
  const period = useLedgerPeriod()
  const drill = useAccountDrill()
  // The first day the books cover, and the drill-down's fallback start.
  const cutoff = period.options[0] ? periodStartDate(period.options[0].periodKey) : null

  const { asOf, from, setAsOf } = useReportAsOf(
    period.bookTimeZone,
    !!period.resolvedPeriodKey,
    period.fiscalYearStartMonth
  )
  // The carried range start when another report set one, else the books' floor.
  // The ledger's opening balance absorbs what came before, so the drill still ties.
  const drillFrom = from ?? cutoff
  const asOfPresets = useMemo(
    () => reportAsOfPresets(todayInZone(period.bookTimeZone), cutoff),
    [period.bookTimeZone, cutoff]
  )

  const query = api.ledgerReports.trialBalance.useQuery({ to: asOf }, { enabled: !!asOf })
  const renderPdf = api.ledgerReports.renderStatementPdf.useMutation({
    onError: (error) => toastError({ title: 'Error generating PDF', description: error.message }),
  })

  const rows = useMemo(
    () => (query.data ? toStatementTableRows(query.data.rows) : []),
    [query.data]
  )

  // Revenue and expense reset at the fiscal year here, so their drill starts there
  // too, or the ledger's ending balance could never match the row (57 §10.3).
  const drillRow = drill.accountId ? findAccountRow(rows, drill.accountId) : undefined
  const drillType = drillRow?.meta?.accountType
  const drillStart =
    drillType === 'revenue' || drillType === 'expense'
      ? fiscalYearStart(asOf, period.fiscalYearStartMonth)
      : (drillFrom ?? '')
  const drilling = !!drill.accountId && !!query.data && !!drillStart
  const drillAccount = useDrillAccount(drilling ? drill.accountId : null, drillStart, asOf)
  const drillExports = useGeneralLedgerExports({
    from: drillStart,
    to: asOf,
    glAccountId: drill.accountId ?? undefined,
    currency: period.currencyCode,
    fileLabel: drillAccount.label ?? undefined,
  })

  // `useCallback`s because the toolbar registration below is memoised over them.
  const renderPdfMutate = renderPdf.mutate
  const handleDownloadPdf = useCallback(() => {
    renderPdfMutate(
      { kind: 'trial-balance', to: asOf },
      {
        onSuccess: ({ assetId }) =>
          window.open(`/api/files/download/asset:${assetId}`, '_blank', 'noopener,noreferrer'),
      }
    )
  }, [renderPdfMutate, asOf])

  const csvRows = query.data?.rows
  const csvColumns = query.data?.columns
  const currencyCode = period.currencyCode
  const handleDownloadCsv = useCallback(() => {
    if (!csvRows || !csvColumns) return
    downloadCsv(toCsvRows(csvRows, csvColumns, currencyCode), `trial-balance-${asOf}.csv`)
  }, [csvRows, csvColumns, currencyCode, asOf])

  useRegisterModuleToolbar(
    useMemo(
      () => ({
        left: (
          <>
            <ReportBreadcrumb
              reportLabel='Trial balance'
              current={drilling ? drillAccount.label : undefined}
              onBack={drill.close}
            />
            <ReportToolbarControls
              mode='asOf'
              asOf={asOf}
              onSelectAsOf={setAsOf}
              asOfPresets={asOfPresets}
              cutoff={cutoff}
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
        handleDownloadPdf,
        handleDownloadCsv,
        renderPdf.isPending,
      ]
    )
  )

  // `rows` always carries the total row, so "no postings" is `length <= 1`.
  const hasActivity = rows.length > 1
  const openDrill = drill.open

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
          ) : !asOf || (query.data && !hasActivity) ? (
            <ReportMessage>
              <EmptyState
                icon={ListChecks}
                title='Nothing has posted yet'
                description={
                  asOf
                    ? 'The trial balance has no activity to show until something posts to the ledger.'
                    : 'The trial balance has no activity to show until the ledger is set up and something posts to it.'
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
              reportKey='trial-balance'
              columns={query.data?.columns ?? []}
              rows={rows}
              currency={period.currencyCode}
              verdict={
                // States the outcome rather than naming the test; read on hover.
                query.data
                  ? query.data.balanced
                    ? { label: 'Balanced.', ok: true, detail: 'Debits equal credits.' }
                    : {
                        label: 'Out of balance.',
                        ok: false,
                        detail: 'Debits do not equal credits.',
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
            reportLabel='Trial balance'
            glAccountId={drill.accountId}
            from={drillStart}
            to={asOf}
            // Debit, credit, then the balance the row is read by.
            figure={drillRow?.values[2]}
            figureKind='balance'
            currency={period.currencyCode}
          />
        </div>
      )}
    </div>
  )
}
