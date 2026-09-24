// apps/web/src/components/accounting/ui/reports/general-ledger.tsx

'use client'

import { Button } from '@auxx/ui/components/button'
import { Skeleton } from '@auxx/ui/components/skeleton'
import { todayInZone } from '@auxx/utils/calendar-day'
import { BookOpen } from 'lucide-react'
import Link from 'next/link'
import { useQueryState } from 'nuqs'
import { useMemo } from 'react'
import { useRegisterAccountingToolbar } from '~/components/accounting/accounting-toolbar-outlet'
import { useLedgerPeriod } from '~/components/accounting/hooks/use-ledger-period'
import { EmptyState } from '~/components/global/empty-state'
import { api } from '~/trpc/react'
import { formatAccountLabel } from '../account-label'
import { GeneralLedgerView, useGeneralLedgerExports } from './general-ledger-view'
import { periodEndDate, periodStartDate } from './report-helpers'
import { ReportMessage, ReportPageLayout } from './report-page-layout'
import { generalLedgerRangePresets } from './report-range-presets'
import { ReportBreadcrumb, ReportToolbarActions, ReportToolbarControls } from './report-toolbar'

/**
 * `/app/accounting/reports/general-ledger` (`plans/accounting/tasks/
 * 21-the-books-stand-alone.md` §5): every posted line over a range, one section
 * per account. Sections come from one summary read and their lines load a page
 * at a time (108 §3.2), so no range is ever cut short.
 */
export function GeneralLedgerReportPage() {
  const period = useLedgerPeriod()
  const [fromParam, setFromParam] = useQueryState('from')
  const [toParam, setToParam] = useQueryState('to')
  // A record drawer's "Open in ledger" and old statement links narrow to one account.
  const [accountParam, setAccountParam] = useQueryState('account')
  // `<sourceKind>:<sourceId>`: every posting linked to that record, no opening balances.
  const [sourceParam, setSourceParam] = useQueryState('source')
  const source = useMemo(() => parseSourceParam(sourceParam), [sourceParam])

  // The current period by default: the month being worked in.
  const fallbackKey = period.resolvedPeriodKey
  const from = fromParam || (fallbackKey ? periodStartDate(fallbackKey) : '')
  const to = toParam || (fallbackKey ? periodEndDate(fallbackKey) : '')

  const cutoff = period.options[0] ? periodStartDate(period.options[0].periodKey) : null
  const presets = useMemo(
    () => generalLedgerRangePresets(todayInZone(period.bookTimeZone)),
    [period.bookTimeZone]
  )

  // The narrowed account's label, off the same summary the view reads (cached).
  const accountSummary = api.ledgerReports.generalLedgerSummary.useQuery(
    { from, to, glAccountId: accountParam ?? undefined, source },
    { enabled: !!accountParam && !!from && !!to }
  )
  const filtered = accountParam ? accountSummary.data?.accounts[0] : undefined
  const accountLabel = filtered
    ? filtered.nested
      ? filtered.label
      : formatAccountLabel({ code: filtered.accountCode, name: filtered.accountName })
    : null

  const exports = useGeneralLedgerExports({
    from,
    to,
    glAccountId: accountParam ?? undefined,
    source,
    currency: period.currencyCode,
    fileLabel: accountLabel ?? undefined,
  })

  useRegisterAccountingToolbar(
    useMemo(
      () => ({
        left: (
          <>
            <ReportBreadcrumb reportLabel='General ledger' />
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
              filter={
                accountParam
                  ? {
                      label: accountLabel ?? 'One account',
                      onClear: () => void setAccountParam(null),
                    }
                  : source
                    ? {
                        label: `One ${source.sourceKind.replace(/_/g, ' ')}`,
                        onClear: () => void setSourceParam(null),
                      }
                    : undefined
              }
              disabled={!from || !to}
            />
          </>
        ),
        right: (
          <ReportToolbarActions
            onDownloadPdf={exports.downloadPdf}
            onDownloadCsv={exports.downloadCsv}
            from={from}
            through={to}
            isDownloadingPdf={exports.isDownloadingPdf}
          />
        ),
      }),
      [
        from,
        to,
        setFromParam,
        setToParam,
        presets,
        cutoff,
        accountParam,
        accountLabel,
        setAccountParam,
        source,
        setSourceParam,
        exports.downloadPdf,
        exports.downloadCsv,
        exports.isDownloadingPdf,
      ]
    )
  )

  return (
    <ReportPageLayout>
      {period.isLoading ? (
        <ReportMessage>
          <Skeleton className='h-64 w-full' />
        </ReportMessage>
      ) : !from || !to ? (
        // No periods at all: setup was never finalized, so there is no month to cover.
        <ReportMessage>
          <EmptyState
            icon={BookOpen}
            title='Nothing has posted yet'
            description='The general ledger has no lines to show until the ledger is set up and something posts to it.'
            button={
              <Button asChild variant='outline' size='sm'>
                <Link href='/app/accounting'>Go to the ledger</Link>
              </Button>
            }
          />
        </ReportMessage>
      ) : (
        <GeneralLedgerView
          key={`${accountParam ?? ''}|${sourceParam ?? ''}`}
          from={from}
          to={to}
          glAccountId={accountParam ?? undefined}
          source={source}
          currency={period.currencyCode}
          reportKey='general-ledger'
        />
      )}
    </ReportPageLayout>
  )
}

/** `?source=<kind>:<id>` → the filter the read takes; malformed values are ignored. */
function parseSourceParam(value: string | null) {
  if (!value) return undefined
  const at = value.indexOf(':')
  if (at <= 0 || at === value.length - 1) return undefined
  return { sourceKind: value.slice(0, at), sourceId: value.slice(at + 1) }
}
