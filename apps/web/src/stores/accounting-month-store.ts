// apps/web/src/stores/accounting-month-store.ts

import { create } from 'zustand'

interface AccountingMonthState {
  /** The `YYYY-MM` the ledger was last showing, or `null` if it has not been opened. */
  lastMonth: string | null
  setLastMonth: (periodKey: string) => void
}

/**
 * The month the accounting module carries across a tab switch.
 *
 * The URL is the source of truth while you are ON the ledger (`?month=`), but
 * Banking, Reports and Settings have no month of their own and their routes do
 * not carry one - the settings and reports index routes even `redirect()` to a
 * leaf, which drops the query string, and `SidebarSecondary` links inside the
 * settings segment drop it again. Threading a param nobody reads through all of
 * that to get it home is a lot of surface for one string, so the module
 * remembers it here instead and the ledger restores it on arrival.
 *
 * 🛑 In memory on purpose, NOT persisted. A remembered month is only right for
 * as long as "where I was a moment ago" is the question. Persisted, opening
 * Accounting tomorrow would land you on yesterday's month instead of the
 * earliest one still open, which is the whole point of the resolved default.
 */
export const useAccountingMonthStore = create<AccountingMonthState>()((set) => ({
  lastMonth: null,
  setLastMonth: (lastMonth) => set({ lastMonth }),
}))
