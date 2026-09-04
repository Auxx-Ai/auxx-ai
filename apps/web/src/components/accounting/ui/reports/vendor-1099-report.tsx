// apps/web/src/components/accounting/ui/reports/vendor-1099-report.tsx

'use client'

import { toCsvRows } from '@auxx/lib/postings/client'
import { Button } from '@auxx/ui/components/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@auxx/ui/components/dropdown-menu'
import { ScrollArea } from '@auxx/ui/components/scroll-area'
import { Separator } from '@auxx/ui/components/separator'
import { Skeleton } from '@auxx/ui/components/skeleton'
import { toastError } from '@auxx/ui/components/toast'
import { cn } from '@auxx/ui/lib/utils'
import { ChevronDown, FileDown, FileSpreadsheet, FileText } from 'lucide-react'
import { parseAsInteger, useQueryState } from 'nuqs'
import { useLedgerPeriod } from '~/components/accounting/hooks/use-ledger-period'
import { EmptyState } from '~/components/global/empty-state'
import { downloadCsv } from '~/lib/csv'
import { api } from '~/trpc/react'
import { CompletenessBanner } from './completeness-banner'
import { ReportErrorCard } from './report-error-card'
import { toStatementTableRows } from './report-helpers'
import { StatementTable } from './statement-table'

/** The last several tax years, newest first - `readVendor1099Summary` never refuses a year, so this is a UI convenience, not a validity bound. */
function recentYears(currentYear: number, count = 6): number[] {
  return Array.from({ length: count }, (_, index) => currentYear - index)
}

/**
 * `/app/accounting/reports/vendor-1099` (`plans/accounting/HANDOFF.md` slot
 * 2K read, 2H page). Its own toolbar rather than `ReportToolbar`'s `asOf`/
 * `range` modes: the 1099 summary is a CALENDAR-YEAR report, and
 * `readVendor1099Summary` is not a GL read at all
 * (`postings/reports/vendor-1099.ts`'s own header) - there is no ledger
 * period list to drive a month dropdown from.
 */
export function Vendor1099ReportPage() {
  const period = useLedgerPeriod()
  const currentYear = new Date().getUTCFullYear()
  const [year, setYear] = useQueryState('year', parseAsInteger.withDefault(currentYear))

  const query = api.ledgerReports.vendor1099.useQuery({ year })
  const renderPdf = api.ledgerReports.renderStatementPdf.useMutation({
    onError: (error) => toastError({ title: 'Error generating PDF', description: error.message }),
  })

  function handleDownloadPdf() {
    renderPdf.mutate(
      { kind: 'vendor-1099', year },
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
      `1099-summary-${year}.csv`
    )
  }

  const rows = query.data ? toStatementTableRows(query.data.rows) : []
  const hasActivity = rows.length > 0

  // One `MainPageContent` per screen, and it is the reports LAYOUT's - see
  // `accounting/settings/layout.tsx` for the same split. A second one here
  // nested a `PanelFrame` inside a `PanelFrame`, which doubled the border and
  // the padding on every report.
  return (
    <div className='flex h-full min-h-0 w-full flex-1 flex-col'>
      <div className='flex flex-wrap items-center gap-1 border-b p-1'>
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

        <div className='flex-1' />

        <Separator orientation='vertical' className='h-6' />
        <Button variant='ghost' size='sm' loading={renderPdf.isPending} onClick={handleDownloadPdf}>
          <FileDown />
          PDF
        </Button>
        <Button variant='ghost' size='sm' onClick={handleDownloadCsv}>
          <FileSpreadsheet />
          CSV
        </Button>
      </div>
      <ScrollArea className='min-h-0 flex-1' scrollbarClassName='w-1.5'>
        <div className='mx-auto flex w-full max-w-5xl flex-col gap-3 p-4'>
          <CompletenessBanner asOf={`${year}-12-31`} />
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
            />
          )}
        </div>
      </ScrollArea>
    </div>
  )
}
