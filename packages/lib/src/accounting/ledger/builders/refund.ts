// packages/lib/src/accounting/ledger/builders/refund.ts

/**
 * The customer refund entry, as lines.
 *
 * ```
 *   Dr <each credit memo's credit-control account>   its settled slice
 *       Cr <the endpoint the money left by>            the movement total
 * ```
 *
 * PURE: no database, no clock, no settings. The caller resolves the control
 * account each settlement debits (the account its credit memo credited) and the
 * endpoint the money left by (a bank account, undeposited funds, or the
 * original receipt's gateway clearing account), and this turns them into a
 * balanced entry.
 */

import { UnprocessableEntityError } from '../../../errors'
import type { BuiltEntry, GlPostingLineInput } from '../types'
import { buildEntry } from './entry'
import { movementPeriodKey } from './movement-key'

/** The `sourceType` every refund line carries - the movement. */
export const REFUND_SOURCE_TYPE = 'money_transaction'

/** TARGET §5's own type for a refund, distinct from the `payment` it used to borrow. */
export const REFUND_POSTING_TYPE = 'refund' as const

/** One credit memo's slice of a refund, already resolved to its control account. */
export interface RefundSettlementLine {
  /** `MoneyRefundSettlement.id`. Carried as a dimension so the slice is traceable. */
  settlementId: string
  /** The `credit_memo` EntityInstance the slice draws down. */
  creditMemoInstanceId: string
  /** The account that memo credited, which this debits back. */
  creditControlGlAccountId: string
  /** Integer minor units, > 0. */
  amountMinor: number
}

export interface BuildRefundEntryInput {
  /** The `MoneyTransaction`. Every line's `sourceId`, and the period key. */
  moneyTransactionId: string
  /** `YYYY-MM-DD`. The day the money went back. */
  txnDate: string
  settlements: RefundSettlementLine[]
  /** The `gl_account` the money left by. Resolved by the caller, never a role. */
  endpointGlAccountId: string
  /** Reporting dimensions on the endpoint leg - the method, or the gateway. */
  endpointDimensions?: Record<string, string>
  /** The `contact` the refund is attributable to, on every control leg. */
  customerInstanceId: string
  memo?: string
}

export interface BuiltRefundEntry {
  entry: BuiltEntry
  periodKey: string
  /** The sum of the settlement slices, which is what left the endpoint. */
  totalMinor: number
}

/**
 * Build the refund entry for one movement.
 *
 * @throws {UnprocessableEntityError} on a blank movement id or endpoint, an
 *   empty settlement list, or a slice that is not a positive whole number of
 *   minor units.
 */
export function buildRefundEntry(input: BuildRefundEntryInput): BuiltRefundEntry {
  const moneyTransactionId = input.moneyTransactionId.trim()
  if (!moneyTransactionId)
    throw new UnprocessableEntityError('A refund entry needs the movement it books')
  if (!input.endpointGlAccountId.trim())
    throw new UnprocessableEntityError('A refund entry needs the account the money left by', {
      moneyTransactionId,
    })
  if (input.settlements.length === 0)
    throw new UnprocessableEntityError('A refund entry needs at least one settlement slice', {
      moneyTransactionId,
    })

  const memo = input.memo ?? 'Customer credit refund'
  const lines: GlPostingLineInput[] = []
  let totalMinor = 0
  for (const settlement of input.settlements) {
    const { amountMinor } = settlement
    if (!Number.isSafeInteger(amountMinor) || amountMinor <= 0)
      throw new UnprocessableEntityError(
        `Refund settlement ${settlement.settlementId} is ${String(amountMinor)}. A refund moves a ` +
          'positive whole number of minor units.',
        { moneyTransactionId, settlementId: settlement.settlementId }
      )
    totalMinor += amountMinor
    lines.push({
      sourceType: REFUND_SOURCE_TYPE,
      sourceId: moneyTransactionId,
      glAccountId: settlement.creditControlGlAccountId,
      direction: 'debit',
      amount: amountMinor,
      counterpartyType: 'customer',
      counterpartyId: input.customerInstanceId,
      dimensions: {
        creditMemoInstanceId: settlement.creditMemoInstanceId,
        settlementId: settlement.settlementId,
      },
      memo,
      sortOrder: lines.length,
    })
  }

  lines.push({
    sourceType: REFUND_SOURCE_TYPE,
    sourceId: moneyTransactionId,
    glAccountId: input.endpointGlAccountId,
    direction: 'credit',
    amount: totalMinor,
    ...(input.endpointDimensions ? { dimensions: input.endpointDimensions } : {}),
    memo,
    sortOrder: lines.length,
  })

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
