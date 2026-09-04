// apps/web/src/components/accounting/ui/reports/trial-balance.tsx

'use client'

import { toCsvRows } from '@auxx/lib/postings/client'
import { Button } from '@auxx/ui/components/button'
import { ScrollArea } from '@auxx/ui/components/scroll-area'
import { Skeleton } from '@auxx/ui/components/skeleton'
import { toastError } from '@auxx/ui/components/toast'
import { ListChecks } from 'lucide-react'
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
import { periodEndDate, periodKeyFromDate, toStatementTableRows } from './report-helpers'
import { ReportToolbar } from './report-toolbar'
import { StatementTable } from './statement-table'

/**
 * `/app/accounting/reports/trial-balance` (`plans/accounting/ui-plan.md`
 * §2.4). As-of only, no compare: `ledgerReports.trialBalance` reads
 * cumulative from the beginning of time through `to`, which is the standard
 * reading of "a trial balance" and ties to `ledger.verifyBalance` for the
 * same range (`tasks/04-statements.md` §0).
 */
export function TrialBalanceReportPage() {
  const period = useLedgerPeriod()
  const [asOfParam, setAsOfParam] = useQueryState('asOf')
  const [drillDown, setDrillDown] = useState<AccountLinesDialogTarget | null>(null)

  const asOf =
    asOfParam || (period.resolvedPeriodKey ? periodEndDate(period.resolvedPeriodKey) : '')

  const query = api.ledgerReports.trialBalance.useQuery({ to: asOf }, { enabled: !!asOf })
  const renderPdf = api.ledgerReports.renderStatementPdf.useMutation({
    onError: (error) => toastError({ title: 'Error generating PDF', description: error.message }),
  })

  function handleDownloadPdf() {
    renderPdf.mutate(
      { kind: 'trial-balance', to: asOf },
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
      `trial-balance-${asOf}.csv`
    )
  }

  // `rows` always carries the `'total'` row from `toTrialBalanceRows`, even
  // with zero account activity - so "no postings" is `rows.length <= 1`, not
  // `=== 0`. The router overwrites the model's own `rows: TrialBalanceRow[]`
  // with this `StatementRow[]` in the same spread, so there is no second,
  // un-adapted count to check instead.
  const hasActivity = (query.data?.rows.length ?? 0) > 1
  const rows = query.data ? toStatementTableRows(query.data.rows) : []

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
            // No periods exist for this org at all - setup was never
            // finalized, so there is no month for a trial balance to be
            // "as of". Distinct from `!hasActivity` below (periods exist,
            // nothing posted yet), but the remedy is the same door.
            <EmptyState
              icon={ListChecks}
              title='Nothing has posted yet'
              description='The trial balance has no activity to show until the ledger is set up and something posts to it.'
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
          ) : !hasActivity ? (
            <EmptyState
              icon={ListChecks}
              title='Nothing has posted yet'
              description='The trial balance has no activity to show until something posts to the ledger.'
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
                query.data ? { label: 'Debits = Credits', ok: query.data.balanced } : undefined
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
