// apps/web/src/components/accounting/ui/reports/aging-report.tsx

'use client'

import { toCsvRows } from '@auxx/lib/postings/client'
import type { RecordId } from '@auxx/types/resource'
import { isRecordId } from '@auxx/types/resource'
import { ScrollArea } from '@auxx/ui/components/scroll-area'
import { Skeleton } from '@auxx/ui/components/skeleton'
import { toastError } from '@auxx/ui/components/toast'
import { Building2, Users } from 'lucide-react'
import { parseAsString, useQueryState } from 'nuqs'
import { useLedgerPeriod } from '~/components/accounting/hooks/use-ledger-period'
import { EmptyState } from '~/components/global/empty-state'
import { RecordDrawer } from '~/components/records/record-drawer'
import { downloadCsv } from '~/lib/csv'
import { api } from '~/trpc/react'
import { formatMinor } from '../ledger/format'
import { CompletenessBanner } from './completeness-banner'
import { ReportErrorCard } from './report-error-card'
import { periodEndDate, periodKeyFromDate, toStatementTableRows } from './report-helpers'
import { ReportToolbar } from './report-toolbar'
import { StatementTable } from './statement-table'

export interface AgingReportPageProps {
  side: 'receivable' | 'payable'
}

const COPY: Record<
  AgingReportPageProps['side'],
  { icon: typeof Users; noun: string; verdictLabel: string; kind: 'ar-aging' | 'ap-aging' }
> = {
  receivable: { icon: Users, noun: 'A/R', verdictLabel: 'A/R', kind: 'ar-aging' },
  payable: { icon: Building2, noun: 'A/P', verdictLabel: 'A/P', kind: 'ap-aging' },
}

/**
 * `/app/accounting/reports/{ar,ap}-aging` (`plans/accounting/ui-plan.md`
 * §2.5, HANDOFF slot 2H). As-of only, no compare - task 05's report is a
 * point-in-time open-items list. `StatementTable`'s expandable `children`
 * (`ui-plan.md` §2.5) reveal the documents behind a contact/company; a
 * document row's own `meta.recordId` (`invoice`/`vendor_bill` only - a
 * payment or a manual line opens nothing) opens `RecordDrawer` via `?id=`,
 * the way `records-view.tsx` wires it, except this page stores the FULL
 * `defId:instanceId` string rather than a single entity type's instance id,
 * since a group can mix invoice and non-invoice documents.
 */
export function AgingReportPage({ side }: AgingReportPageProps) {
  const period = useLedgerPeriod()
  const copy = COPY[side]
  const [asOfParam, setAsOfParam] = useQueryState('asOf')
  const [recordIdParam, setRecordIdParam] = useQueryState('id', parseAsString.withDefault(''))

  const asOf =
    asOfParam || (period.resolvedPeriodKey ? periodEndDate(period.resolvedPeriodKey) : '')
  const selectedRecordId = isRecordId(recordIdParam) ? (recordIdParam as RecordId) : undefined

  const query = api.ledgerReports.aging.useQuery({ side, asOf }, { enabled: !!asOf })
  const renderPdf = api.ledgerReports.renderStatementPdf.useMutation({
    onError: (error) => toastError({ title: 'Error generating PDF', description: error.message }),
  })

  function handleDownloadPdf() {
    renderPdf.mutate(
      { kind: copy.kind, asOf },
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
      `${copy.kind}-${asOf}.csv`
    )
  }

  const rows = query.data ? toStatementTableRows(query.data.rows) : []
  // `toAgingRows` always appends its own `'total'` row, even over zero
  // groups (`trial-balance.tsx`'s own `rows.length > 1` reasoning).
  const hasActivity = rows.length > 1

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
            <EmptyState
              icon={copy.icon}
              title='Nothing has posted yet'
              description={`${copy.noun} aging has nothing to show until the ledger is set up and something posts to it.`}
            />
          ) : query.isPending ? (
            <Skeleton className='h-64 w-full' />
          ) : query.error ? (
            <ReportErrorCard message={query.error.message} />
          ) : !hasActivity ? (
            <EmptyState
              icon={copy.icon}
              title={`No open ${copy.noun}`}
              description={`Nothing is open on ${copy.noun} as of this date.`}
            />
          ) : (
            <StatementTable
              columns={query.data?.columns ?? []}
              rows={rows}
              currency={period.currencyCode}
              verdict={
                query.data
                  ? {
                      label: `Total equals the balance sheet's ${copy.verdictLabel} as of this date`,
                      ok: query.data.verdict,
                      detail: query.data.verdict
                        ? undefined
                        : `off by ${formatMinor(query.data.differenceMinor, period.currencyCode)}`,
                    }
                  : undefined
              }
              onRowClick={(row) =>
                row.meta?.recordId ? void setRecordIdParam(row.meta.recordId) : undefined
              }
            />
          )}
        </div>
      </ScrollArea>
      <RecordDrawer
        open={!!selectedRecordId}
        onOpenChange={(open) => !open && void setRecordIdParam(null)}
        recordId={selectedRecordId}
      />
    </div>
  )
}
