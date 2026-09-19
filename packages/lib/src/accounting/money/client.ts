// packages/lib/src/accounting/money/client.ts

// Pure shapes, constants and helpers from the money model — no `@auxx/database`/server
// deps, and deliberately NO 'use client' directive (see project memory "'use client' in
// lib client.ts breaks server imports").

import { UnprocessableEntityError } from '../../errors'

/** How the money moved. Descriptive only — it decides nothing (task 71 D3). */
export type PaymentMethod = 'cash' | 'check' | 'card' | 'bank' | 'other'

/** How a movement names where its money sits: a rail, a bank account, or neither. */
export interface CashEndpointSource {
  paymentGatewayId: string | null
  cashAccountInstanceId: string | null
  /** ISO 4217. Scopes the rail's clearing row; ignored for the other two shapes. */
  currency: string
}

export type CashEndpointKind = 'clearing' | 'bank_account' | 'undeposited_funds'

/** A movement names a rail, a bank account, or neither. Never both. */
export function validateCashEndpointSource(source: CashEndpointSource): void {
  if (source.paymentGatewayId?.trim() && source.cashAccountInstanceId?.trim())
    throw new UnprocessableEntityError(
      'Money moves through a payment gateway or into a bank account, never both'
    )
}

/** How a movement's money is held — the pure half of `resolveCashEndpoint`. */
export function cashEndpointKind(source: CashEndpointSource): CashEndpointKind {
  if (source.paymentGatewayId?.trim()) return 'clearing'
  if (source.cashAccountInstanceId?.trim()) return 'bank_account'
  return 'undeposited_funds'
}

// ─── Bank deposits (plans/accounting/tasks/done/06-deposit-grouping.md, slot 1D) ──
// The client-safe half only: constants, the status union, and the pure grouping
// helpers the deposits page reads. Nothing here imports a database.
export {
  BANK_DEPOSIT_SOURCE_TYPE,
  type BankDepositStatus,
  groupByDay,
  isBankDepositFrozen,
  resolveBankDepositStatus,
} from './bank-deposits/client'
export {
  PAYOUT_STATUSES,
  type PayoutItem,
  type PayoutSplit,
  type PayoutStatus,
  resolvePayoutStatus,
  splitPayout,
} from './payouts/client'
