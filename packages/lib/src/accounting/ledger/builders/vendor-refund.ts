// packages/lib/src/accounting/ledger/builders/vendor-refund.ts

/**
 * The vendor refund entry, as lines — `refund.ts` with the sides flipped.
 *
 * ```
 *   Dr <the endpoint the money arrived in>           the movement total
 *       Cr <each vendor credit's control account>      its settled slice
 * ```
 *
 * PURE. The caller resolves the control account each settlement credits (the
 * account its credit debited, which is `accounts_payable`) and the endpoint the
 * money arrived in.
 */

import { UnprocessableEntityError } from '../../../errors'
import type { BuiltEntry, GlPostingLineInput } from '../types'
import { type AccountRole, buildEntry } from './entry'
import { movementPeriodKey } from './movement-key'
import { REFUND_SOURCE_TYPE } from './refund'

/** TARGET §5: a supplier's refund is its own type, so its avenue is the vendor's. */
export const VENDOR_REFUND_POSTING_TYPE = 'vendor_refund' as const

/** One vendor credit's slice of a refund, already resolved to its control account. */
export interface VendorRefundSettlementLine {
  /** `MoneyRefundSettlement.id`. Carried as a dimension so the slice is traceable. */
  settlementId: string
  /** The `vendor_credit` EntityInstance the slice draws down. */
  vendorCreditInstanceId: string
  /** The account that credit debited, which this credits back. */
  creditControlGlAccountId: string
  /** Integer minor units, > 0. */
  amountMinor: number
}

export interface BuildVendorRefundEntryInput {
  /** The `MoneyTransaction`. Every line's `sourceId`, and the period key. */
  moneyTransactionId: string
  /** `YYYY-MM-DD`. The day the money arrived. */
  txnDate: string
  settlements: VendorRefundSettlementLine[]
  /** The `gl_account` the money arrived in. Resolved by the caller, never a role. */
  endpointGlAccountId: string
  /** The role that account holds (`resolveCashEndpoint`), stamped on the endpoint line as a snapshot. */
  endpointRole: AccountRole
  endpointDimensions?: Record<string, string>
  /** The `company` the refund came from, on every control leg. */
  vendorInstanceId: string
  memo?: string
}

export interface BuiltVendorRefundEntry {
  entry: BuiltEntry
  periodKey: string
  /** The sum of the settlement slices, which is what arrived in the endpoint. */
  totalMinor: number
}

/**
 * Build the vendor refund entry for one movement.
 *
 * @throws {UnprocessableEntityError} on a blank movement id or endpoint, an
 *   empty settlement list, or a slice that is not a positive whole number of
 *   minor units.
 */
export function buildVendorRefundEntry(input: BuildVendorRefundEntryInput): BuiltVendorRefundEntry {
  const moneyTransactionId = input.moneyTransactionId.trim()
  if (!moneyTransactionId)
    throw new UnprocessableEntityError('A vendor refund entry needs the movement it books')
  if (!input.endpointGlAccountId.trim())
    throw new UnprocessableEntityError(
      'A vendor refund entry needs the account the money arrived in',
      { moneyTransactionId }
    )
  if (input.settlements.length === 0)
    throw new UnprocessableEntityError(
      'A vendor refund entry needs at least one settlement slice',
      { moneyTransactionId }
    )

  const memo = input.memo ?? 'Vendor credit refund'
  const creditLines: GlPostingLineInput[] = []
  let totalMinor = 0
  for (const settlement of input.settlements) {
    const { amountMinor } = settlement
    if (!Number.isSafeInteger(amountMinor) || amountMinor <= 0)
      throw new UnprocessableEntityError(
        `Vendor refund settlement ${settlement.settlementId} is ${String(amountMinor)}. A refund ` +
          'moves a positive whole number of minor units.',
        { moneyTransactionId, settlementId: settlement.settlementId }
      )
    totalMinor += amountMinor
    creditLines.push({
      sourceType: REFUND_SOURCE_TYPE,
      sourceId: moneyTransactionId,
      glAccountId: settlement.creditControlGlAccountId,
      direction: 'credit',
      amount: amountMinor,
      counterpartyType: 'vendor',
      counterpartyId: input.vendorInstanceId,
      dimensions: {
        vendorCreditInstanceId: settlement.vendorCreditInstanceId,
        settlementId: settlement.settlementId,
      },
      memo,
      sortOrder: 0,
    })
  }

  // The endpoint debit first, so the entry reads money-in then what it relieved.
  const lines: GlPostingLineInput[] = [
    {
      sourceType: REFUND_SOURCE_TYPE,
      sourceId: moneyTransactionId,
      glAccountId: input.endpointGlAccountId,
      accountRole: input.endpointRole,
      direction: 'debit',
      amount: totalMinor,
      ...(input.endpointDimensions ? { dimensions: input.endpointDimensions } : {}),
      memo,
      sortOrder: 0,
    },
    ...creditLines.map((line, index) => ({ ...line, sortOrder: index + 1 })),
  ]

  // The same key shape the customer refund uses: one entry per movement falls
  // out of the claim index, and a reversal is that key at `-R1`.
  const periodKey = movementPeriodKey(VENDOR_REFUND_POSTING_TYPE, moneyTransactionId)
  return {
    entry: buildEntry({
      postingType: VENDOR_REFUND_POSTING_TYPE,
      periodKey,
      txnDate: input.txnDate,
      lines,
    }),
    periodKey,
    totalMinor,
  }
}
