// apps/web/src/components/accounting/ui/reports/use-report-window.ts

'use client'

/**
 * The one window every report shares, on `?from=`/`?to=`.
 *
 * 🛑 An as-of report (trial balance, balance sheet, aging) reads only `to`. It
 * carries `from` without using it, so switching between reports keeps the
 * window instead of resetting each one to its own default — and so the
 * drill-down has a start date to hand the ledger (`tasks/57` §7.1: on
 * QuickBooks the `From` control on an as-of report is the drill-down window,
 * not an input to the summary).
 */

import { fiscalYearStart } from '@auxx/lib/accounting/reports/client'
import { todayInZone } from '@auxx/utils/calendar-day'
import { useQueryState } from 'nuqs'
import { useCallback } from 'react'

export interface ReportAsOfWindow {
  /** `YYYY-MM-DD`, or `''` when the org has no periods at all. */
  asOf: string
  /** The carried range start, for the drill-down only. Null when nothing set it. */
  from: string | null
  setAsOf: (day: string) => void
}

/**
 * `hasPeriods` gates the empty `asOf` that the pages' "nothing has posted yet"
 * branch keys on — without it a brand-new org would render a statement as of
 * today over a ledger that was never set up.
 *
 * `fiscalYearStartMonth` comes off `useLedgerPeriod`, the same place
 * `bookTimeZone` does.
 */
export function useReportAsOf(
  bookTimeZone: string,
  hasPeriods: boolean,
  fiscalYearStartMonth: number
): ReportAsOfWindow {
  const [toParam, setToParam] = useQueryState('to')
  const [fromParam, setFromParam] = useQueryState('from')

  const asOf = toParam || (hasPeriods ? todayInZone(bookTimeZone) : '')

  const setAsOf = useCallback(
    (day: string) => {
      void setToParam(day)
      // Picking an earlier as-of than the carried `from` would leave an
      // inverted window for the next range report to open with. Pull the start
      // back to the fiscal year the new date falls in rather than dropping it,
      // so the P&L still lands on a range somebody would have chosen.
      if (fromParam && fromParam > day)
        void setFromParam(fiscalYearStart(day, fiscalYearStartMonth))
    },
    [fiscalYearStartMonth, fromParam, setFromParam, setToParam]
  )

  return { asOf, from: fromParam, setAsOf }
}
