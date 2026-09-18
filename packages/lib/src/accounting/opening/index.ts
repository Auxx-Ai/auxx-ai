// packages/lib/src/accounting/opening/index.ts
//
// Server entry point for the opening trial balance - the one `opening_balance`
// journal entry an organization ever makes, and the screens that fill it
// (plans/accounting/tasks/done/03-opening-balances.md, HANDOFF slot 1C).
//
// Client code must import `@auxx/lib/accounting/opening/client`, never this barrel: the
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
export {
  fillOpeningTrialBalanceFromProvider,
  type ProviderOpeningFillOutcome,
} from './fill-from-provider'
export {
  FINALIZED_SETUP_STATE,
  OPENING_BASELINE_SETTING_KEYS,
  type OpeningBaseline,
  readOpeningBaseline,
} from './opening-baseline'
// ── plans/accounting/tasks/19: opening balances from the provider, pure half ──
export {
  type ProviderOpeningFillInput,
  type ProviderOpeningFillPlan,
  planProviderOpeningFill,
} from './opening-fill-plan'
export { findOpeningTrialBalanceEntry, readOpeningTrialBalance } from './reads'
export {
  postOpeningTrialBalance,
  previewOpeningTrialBalance,
  requireCutoverDate,
  type SaveOpeningTrialBalanceInput,
  saveOpeningTrialBalance,
} from './writes'
