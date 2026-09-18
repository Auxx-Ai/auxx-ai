// packages/lib/src/accounting/money/client.ts

// Pure shapes, constants and helpers from the money model — no `@auxx/database`/server
// deps, and deliberately NO 'use client' directive (see project memory "'use client' in
// lib client.ts breaks server imports").

// ─── Bank deposits (plans/accounting/tasks/done/06-deposit-grouping.md, slot 1D) ──
// The client-safe half only: constants, the status union, and the pure route
// and grouping helpers the deposits page reads. Nothing here imports a database.
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
} from './bank-deposits/client'
export {
  PAYOUT_STATUSES,
  type PayoutItem,
  type PayoutSplit,
  type PayoutStatus,
  resolvePayoutStatus,
  splitPayout,
} from './payouts/client'
