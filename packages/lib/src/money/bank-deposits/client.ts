// packages/lib/src/money/bank-deposits/client.ts

/**
 * Client-safe constants and pure helpers for bank deposits.
 *
 * Imports nothing server-only, and carries NO `'use client'` directive: server
 * code imports this file too, and the directive turns every export into a
 * client-reference proxy there (`docs/lib-module-guide.md` §7).
 */

export {
  DEFAULT_PAYMENT_ROUTES,
  methodsRoutedToUndepositedFunds,
  PAYMENT_ROUTE_SETTING_KEYS,
  PAYMENT_ROUTE_SETTING_OPTIONS,
  type PaymentRoute,
  type PaymentRouteMethod,
  resolvePaymentRoute,
} from './route'

/** A deposit is `pending` until the bank shows it, then `cleared`. */
export type BankDepositStatus = 'pending' | 'cleared'

/** The `sourceType` every `bank_deposit` posting line carries. */
export const BANK_DEPOSIT_SOURCE_TYPE = 'bank_deposit'

/**
 * Narrow a stored `optionId` to a {@link BankDepositStatus}.
 *
 * Anything unrecognised reads `pending`: an unposted, unbanked deposit is the
 * safe reading, because `cleared` is the value that FREEZES the row, and
 * guessing it would lock a deposit nobody has matched.
 */
export function resolveBankDepositStatus(value: string | null | undefined): BankDepositStatus {
  return value === 'cleared' ? 'cleared' : 'pending'
}

/**
 * Whether this deposit may still be edited.
 *
 * 🛑 A deposit matched to a bank line must NOT be editable - the same rule the
 * movement ledger keeps. Correct by reversing and regrouping, never by editing,
 * or a reconciled month silently changes underneath the person who signed it off.
 */
export function isBankDepositFrozen(deposit: {
  status: BankDepositStatus
  bankTransactionId: string | null
}): boolean {
  return deposit.status === 'cleared' || deposit.bankTransactionId != null
}

/** Group rows by their `YYYY-MM-DD` date, newest day first - the left list's sections. */
export function groupByDay<T extends { date: string | null; amountMinor: number }>(
  rows: T[]
): Array<{ day: string; rows: T[]; totalMinor: number }> {
  const byDay = new Map<string, T[]>()
  for (const row of rows) {
    const day = row.date ?? 'unknown'
    const bucket = byDay.get(day)
    if (bucket) bucket.push(row)
    else byDay.set(day, [row])
  }
  return [...byDay.entries()]
    .sort((a, b) => (a[0] < b[0] ? 1 : a[0] > b[0] ? -1 : 0))
    .map(([day, dayRows]) => ({
      day,
      rows: dayRows,
      totalMinor: dayRows.reduce((sum, row) => sum + row.amountMinor, 0),
    }))
}
