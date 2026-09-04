// apps/web/src/components/accounting/ui/reports/balance-sheet.tsx

'use client'

import { toCsvRows } from '@auxx/lib/postings/client'
import { Button } from '@auxx/ui/components/button'
import { ScrollArea } from '@auxx/ui/components/scroll-area'
import { Skeleton } from '@auxx/ui/components/skeleton'
import { toastError } from '@auxx/ui/components/toast'
import { Scale } from 'lucide-react'
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
  compareAsOfFor,
  periodEndDate,
  periodKeyFromDate,
  toStatementTableRows,
} from './report-helpers'
import { ReportToolbar } from './report-toolbar'
import { StatementTable } from './statement-table'

/**
 * `/app/accounting/reports/balance-sheet` (`plans/accounting/ui-plan.md`
 * §2.4). As-of, with an optional prior-period/prior-year compare snapshot.
 * The computed retained-earnings rows and their "computed from the P&L, not
 * a posted balance" tooltip already come from `toBalanceSheetRows` via
 * `StatementRow.meta.note`, which `StatementTable` renders on its own - this
 * page only adds the "Assets = Liabilities + Equity" verdict strip on top of
 * the read's own `verdict` boolean.
 */
export function BalanceSheetReportPage() {
  const period = useLedgerPeriod()
  const [asOfParam, setAsOfParam] = useQueryState('asOf')
  const [compareParam, setCompareParam] = useQueryState('compare')
  const [drillDown, setDrillDown] = useState<AccountLinesDialogTarget | null>(null)

  const asOf =
    asOfParam || (period.resolvedPeriodKey ? periodEndDate(period.resolvedPeriodKey) : '')
  const compare = (compareParam as CompareOption | null) ?? 'none'
  const compareAsOf = asOf ? compareAsOfFor(asOf, compare) : undefined

  const query = api.ledgerReports.balanceSheet.useQuery({ asOf, compareAsOf }, { enabled: !!asOf })
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
      toCsvRows(query.data.rows, query.data.columns, period.currencyCode),
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
        periodOptions={period.options}
        periodKey={asOf ? periodKeyFromDate(asOf) : undefined}
        onSelectPeriod={(key) => void setAsOfParam(periodEndDate(key))}
        compare={compare}
        onSelectCompare={(next) => void setCompareParam(next === 'none' ? null : next)}
        onDownloadPdf={handleDownloadPdf}
        onDownloadCsv={handleDownloadCsv}
        isDownloadingPdf={renderPdf.isPending}
        disabled={!asOf}
      />
      <ScrollArea className='min-h-0 flex-1' scrollbarClassName='w-1.5'>
        <div className='mx-auto flex w-full max-w-5xl flex-col gap-3 p-4'>
          <CompletenessBanner asOf={asOf} />
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
              columns={query.data?.columns ?? []}
              rows={rows}
              currency={period.currencyCode}
              verdict={
                query.data
                  ? { label: 'Assets = Liabilities + Equity', ok: query.data.verdict }
                  : undefined
              }
              onRowClick={(row) =>
                row.meta?.accountCode
                  ? setDrillDown({ accountCode: row.meta.accountCode, to: asOf })
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
