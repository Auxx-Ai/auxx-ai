// packages/lib/src/accounting/opening/index.ts
//
// Server entry point for the opening - the one `opening_balance` journal entry an
// organization makes, how it is filled, and finalizing setup around it.
//
// Client code must import `@auxx/lib/accounting/opening/client`, never this barrel.

export {
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
export { type FinalizeSetupOutcome, finalizeAccountingSetup } from './finalize-setup'
export {
  type ProviderOpeningFillInput,
  type ProviderOpeningFillPlan,
  planProviderOpeningFill,
  type UnmatchedProviderBalance,
} from './opening-fill-plan'
export {
  findOpeningTrialBalanceEntry,
  readOpeningPresence,
  readOpeningTrialBalance,
} from './reads'
export {
  postOpeningTrialBalance,
  previewOpeningTrialBalance,
  requireCutoverDate,
  type SaveOpeningTrialBalanceInput,
  saveOpeningTrialBalance,
} from './writes'
