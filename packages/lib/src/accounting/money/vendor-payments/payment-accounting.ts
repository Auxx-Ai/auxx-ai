// packages/lib/src/accounting/money/vendor-payments/payment-accounting.ts

/**
 * A vendor bill paid.
 *
 * ```
 *   Dr accounts_payable (counterparty: the vendor)
 *       Cr <the cash endpoint: a rail's clearing, a bank account, or undeposited funds>
 *       Cr purchase_discounts — only when the payment took an early-payment discount (74 D3)
 * ```
 *
 * The invoice receipt's entry with both sides flipped, and the same `payment`
 * posting type (TARGET §5 names one type for both directions).
 *
 * No permission checks here. The router asserts (docs/lib-module-guide.md §6).
 */

import type { Database, schema, Transaction } from '@auxx/database'
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
import { listMovementApplications } from '../reads'

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
  const applications = await listMovementApplications(tx, organizationId, money.id)
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
  const discountMinor = applications.reduce((sum, a) => sum + (a.discountMinor ?? 0n), 0n)
  return { vendorBillInstanceId, discountMinor }
}

async function prepareVendorPayment(
  tx: Transaction,
  organizationId: string,
  loaded: LoadedMovement
): Promise<PreparedMovement> {
  const source = await readVendorPaymentSource(tx, organizationId, loaded.money)
  const endpoint = await loaded.endpoint()
  const amountMinor = toLedgerMinor(loaded.money.amountMinor, 'USD', 2)
  const discountMinor = toLedgerMinor(source.discountMinor, 'USD', 2)
  const memo = 'Vendor bill paid'
  const lines: GlPostingLineInput[] = [
    {
      ...loaded.base,
      accountRole: ACCOUNT_ROLES.ACCOUNTS_PAYABLE,
      direction: 'debit',
      // The payable is relieved of what the vendor no longer asks for, which is
      // the money plus whatever the discount forgave (74 D3).
      amount: amountMinor + discountMinor,
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
  // A zero discount posts no line at all: a zero-amount leg is noise in the
  // journal and would make every payment read as if terms were taken.
  if (discountMinor > 0)
    lines.push({
      sourceType: loaded.base.sourceType,
      sourceId: loaded.base.sourceId,
      accountRole: ACCOUNT_ROLES.PURCHASE_DISCOUNTS,
      direction: 'credit',
      amount: discountMinor,
      sortOrder: 2,
      memo: 'Early-payment discount taken',
    })
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
