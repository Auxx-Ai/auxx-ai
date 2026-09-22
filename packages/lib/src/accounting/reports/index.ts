// packages/lib/src/accounting/reports/index.ts
//
// Server entry point for the financial statements read off the ledger: trial
// balance, P&L, balance sheet, general ledger, aging, 1099 and the statement PDF.
//
// Client code must import `@auxx/lib/accounting/reports/client`, never this
// barrel: the reads pull Drizzle and the org cache behind them.

// ── Statements (HANDOFF slot 1E, wave 1) ────────────────────────────────────
export {
  balanceSheetColumns,
  GENERAL_LEDGER_COLUMNS,
  TRIAL_BALANCE_COLUMNS,
  toBalanceSheetRows,
  toGeneralLedgerRows,
  toProfitAndLossRows,
  toTrialBalanceRows,
  toTrialBalanceStatementRows,
} from './adapters'
// ── Aging (HANDOFF slot 2H, wave 2) ─────────────────────────────────────────
export {
  AGING_BUCKET_LABELS,
  AGING_COLUMNS,
  AGING_PRE_CUTOVER_GROUP_ID,
  AGING_UNAPPLIED_GROUP_ID,
  type Aging,
  type AgingBucketKey,
  type AgingDocument,
  type AgingGroup,
  type AgingSide,
  agingBucket,
  type ReadAgingOptions,
  readAging,
  toAgingRows,
} from './aging'
export {
  type BalanceSheet,
  type BalanceSheetRow,
  type BalanceSheetSnapshot,
  type CustomerDepositsRow,
  type ReadBalanceSheetOptions,
  readBalanceSheet,
} from './balance-sheet'
export {
  type Completeness,
  type CompletenessItem,
  type ReadCompletenessOptions,
  readCompleteness,
} from './completeness'
export {
  type DimensionBreakdownRow,
  type ReadDimensionBreakdownOptions,
  readDimensionBreakdown,
} from './dimension-breakdown'
export {
  DEFAULT_FISCAL_YEAR_START_MONTH,
  FISCAL_YEAR_START_MONTH_OPTIONS,
  FISCAL_YEAR_START_MONTH_SETTING_KEY,
  fiscalYearStart,
  normalizeFiscalYearStartMonth,
  previousCalendarDay,
} from './fiscal-year'
export { resolveFiscalYearStartMonth } from './fiscal-year-setting'
// ── The general ledger (task 21 §5): the sixth statement ────────────────────
export {
  type AccountLineRow,
  GENERAL_LEDGER_MAX_LINES,
  type GeneralLedger,
  type GeneralLedgerAccount,
  type ReadGeneralLedgerOptions,
  readGeneralLedger,
} from './general-ledger'
export {
  type RenderStatementPdfOptions,
  type RenderStatementPdfParamsByKind,
  type RenderStatementPdfResult,
  renderStatementPdf,
  type StatementKind,
} from './pdf/render-statement-pdf'
export {
  type ProfitAndLoss,
  type ProfitAndLossRow,
  type ProfitAndLossSnapshot,
  type ReadProfitAndLossOptions,
  readProfitAndLoss,
} from './profit-and-loss'
export {
  computedRow,
  type StatementColumn,
  type StatementLineInput,
  type StatementRow,
  statementSection,
  toCsvRows,
  totalRow,
} from './rows'
export {
  NATURAL_BALANCE_DIRECTION,
  type NetIncomeRow,
  netIncome,
  type RetainedEarnings,
  type RetainedEarningsInput,
  retainedEarnings,
  signedBalance,
} from './statement-math'
export {
  type ReadTrialBalanceOptions,
  readTrialBalance,
  type TrialBalance,
  type TrialBalanceRow,
} from './trial-balance'
export {
  type ReadTrialBalanceStatementOptions,
  readTrialBalanceStatement,
  type TrialBalanceRetainedEarnings,
  type TrialBalanceStatement,
} from './trial-balance-statement'
export {
  type ReadVendor1099SummaryOptions,
  readVendor1099Summary,
  toVendor1099CsvRows,
  toVendor1099Rows,
  VENDOR_1099_COLUMNS,
  VENDOR_1099_THRESHOLD_MINOR,
  type Vendor1099Row,
  type Vendor1099Summary,
} from './vendor-1099'
