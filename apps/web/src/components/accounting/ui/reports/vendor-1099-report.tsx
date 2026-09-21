// apps/web/src/components/accounting/ui/reports/vendor-1099-report.tsx

'use client'

import { toCsvRows } from '@auxx/lib/accounting/reports/client'
import type { RecordId } from '@auxx/types/resource'
import { isRecordId } from '@auxx/types/resource'
import { Button } from '@auxx/ui/components/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@auxx/ui/components/dropdown-menu'
import { ScrollArea } from '@auxx/ui/components/scroll-area'
import { Skeleton } from '@auxx/ui/components/skeleton'
import { toastError } from '@auxx/ui/components/toast'
import { cn } from '@auxx/ui/lib/utils'
import { ChevronDown, FileText } from 'lucide-react'
import { parseAsInteger, parseAsString, useQueryState } from 'nuqs'
import { useCallback, useMemo } from 'react'
import { useRegisterAccountingToolbar } from '~/components/accounting/accounting-toolbar-outlet'
import { useLedgerPeriod } from '~/components/accounting/hooks/use-ledger-period'
import { useRegisterDockedPanels } from '~/components/global/docked-panels-outlet'
import { EmptyState } from '~/components/global/empty-state'
import { RecordDrawer } from '~/components/records/record-drawer'
import { useDockedPanels } from '~/hooks/use-docked-panels'
import { downloadCsv } from '~/lib/csv'
import { api } from '~/trpc/react'
import { ReportErrorCard } from './report-error-card'
import { toStatementTableRows } from './report-helpers'
import { ReportToolbarActions } from './report-toolbar'
import { StatementNotices } from './statement-notices'
import { StatementTable } from './statement-table'

/** The last several tax years, newest first - `readVendor1099Summary` never refuses a year, so this is a UI convenience, not a validity bound. */
function recentYears(currentYear: number, count = 6): number[] {
  return Array.from({ length: count }, (_, index) => currentYear - index)
}

/**
 * `/app/accounting/reports/vendor-1099` (`plans/accounting/HANDOFF.md` slot
 * 2K read, 2H page). Its own period control rather than
 * `ReportToolbarControls`' `asOf`/`range` modes: the 1099 summary is a
 * CALENDAR-YEAR report, and
 * `readVendor1099Summary` is not a GL read at all
 * (`postings/reports/vendor-1099.ts`'s own header) - there is no ledger
 * period list to drive a month dropdown from.
 */
export function Vendor1099ReportPage() {
  const period = useLedgerPeriod()
  const currentYear = new Date().getUTCFullYear()
  const [recordIdParam, setRecordIdParam] = useQueryState('id', parseAsString.withDefault(''))
  const selectedRecordId = isRecordId(recordIdParam) ? (recordIdParam as RecordId) : undefined

  // The vendor behind a row, on `?id=` - the same door the aging report opens.
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
  // `overlay: true` unconditionally - see `posting-drawer-host.tsx`.
  const panels = useMemo(
    () => [
      {
        key: 'vendor-1099-record',
        open: { docked: !!selectedRecordId, overlay: true },
        content: drawer,
      },
    ],
    [selectedRecordId, drawer]
  )
  const { dockedPanels, overlays } = useDockedPanels(panels)
  useRegisterDockedPanels(dockedPanels)
  const [year, setYear] = useQueryState('year', parseAsInteger.withDefault(currentYear))

  const query = api.ledgerReports.vendor1099.useQuery({ year })
  const renderPdf = api.ledgerReports.renderStatementPdf.useMutation({
    onError: (error) => toastError({ title: 'Error generating PDF', description: error.message }),
  })

  // The handlers are `useCallback`s only because the toolbar registration below
  // is memoised over them - a fresh identity each render republishes forever.
  const renderPdfMutate = renderPdf.mutate
  const handleDownloadPdf = useCallback(() => {
    renderPdfMutate(
      { kind: 'vendor-1099', year },
      {
        onSuccess: ({ assetId }) =>
          window.open(`/api/files/download/asset:${assetId}`, '_blank', 'noopener,noreferrer'),
      }
    )
  }, [renderPdfMutate, year])

  const data = query.data
  const currencyCode = period.currencyCode
  const handleDownloadCsv = useCallback(() => {
    if (!data) return
    downloadCsv(toCsvRows(data.rows, data.columns, currencyCode), `1099-summary-${year}.csv`)
  }, [data, currencyCode, year])

  // Its own left half rather than `ReportToolbarControls`' `asOf`/`range` modes:
  // the 1099 summary is a CALENDAR-YEAR report with no ledger period behind it.
  useRegisterAccountingToolbar(
    useMemo(
      () => ({
        left: (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant='ghost' size='sm' className='min-w-[8rem] justify-between gap-1'>
                <span className='text-muted-foreground'>Year</span>
                {year}
                <ChevronDown />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align='start'>
              {recentYears(currentYear).map((option) => (
                <DropdownMenuItem key={option} onSelect={() => void setYear(option)}>
                  <span className={cn(option === year && 'font-medium')}>{option}</span>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        ),
        right: (
          <ReportToolbarActions
            onDownloadPdf={handleDownloadPdf}
            onDownloadCsv={handleDownloadCsv}
            through={`${year}-12-31`}
            isDownloadingPdf={renderPdf.isPending}
          />
        ),
      }),
      [year, currentYear, setYear, handleDownloadPdf, handleDownloadCsv, renderPdf.isPending]
    )
  )

  const rows = query.data ? toStatementTableRows(query.data.rows) : []
  const hasActivity = rows.length > 0

  // One `MainPageContent` per screen and it is the accounting LAYOUT's, which
  // also owns the topbar this page registers into (`tasks/81` §6): a document
  // page is one `ScrollArea` over everything.
  return (
    <div className='flex h-full min-h-0 w-full flex-1 flex-col'>
      <ScrollArea className='min-h-0 flex-1' scrollbarClassName='w-1.5'>
        <div className='mx-auto flex w-full max-w-5xl flex-1 flex-col gap-3 p-4'>
          <StatementNotices through={`${year}-12-31`} />
          {query.isPending ? (
            <Skeleton className='h-64 w-full' />
          ) : query.error ? (
            <ReportErrorCard message={query.error.message} />
          ) : !hasActivity ? (
            <EmptyState
              icon={FileText}
              title='No 1099s to file'
              description={`No eligible vendor reached the $600 filing threshold in ${year}.`}
            />
          ) : (
            <StatementTable
              columns={query.data?.columns ?? []}
              rows={rows}
              currency={period.currencyCode}
              // Only the vendor lines carry one; a box section and its subtotal
              // do not, so they expand and sit still respectively.
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
