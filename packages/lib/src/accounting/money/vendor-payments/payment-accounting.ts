// packages/lib/src/accounting/money/vendor-payments/payment-accounting.ts

/**
 * A vendor bill paid.
 *
 * ```
 *   Dr accounts_payable (counterparty: the vendor)
 *       Cr <the cash endpoint: a rail's clearing, a bank account, or undeposited funds>
 * ```
 *
 * The invoice receipt's entry with both sides flipped, and the same `payment`
 * posting type (TARGET §5 names one type for both directions).
 *
 * No permission checks here. The router asserts (docs/lib-module-guide.md §6).
 */

import { type Database, schema, type Transaction } from '@auxx/database'
import { and, asc, eq } from 'drizzle-orm'
import { UnprocessableEntityError } from '../../../errors'
import { toLedgerMinor } from '../../ledger/builders/basis-hash'
import { ACCOUNT_ROLES } from '../../ledger/builders/entry'
import type { GlPostingLineInput } from '../../ledger/types'
import {
  type LoadedMovement,
  type MovementPostingResult,
  type PreparedMovement,
  postMovementEntry,
} from '../post-movement'

export interface AcceptVendorPaymentInput {
  organizationId: string
  /** The `MoneyTransaction` to post. Must be a `vendor_payment`. */
  moneyTransactionId: string
  actorUserId?: string
}

/** The single bill the movement's applications name. */
async function readVendorPaymentSource(
  tx: Transaction,
  organizationId: string,
  money: typeof schema.MoneyTransaction.$inferSelect
) {
  const applications = await tx.query.MoneyApplication.findMany({
    where: and(
      eq(schema.MoneyApplication.organizationId, organizationId),
      eq(schema.MoneyApplication.moneyTransactionId, money.id)
    ),
    orderBy: asc(schema.MoneyApplication.id),
  })
  const vendorBillInstanceId = applications[0]?.vendorBillInstanceId
  if (
    !vendorBillInstanceId ||
    applications.some(
      (a) => a.operation !== 'apply' || a.vendorBillInstanceId !== vendorBillInstanceId
    ) ||
    applications.reduce((sum, a) => sum + a.amountMinor, 0n) !== money.amountMinor
  )
    throw new UnprocessableEntityError(
      'Vendor payment needs complete applications to one bill; unapplications require correction'
    )
  return { vendorBillInstanceId }
}

async function prepareVendorPayment(
  tx: Transaction,
  organizationId: string,
  loaded: LoadedMovement
): Promise<PreparedMovement> {
  const source = await readVendorPaymentSource(tx, organizationId, loaded.money)
  const endpoint = await loaded.endpoint()
  const amountMinor = toLedgerMinor(loaded.money.amountMinor, 'USD', 2)
  const memo = 'Vendor bill paid'
  const lines: GlPostingLineInput[] = [
    {
      ...loaded.base,
      accountRole: ACCOUNT_ROLES.ACCOUNTS_PAYABLE,
      direction: 'debit',
      amount: amountMinor,
      sortOrder: 0,
      memo,
    },
    {
      sourceType: loaded.base.sourceType,
      sourceId: loaded.base.sourceId,
      glAccountId: endpoint.glAccountId,
      direction: 'credit',
      amount: amountMinor,
      sortOrder: 1,
      memo,
    },
  ]
  return { lines, parent: { sourceKind: 'vendor_bill', sourceId: source.vendorBillInstanceId } }
}

/**
 * Post one vendor payment.
 *
 * **Never throws.** Every refusal comes back as a `blocked` result: paying a
 * vendor must not fail because its bookkeeping did.
 */
export async function acceptVendorPaymentAccounting(
  db: Database,
  input: AcceptVendorPaymentInput
): Promise<MovementPostingResult> {
  return postMovementEntry(db, {
    organizationId: input.organizationId,
    moneyTransactionId: input.moneyTransactionId,
    purpose: 'vendor_payment',
    // Money out on a `payment` entry, so it shares the receipt avenue's
    // auto-post switch; TARGET §5 names one `payment` type for both directions.
    avenue: 'receipt',
    label: 'Vendor payment',
    actorUserId: input.actorUserId,
    prepare: (tx, loaded) => prepareVendorPayment(tx, input.organizationId, loaded),
  })
}
