// packages/lib/src/money/bank-deposits/index.ts

/**
 * Bank deposits: grouping received payments into the one line the bank shows
 * (plans/accounting/tasks/06-deposit-grouping.md).
 *
 * ⚠️ A BANK deposit, never a customer deposit. `money/payments/deposit.ts` is
 * money taken before delivery, a liability against `2350 Customer Deposits`.
 * Same English word, two unrelated concepts.
 *
 * Explicit named exports only (`docs/lib-module-guide.md` §5).
 */

export {
  BANK_DEPOSIT_SOURCE_TYPE,
  type BankDepositStatus,
  DEFAULT_PAYMENT_ROUTES,
  groupByDay,
  isBankDepositFrozen,
  methodsRoutedToUndepositedFunds,
  PAYMENT_ROUTE_SETTING_KEYS,
  PAYMENT_ROUTE_SETTING_OPTIONS,
  type PaymentRoute,
  type PaymentRouteMethod,
  resolveBankDepositStatus,
  resolvePaymentRoute,
} from './client'
export {
  type BankDepositFieldContext,
  getBankDeposit,
  listBankDeposits,
  listUndepositedPayments,
  loadBankDepositFieldContext,
  type PaymentFieldContext,
  readBankDepositDetail,
  readDepositPayments,
  requireBankDepositFieldContext,
  requirePaymentFieldContext,
} from './reads'
export type {
  BankDepositDetail,
  BankDepositRecord,
  ClearBankDepositInput,
  CreateBankDepositInput,
  CreateBankDepositResult,
  ListBankDepositsFilters,
  ListUndepositedFilters,
  UndepositedPaymentRow,
  UpdateBankDepositInput,
} from './types'
export {
  clearBankDeposit,
  createBankDeposit,
  hasBankDeposits,
  unlinkPaymentsFromDeposit,
  updateBankDeposit,
} from './writes'
