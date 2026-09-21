// apps/web/src/components/accounting/ui/reports/aging-report.tsx

'use client'

import { toCsvRows } from '@auxx/lib/accounting/reports/client'
import type { RecordId } from '@auxx/types/resource'
import { isRecordId } from '@auxx/types/resource'
import { ScrollArea } from '@auxx/ui/components/scroll-area'
import { Skeleton } from '@auxx/ui/components/skeleton'
import { toastError } from '@auxx/ui/components/toast'
import { todayInZone } from '@auxx/utils/calendar-day'
import { Building2, Users } from 'lucide-react'
import { parseAsString, useQueryState } from 'nuqs'
import { useCallback, useMemo } from 'react'
import { useRegisterAccountingToolbar } from '~/components/accounting/accounting-toolbar-outlet'
import { useLedgerPeriod } from '~/components/accounting/hooks/use-ledger-period'
import { useRegisterDockedPanels } from '~/components/global/docked-panels-outlet'
import { EmptyState } from '~/components/global/empty-state'
import { RecordDrawer } from '~/components/records/record-drawer'
import { useDockedPanels } from '~/hooks/use-docked-panels'
import { downloadCsv } from '~/lib/csv'
import { api } from '~/trpc/react'
import { formatMinor } from '../ledger/format'
import { ReportErrorCard } from './report-error-card'
import { periodStartDate, toStatementTableRows } from './report-helpers'
import { reportAsOfPresets } from './report-range-presets'
import { ReportToolbarActions, ReportToolbarControls } from './report-toolbar'
import { StatementNotices } from './statement-notices'
import { StatementTable } from './statement-table'
import { useReportAsOf } from './use-report-window'

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
  const [recordIdParam, setRecordIdParam] = useQueryState('id', parseAsString.withDefault(''))

  const cutoff = period.options[0] ? periodStartDate(period.options[0].periodKey) : null
  const { asOf, setAsOf } = useReportAsOf(
    period.bookTimeZone,
    !!period.resolvedPeriodKey,
    period.fiscalYearStartMonth
  )
  const asOfPresets = useMemo(
    () => reportAsOfPresets(todayInZone(period.bookTimeZone), cutoff),
    [period.bookTimeZone, cutoff]
  )
  const selectedRecordId = isRecordId(recordIdParam) ? (recordIdParam as RecordId) : undefined

  // 🛑 Published to the accounting layout's outlet, not rendered inline. A
  // `DockableDrawer` that is docked with no portal target renders its children
  // where they stand, which put this drawer in the middle of the statement -
  // the same trap `posting-drawer-host.tsx` documents.
  const drawer = useMemo(
    () => (
      <RecordDrawer
        open={!!selectedRecordId}
        onOpenChange={(open) => !open && void setRecordIdParam(null)}
        recordId={selectedRecordId}
      />
    ),
    [selectedRecordId, setRecordIdParam]
  )
  // `overlay: true` unconditionally so the drawer can animate itself shut on
  // its own `open` - see `posting-drawer-host.tsx` for the full note.
  const panels = useMemo(
    () => [
      {
        key: 'aging-record',
        open: { docked: !!selectedRecordId, overlay: true },
        content: drawer,
      },
    ],
    [selectedRecordId, drawer]
  )
  const { dockedPanels, overlays } = useDockedPanels(panels)
  useRegisterDockedPanels(dockedPanels)

  const query = api.ledgerReports.aging.useQuery({ side, asOf }, { enabled: !!asOf })
  const renderPdf = api.ledgerReports.renderStatementPdf.useMutation({
    onError: (error) => toastError({ title: 'Error generating PDF', description: error.message }),
  })

  // The handlers are `useCallback`s only because the toolbar registration below
  // is memoised over them - a fresh identity each render republishes forever.
  const renderPdfMutate = renderPdf.mutate
  const kind = copy.kind
  const handleDownloadPdf = useCallback(() => {
    renderPdfMutate(
      { kind, asOf },
      {
        onSuccess: ({ assetId }) =>
          window.open(`/api/files/download/asset:${assetId}`, '_blank', 'noopener,noreferrer'),
      }
    )
  }, [renderPdfMutate, kind, asOf])

  const data = query.data
  const currencyCode = period.currencyCode
  const handleDownloadCsv = useCallback(() => {
    if (!data) return
    downloadCsv(toCsvRows(data.rows, data.columns, currencyCode), `${kind}-${asOf}.csv`)
  }, [data, currencyCode, kind, asOf])

  useRegisterAccountingToolbar(
    useMemo(
      () => ({
        left: (
          <ReportToolbarControls
            mode='asOf'
            asOf={asOf}
            onSelectAsOf={setAsOf}
            asOfPresets={asOfPresets}
            cutoff={cutoff}
            disabled={!asOf}
          />
        ),
        right: (
          <ReportToolbarActions
            onDownloadPdf={handleDownloadPdf}
            onDownloadCsv={handleDownloadCsv}
            through={asOf}
            isDownloadingPdf={renderPdf.isPending}
          />
        ),
      }),
      [
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

  const rows = query.data ? toStatementTableRows(query.data.rows) : []
  // `toAgingRows` always appends its own `'total'` row, even over zero
  // groups (`trial-balance.tsx`'s own `rows.length > 1` reasoning).
  const hasActivity = rows.length > 1

  // One `MainPageContent` per screen and it is the accounting LAYOUT's, which
  // also owns the topbar this page registers into (`tasks/81` §6): a document
  // page is one `ScrollArea` over everything.
  return (
    <div className='flex h-full min-h-0 w-full flex-1 flex-col'>
      <ScrollArea className='min-h-0 flex-1' scrollbarClassName='w-1.5'>
        <div className='mx-auto flex w-full max-w-5xl flex-1 flex-col gap-3 p-4'>
          <StatementNotices through={asOf} />
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
              // A contact/vendor GROUP row has no `recordId`, so it is not
              // drillable and its body falls through to expand. Payment and
              // manual-line documents have none either, and open nothing.
              canRowDrill={(row) => !!row.meta?.recordId}
              onRowClick={(row) =>
                row.meta?.recordId ? void setRecordIdParam(row.meta.recordId) : undefined
              }
            />
          )}
        </div>
      </ScrollArea>
      {overlays}
    </div>
  )
}
