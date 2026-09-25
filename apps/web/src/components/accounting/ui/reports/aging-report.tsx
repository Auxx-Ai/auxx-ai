// apps/web/src/components/accounting/ui/reports/aging-report.tsx

'use client'

import { toCsvRows } from '@auxx/lib/accounting/reports/client'
import type { RecordId } from '@auxx/types/resource'
import { isRecordId } from '@auxx/types/resource'
import { Skeleton } from '@auxx/ui/components/skeleton'
import { toastError } from '@auxx/ui/components/toast'
import { todayInZone } from '@auxx/utils/calendar-day'
import { Building2, Users } from 'lucide-react'
import { parseAsString, useQueryState } from 'nuqs'
import { useCallback, useMemo } from 'react'
import { useLedgerPeriod } from '~/components/accounting/hooks/use-ledger-period'
import { useRegisterDockedPanels } from '~/components/global/docked-panels-outlet'
import { EmptyState } from '~/components/global/empty-state'
import { useRegisterModuleToolbar } from '~/components/global/module-toolbar-outlet'
import { ReportGrid } from '~/components/global/report-grid/report-grid'
import { ReportMessage, ReportPageLayout } from '~/components/global/report-grid/report-page-layout'
import { RecordDrawer } from '~/components/records/record-drawer'
import { useDockedPanels } from '~/hooks/use-docked-panels'
import { downloadCsv } from '~/lib/csv'
import { api } from '~/trpc/react'
import { formatMinor } from '../ledger/format'
import { ReportErrorCard } from './report-error-card'
import { periodStartDate, toStatementTableRows } from './report-helpers'
import { reportAsOfPresets } from './report-range-presets'
import { ReportBreadcrumb, ReportToolbarActions, ReportToolbarControls } from './report-toolbar'
import { useReportAsOf } from './use-report-window'

export interface AgingReportPageProps {
  side: 'receivable' | 'payable'
}

const COPY: Record<
  AgingReportPageProps['side'],
  {
    icon: typeof Users
    label: string
    noun: string
    verdictLabel: string
    kind: 'ar-aging' | 'ap-aging'
  }
> = {
  receivable: {
    icon: Users,
    label: 'A/R aging',
    noun: 'A/R',
    verdictLabel: 'A/R',
    kind: 'ar-aging',
  },
  payable: {
    icon: Building2,
    label: 'A/P aging',
    noun: 'A/P',
    verdictLabel: 'A/P',
    kind: 'ap-aging',
  },
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

  useRegisterModuleToolbar(
    useMemo(
      () => ({
        left: (
          <>
            <ReportBreadcrumb reportLabel={copy.label} />
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
        copy.label,
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

  return (
    <div className='flex min-h-0 min-w-0 flex-1 flex-col'>
      <ReportPageLayout>
        {period.isLoading || (!!asOf && query.isPending) ? (
          <ReportMessage>
            <Skeleton className='h-64 w-full' />
          </ReportMessage>
        ) : !asOf ? (
          <ReportMessage>
            <EmptyState
              icon={copy.icon}
              title='Nothing has posted yet'
              description={`${copy.noun} aging has nothing to show until the ledger is set up and something posts to it.`}
            />
          </ReportMessage>
        ) : query.error ? (
          <ReportMessage>
            <ReportErrorCard message={query.error.message} />
          </ReportMessage>
        ) : !hasActivity ? (
          <ReportMessage>
            <EmptyState
              icon={copy.icon}
              title={`No open ${copy.noun}`}
              description={`Nothing is open on ${copy.noun} as of this date.`}
            />
          </ReportMessage>
        ) : (
          <ReportGrid
            reportKey={copy.kind}
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
            // A contact/vendor group row has no `recordId`, so its body expands;
            // payment and manual-line documents have none either and open nothing.
            canRowDrill={(row) => !!row.meta?.recordId}
            isRowActive={(row) => !!selectedRecordId && row.meta?.recordId === selectedRecordId}
            onRowClick={(row) =>
              row.meta?.recordId ? void setRecordIdParam(row.meta.recordId) : undefined
            }
          />
        )}
      </ReportPageLayout>
      {overlays}
    </div>
  )
}
