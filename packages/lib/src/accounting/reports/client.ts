// packages/lib/src/accounting/reports/client.ts
//
// The client-safe half of `accounting/reports/`: statement shapes and the pure
// row/statement arithmetic the screens render (docs/lib-module-guide.md §7).
//
// NOTE: no 'use client' directive - server code imports this file too, and the
// directive would turn every export into a client-reference proxy there.

// ── Statements (HANDOFF slot 1E, wave 1) - pure pieces only. The reads
// (`readTrialBalance`, `readBalanceSheet`, `readProfitAndLoss`,
// `readCompleteness`, `readGeneralLedger`) and the PDF render touch a database
// or react-pdf/S3 and stay server-only, exported from `./index` only. ────────
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
export type {
  BalanceSheet,
  BalanceSheetRow,
  BalanceSheetSnapshot,
  CustomerDepositsRow,
} from './balance-sheet'
export type { Completeness, CompletenessItem } from './completeness'
export {
  DEFAULT_FISCAL_YEAR_START_MONTH,
  FISCAL_YEAR_START_MONTH_OPTIONS,
  FISCAL_YEAR_START_MONTH_SETTING_KEY,
  fiscalYearStart,
  normalizeFiscalYearStartMonth,
  previousCalendarDay,
} from './fiscal-year'
// The general ledger (task 21 §5). Types only: `readGeneralLedger` and its
// `GENERAL_LEDGER_MAX_LINES` guard are a db read and a server policy, and stay
// on `./index`. `toGeneralLedgerRows`/`GENERAL_LEDGER_COLUMNS` are pure and
// come through the adapters block above, like every other statement's.
export type { AccountLineRow, GeneralLedger, GeneralLedgerAccount } from './general-ledger'
export type {
  GeneralLedgerLine,
  GeneralLedgerSummary,
  GeneralLedgerSummaryAccount,
} from './general-ledger-pages'
export type {
  RenderStatementPdfOptions,
  RenderStatementPdfParamsByKind,
  RenderStatementPdfResult,
  StatementKind,
} from './pdf/render-statement-pdf'
export type {
  ProfitAndLoss,
  ProfitAndLossRow,
  ProfitAndLossSnapshot,
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
export type { TrialBalance, TrialBalanceRow } from './trial-balance'
export type {
  TrialBalanceRetainedEarnings,
  TrialBalanceStatement,
} from './trial-balance-statement'
export type { Vendor1099Row, Vendor1099Summary } from './vendor-1099-rows'
// ── HANDOFF slot 2K (accountant profile, 1099/W-9, write-off) ──────────────
export {
  toVendor1099CsvRows,
  toVendor1099Rows,
  VENDOR_1099_COLUMNS,
  VENDOR_1099_THRESHOLD_MINOR,
} from './vendor-1099-rows'
