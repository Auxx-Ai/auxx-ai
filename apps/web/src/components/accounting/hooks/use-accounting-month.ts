// apps/web/src/components/accounting/hooks/use-accounting-month.ts

'use client'

import { useQueryState } from 'nuqs'
import { useCallback } from 'react'
import { useAccountingMonthStore } from '~/stores/accounting-month-store'

/** The query param the ledger's month lives in: `?month=2026-02`. */
export const MONTH_PARAM = 'month'

/** `YYYY-MM`, months 01-12. Anything else is somebody typing in the URL bar. */
const MONTH_PATTERN = /^\d{4}-(?:0[1-9]|1[0-2])$/

export interface AccountingMonthModel {
  /**
   * The month to render: the URL's when it has one, else the month this session
   * was last on, else `undefined` for "resolve the default".
   */
  requestedMonth: string | undefined
  /** Go to a month. PUSHES history, so Back walks back through months. */
  selectMonth: (periodKey: string) => void
  /**
   * Record the month that actually resolved on screen. Writes it into the URL
   * with `replace` and into the module's memory; call it from an effect with
   * whatever `useLedgerPeriod` settled on.
   */
  syncMonth: (periodKey: string) => void
}

/**
 * Which month the accounting module is on, as `?month=YYYY-MM`.
 *
 * 🛑 The URL is the truth and the store is only its memory. `?month=` is what
 * makes a month shareable, bookmarkable and Back-able; `useAccountingMonthStore`
 * exists solely because Banking, Reports and Settings do not carry the param -
 * see that store's header for why threading it through them is worse than
 * remembering it. Arriving at `/app/accounting` with no param restores the
 * remembered month and writes it back into the URL, so what is on screen and
 * what is in the address bar never disagree.
 *
 * ⚠️ A month the URL asks for is NOT trusted to exist. This validates the shape
 * only; `useLedgerPeriod` refuses a well-formed month that is not in the org's
 * period list and falls back to the resolved one, which is also what keeps a
 * hand-typed `?month=1999-01` out of `previewMonthEnd`'s input.
 */
export function useAccountingMonth(): AccountingMonthModel {
  const [param, setParam] = useQueryState(MONTH_PARAM)
  const lastMonth = useAccountingMonthStore((state) => state.lastMonth)
  const setLastMonth = useAccountingMonthStore((state) => state.setLastMonth)

  const fromUrl = param && MONTH_PATTERN.test(param) ? param : null

  const selectMonth = useCallback(
    (periodKey: string) => {
      void setParam(periodKey, { history: 'push' })
    },
    [setParam]
  )

  const syncMonth = useCallback(
    (periodKey: string) => {
      if (periodKey !== lastMonth) setLastMonth(periodKey)
      // `replace`: settling on a month is not a navigation anybody performed, so
      // it must not leave a history entry for Back to walk into.
      if (periodKey !== param) void setParam(periodKey, { history: 'replace' })
    },
    [lastMonth, param, setLastMonth, setParam]
  )

  return { requestedMonth: fromUrl ?? lastMonth ?? undefined, selectMonth, syncMonth }
}
