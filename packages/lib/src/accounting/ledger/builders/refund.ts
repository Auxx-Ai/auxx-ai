// packages/lib/src/accounting/ledger/builders/refund.ts

/**
 * The customer refund entry, as lines: money against A/R, whatever it settles (91 D4).
 *
 * ```
 *   Dr accounts_receivable                 the movement amount
 *       Cr <the endpoint the money left by>  the movement amount
 * ```
 *
 * PURE: no database, no clock, no settings. The caller resolves the endpoint; the
 * receivable is a role, resolved on the entry's own store scope.
 */

import { UnprocessableEntityError } from '../../../errors'
import type { BuiltEntry, GlPostingLineInput } from '../types'
import { ACCOUNT_ROLES, buildEntry } from './entry'
import { movementPeriodKey } from './movement-key'
import { sourceFactsMemo } from './source-facts-memo'

/** The `sourceType` every refund line carries - the movement. */
export const REFUND_SOURCE_TYPE = 'money_transaction'

/** TARGET §5's own type for a refund, distinct from the `payment` it used to borrow. */
export const REFUND_POSTING_TYPE = 'refund' as const

export interface BuildRefundEntryInput {
  /** The `MoneyTransaction`. Every line's `sourceId`, and the period key. */
  moneyTransactionId: string
  /** `YYYY-MM-DD`. The day the money went back. */
  txnDate: string
  /** Integer minor units, > 0. */
  amountMinor: number
  /** The `gl_account` the money left by. Resolved by the caller, never a role. */
  endpointGlAccountId: string
  /** Reporting dimensions on the endpoint leg - the method, or the gateway. */
  endpointDimensions?: Record<string, string>
  /** The `contact` the refund is attributable to, on the receivable leg. */
  customerInstanceId: string
  /** `MoneyRefundSettlement.id`, on the receivable leg when the caller has exactly one. */
  settlementId?: string
  memo?: string
}

export interface BuiltRefundEntry {
  entry: BuiltEntry
  periodKey: string
  /** What left the endpoint. */
  totalMinor: number
}

/**
 * Build the refund entry for one movement.
 *
 * @throws {UnprocessableEntityError} on a blank movement id or endpoint, or an
 *   amount that is not a positive whole number of minor units.
 */
export function buildRefundEntry(input: BuildRefundEntryInput): BuiltRefundEntry {
  const moneyTransactionId = input.moneyTransactionId.trim()
  if (!moneyTransactionId)
    throw new UnprocessableEntityError('A refund entry needs the movement it books')
  if (!input.endpointGlAccountId.trim())
    throw new UnprocessableEntityError('A refund entry needs the account the money left by', {
      moneyTransactionId,
    })
  const totalMinor = input.amountMinor
  if (!Number.isSafeInteger(totalMinor) || totalMinor <= 0)
    throw new UnprocessableEntityError(
      `Refund ${moneyTransactionId} is ${String(totalMinor)}. A refund moves a positive whole ` +
        'number of minor units.',
      { moneyTransactionId }
    )

  const memo =
    input.memo ?? sourceFactsMemo({ transactionId: moneyTransactionId }, 'Customer refund')
  const lines: GlPostingLineInput[] = [
    {
      sourceType: REFUND_SOURCE_TYPE,
      sourceId: moneyTransactionId,
      accountRole: ACCOUNT_ROLES.ACCOUNTS_RECEIVABLE,
      direction: 'debit',
      amount: totalMinor,
      counterpartyType: 'customer',
      counterpartyId: input.customerInstanceId,
      ...(input.settlementId ? { dimensions: { settlementId: input.settlementId } } : {}),
      memo,
      sortOrder: 0,
    },
    {
      sourceType: REFUND_SOURCE_TYPE,
      sourceId: moneyTransactionId,
      glAccountId: input.endpointGlAccountId,
      direction: 'credit',
      amount: totalMinor,
      ...(input.endpointDimensions ? { dimensions: input.endpointDimensions } : {}),
      memo,
      sortOrder: 1,
    },
  ]

  const periodKey = movementPeriodKey(REFUND_POSTING_TYPE, moneyTransactionId)
  return {
    entry: buildEntry({
      postingType: REFUND_POSTING_TYPE,
      periodKey,
      txnDate: input.txnDate,
      lines,
    }),
    periodKey,
    totalMinor,
  }
}
