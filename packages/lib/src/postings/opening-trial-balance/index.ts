// packages/lib/src/postings/opening-trial-balance/index.ts
//
// Server entry point for the opening trial balance - the one `opening_balance`
// journal entry an organization ever makes, and the screens that fill it
// (plans/accounting/tasks/03-opening-balances.md, HANDOFF slot 1C).
//
// Client code must import `@auxx/lib/postings/client`, never this barrel: the
// writes pull `UnifiedCrudHandler` and the whole server graph behind it.

export {
  findLockedRowDivergences,
  type LockedRowDivergence,
  OPENING_TRIAL_BALANCE_FREEZE_KEY,
  OPENING_TRIAL_BALANCE_KIND,
  type OpeningTrialBalancePosting,
  type OpeningTrialBalanceRow,
  type OpeningTrialBalanceView,
  rowsToJournalEntryLines,
  sortChartAccountsForStatement,
} from './client'
export { findOpeningTrialBalanceEntry, readOpeningTrialBalance } from './reads'
export {
  postOpeningTrialBalance,
  previewOpeningTrialBalance,
  type SaveOpeningTrialBalanceInput,
  saveOpeningTrialBalance,
} from './writes'
