// packages/lib/src/accounting/money/vendor-payments/refund-accounting.ts

/**
 * A vendor refund: vendor credits drawn down, money in.
 *
 * ```
 *   Dr <the cash endpoint the money arrived in>
 *       Cr <each credit's control account>   its settled slice
 * ```
 *
 * Subject the `MoneyTransaction`, parent the bill the credits name, counterparty
 * the supplier. The lines are `ledger/builders/vendor-refund.ts`, which is pure.
 *
 * 🛑 **Each slice returns the credit to the account its credit actually
 * debited**, read off that credit's posted lines rather than re-resolved
 * through the chart. The ENDPOINT is the opposite — a refund is a forward event
 * and resolves its own rail or bank account at refund time (D5).
 *
 * No permission checks here. The router asserts (docs/lib-module-guide.md §6).
 */

import { type Database, schema, type Transaction } from '@auxx/database'
import { and, asc, eq } from 'drizzle-orm'
import { ConflictError, UnprocessableEntityError } from '../../../errors'
import { toLedgerMinor } from '../../ledger/builders/basis-hash'
import {
  buildVendorRefundEntry,
  type VendorRefundSettlementLine,
} from '../../ledger/builders/vendor-refund'
import { readVendorCreditControlAccount } from '../../purchasing/vendor-credit/accounting'
import { loadVendorCredit } from '../../purchasing/vendor-credit/reads'
import { type MovementPostingResult, postMovementEntry } from '../post-movement'
import { listRefundSettlements } from '../reads'

export interface VendorRefundAccountingInput {
  organizationId: string
  moneyTransactionId: string
  actorUserId?: string
}

export type VendorRefundAccountingResult = MovementPostingResult

type Settlement = {
  id: string
  amountMinor: bigint
  disposition: 'customer_credit' | 'vendor_credit' | 'unapplied_money'
  vendorCreditInstanceId: string | null
}

/** One vendor credit's slice, with the control account its issue entry debited. */
async function readCreditControl(
  db: Database | Transaction,
  organizationId: string,
  vendorCreditInstanceId: string
): Promise<{ glAccountId: string; vendorInstanceId: string | null; txnDate: string }> {
  const control = await readVendorCreditControlAccount(db as Database, {
    organizationId,
    vendorCreditInstanceId,
  })
  if (!control)
    throw new UnprocessableEntityError('Refund requires a posted vendor credit to draw down')

  const credit = await loadVendorCredit(db as Database, organizationId, vendorCreditInstanceId)
  if (!credit || !Number.isSafeInteger(credit.totalMinor) || credit.totalMinor < 0)
    throw new ConflictError('Vendor credit total is outside the supported amount range')

  return {
    glAccountId: control.glAccountId,
    vendorInstanceId: credit.vendorCompanyInstanceId,
    txnDate: control.txnDate,
  }
}

/**
 * Post one vendor refund.
 *
 * A refusal is a `blocked` result rather than a throw: the money has already
 * moved, and the caller records that whether or not the books accepted it.
 */
export async function postVendorRefundAccounting(
  db: Database,
  input: VendorRefundAccountingInput
): Promise<VendorRefundAccountingResult> {
  return postMovementEntry(db, {
    organizationId: input.organizationId,
    moneyTransactionId: input.moneyTransactionId,
    purpose: 'vendor_refund',
    avenue: 'refund',
    label: 'Vendor refund',
    actorUserId: input.actorUserId,
    prepare: async (tx, loaded) => {
      const money = loaded.money
      const settlements = (await listRefundSettlements(tx, input.organizationId, {
        refundTransactionId: money.id,
      })) as Settlement[]
      if (!settlements.length)
        throw new UnprocessableEntityError('Refund has no settlement partition')
      if (settlements.some((s) => s.disposition !== 'vendor_credit' || !s.vendorCreditInstanceId))
        throw new UnprocessableEntityError('Only vendor-credit refund dispositions are supported')
      const total = settlements.reduce((sum, s) => sum + s.amountMinor, 0n)
      if (total !== money.amountMinor)
        throw new ConflictError('Refund settlement partitions do not equal the movement amount')

      const vendorInstanceId = money.partyInstanceId
      if (!vendorInstanceId)
        throw new UnprocessableEntityError('Refund requires the vendor it came back from')

      const lines: VendorRefundSettlementLine[] = []
      for (const settlement of settlements) {
        const creditId = settlement.vendorCreditInstanceId!
        const control = await readCreditControl(tx, input.organizationId, creditId)
        if (control.vendorInstanceId !== vendorInstanceId)
          throw new UnprocessableEntityError(
            'Refund requires the vendor party to match every vendor credit'
          )
        // A refund may not precede the credit it draws down.
        if (control.txnDate > loaded.effectiveDate)
          throw new ConflictError('Refund date precedes the vendor credit it draws down')
        lines.push({
          settlementId: settlement.id,
          vendorCreditInstanceId: creditId,
          creditControlGlAccountId: control.glAccountId,
          amountMinor: toLedgerMinor(settlement.amountMinor, 'USD', 2),
        })
      }

      const endpoint = await loaded.endpoint()
      const endpointDimensions = {
        ...(money.method ? { refundMethod: money.method } : {}),
        ...(endpoint.railId ? { paymentGatewayId: endpoint.railId } : {}),
      }
      const built = buildVendorRefundEntry({
        moneyTransactionId: money.id,
        txnDate: loaded.effectiveDate,
        settlements: lines,
        endpointGlAccountId: endpoint.glAccountId,
        ...(Object.keys(endpointDimensions).length ? { endpointDimensions } : {}),
        vendorInstanceId,
      })

      // The parent is the bill the credits name, when they agree on one. A
      // refund spanning two bills has no single parent and carries none.
      const credits = await Promise.all(
        lines.map((line) =>
          loadVendorCredit(
            tx as unknown as Database,
            input.organizationId,
            line.vendorCreditInstanceId
          )
        )
      )
      const parents = [...new Set(credits.map((credit) => credit?.vendorBillInstanceId ?? null))]
      const parentId = parents.length === 1 ? parents[0] : null

      return {
        lines: built.entry.lines,
        ...(parentId ? { parent: { sourceKind: 'vendor_bill', sourceId: parentId } } : {}),
        counterparty: { sourceKind: 'company', sourceId: vendorInstanceId },
      }
    },
  })
}
