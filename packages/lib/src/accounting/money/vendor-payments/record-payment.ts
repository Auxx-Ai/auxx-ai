// packages/lib/src/accounting/money/vendor-payments/record-payment.ts

/**
 * Paying a vendor bill, on the money model — `invoice-payments/record-payment.ts`
 * with the sides flipped.
 *
 * ```
 *   MoneyCommand      the idempotency key and who pressed the button
 *   MoneyTransaction  the money itself — purpose `vendor_payment`
 *   MoneyApplication  what it settled — this vendor bill
 * ```
 *
 * The one rule about where the money went: it names a rail, a bank account, or
 * neither. The bill's `amount_paid` / `paid_at` / `payment_status` are a
 * projection of the applications, never hand-written (task 71 D7, 73 D1).
 */

import { type Database, schema, type Transaction } from '@auxx/database'
import { and, eq, isNull } from 'drizzle-orm'
import { requireCachedEntityDefId } from '../../../cache'
import { BadRequestError, UnprocessableEntityError } from '../../../errors'
import { readFieldScalars } from '../../../field-values/read-field-scalars'
import { systemFieldMap } from '../../../resources/system-records'
import { listVendorBillPostings } from '../../purchasing/expense-bill/writes'
import type { PaymentMethod } from '../client'
import { insertMovement } from '../commands/insert-movement'
import { runMoneyCommand } from '../commands/run-money-command'
import { sumAppliedToVendorBill } from '../reads'
import { insertApplication } from '../writes'
import { syncVendorBillPaymentState } from './payment-state'

export interface RecordVendorPaymentInput {
  organizationId: string
  userId: string
  /** `EntityInstance` id of the vendor bill, not the `RecordId`. */
  vendorBillInstanceId: string
  /** Integer minor units. Must be positive and within the bill's balance. */
  amountMinor: number
  /**
   * The early-payment discount the vendor granted alongside this money, integer
   * minor units (74 D3). Never computed from terms — the remittance is the
   * truth. `money + discount` is what the cap is read against.
   */
  discountMinor?: number
  /** `YYYY-MM-DD`, the day the money left. May be backdated. */
  date: string
  method: PaymentMethod
  /** The `payment_gateway` the money went out through. Exclusive with the bank account. */
  paymentGatewayId?: string | null
  /** The `bank_account` record the money left. Exclusive with the gateway. */
  bankAccountInstanceId?: string | null
  reference?: string | null
  note?: string | null
  /** The idempotency key. A double-submitted dialog returns the first run's ids. */
  commandKey: string
}

export interface RecordVendorPaymentResult extends Record<string, string> {
  moneyTransactionId: string
  moneyApplicationId: string
}

/** The bill, its vendor, and what it still owed before this payment. */
async function readVendorBillBalance(
  tx: Transaction,
  organizationId: string,
  vendorBillInstanceId: string
) {
  // 🛑 Through `EntityDefinition.entityType`, never the bare instance id: an
  // application against a record that is not a bill would relieve a payable no
  // vendor ever raised.
  const billDefId = await requireCachedEntityDefId(organizationId, 'vendor_bill')
  const [bill] = await tx
    .select({ id: schema.EntityInstance.id })
    .from(schema.EntityInstance)
    .where(
      and(
        eq(schema.EntityInstance.organizationId, organizationId),
        eq(schema.EntityInstance.entityDefinitionId, billDefId),
        eq(schema.EntityInstance.id, vendorBillInstanceId),
        isNull(schema.EntityInstance.archivedAt)
      )
    )
    .limit(1)
  if (!bill) throw new UnprocessableEntityError('That vendor bill does not exist')

  // 🛑 The gate is the LEDGER, not a status (73 D1). A payment relieves the A/P
  // credit the bill's own entry raised, so a bill with no live posting has no
  // payable to relieve — whatever its lifecycle says. A `matched` PO bill posted
  // by the match hook is payable; an `awaiting_receipt` prepaid bill is not,
  // until somebody posts it.
  const postings = await listVendorBillPostings(tx as unknown as Database, {
    organizationId,
    vendorBillInstanceId,
  })
  // `posted`, never "a row exists": a DRAFT waiting in the outbox holds no
  // claim and no balance, so there is nothing yet to relieve.
  if (!postings.some((posting) => posting.status === 'posted'))
    throw new UnprocessableEntityError(
      postings.some((posting) => posting.status === 'draft')
        ? "This vendor bill's entry is waiting for approval in the outbox, so there is no " +
            'payable to pay yet. Approve it first.'
        : 'This vendor bill is not in the books yet, so there is no payable to pay. Post it first.'
    )

  const fields = await systemFieldMap(tx, organizationId, [
    'vendor_bill_total',
    'vendor_bill_vendor',
  ] as const)
  const totalField = fields.vendor_bill_total
  const vendorField = fields.vendor_bill_vendor
  if (!totalField)
    throw new UnprocessableEntityError('Vendor bill payment fields are not provisioned')

  const [totals, vendorRow] = await Promise.all([
    readFieldScalars(
      tx as unknown as Database,
      organizationId,
      [vendorBillInstanceId],
      [totalField.id]
    ),
    vendorField
      ? tx
          .select({ relatedEntityId: schema.FieldValue.relatedEntityId })
          .from(schema.FieldValue)
          .where(
            and(
              eq(schema.FieldValue.organizationId, organizationId),
              eq(schema.FieldValue.entityId, vendorBillInstanceId),
              eq(schema.FieldValue.fieldId, vendorField.id)
            )
          )
          .limit(1)
      : Promise.resolve([]),
  ])
  const scalars = totals.get(vendorBillInstanceId)
  const total = scalars?.get(totalField.id)
  if (typeof total !== 'number' || total <= 0)
    throw new UnprocessableEntityError('That vendor bill has no total to pay against')

  const settled = await sumAppliedToVendorBill(tx, organizationId, vendorBillInstanceId)
  return {
    outstandingMinor: BigInt(Math.round(total)) - (settled.amountMinor + settled.discountMinor),
    vendorInstanceId: vendorRow[0]?.relatedEntityId ?? null,
  }
}

/**
 * Record one payment against one vendor bill.
 *
 * Returns the ids of what it wrote. Accounting is NOT posted here — the caller
 * runs `acceptVendorPaymentAccounting` once this has committed, so a ledger that
 * is misconfigured refuses the journal without also refusing to record that the
 * vendor was paid.
 */
export async function recordVendorPayment(
  db: Database,
  input: RecordVendorPaymentInput
): Promise<RecordVendorPaymentResult> {
  const discountMinor = input.discountMinor ?? 0
  // 🛑 Zero money with a discount is refused, not allowed: `MoneyApplication`'s
  // shape check requires `amountMinor > 0` and the payment's own entry balances
  // the applications against the movement, so a bill forgiven in full under
  // terms is a vendor credit, not a payment of nothing.
  if (!Number.isSafeInteger(input.amountMinor) || input.amountMinor <= 0)
    throw new BadRequestError(
      'A payment amount must be a positive whole number of cents. A bill settled entirely by ' +
        'a discount is a vendor credit, not a payment.'
    )
  if (!Number.isSafeInteger(discountMinor) || discountMinor < 0)
    throw new BadRequestError(
      'A discount taken must be a whole number of cents, and never negative'
    )
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date))
    throw new BadRequestError('A payment needs a calendar date')

  const bankAccountInstanceId = input.bankAccountInstanceId?.trim() || null
  const paymentGatewayId = input.paymentGatewayId?.trim() || null

  return runMoneyCommand(
    db,
    {
      organizationId: input.organizationId,
      userId: input.userId,
      commandKey: input.commandKey,
      kind: 'record_vendor_payment',
      payload: {
        vendorBillInstanceId: input.vendorBillInstanceId,
        amountMinor: input.amountMinor,
        discountMinor,
        date: input.date,
        method: input.method,
        paymentGatewayId,
        bankAccountInstanceId,
      },
    },
    async (tx, commandId) => {
      const bill = await readVendorBillBalance(tx, input.organizationId, input.vendorBillInstanceId)
      if (BigInt(input.amountMinor) + BigInt(discountMinor) > bill.outstandingMinor)
        throw new UnprocessableEntityError(
          `${input.amountMinor} cents paid plus ${discountMinor} cents of discount is more than ` +
            `the ${bill.outstandingMinor} cents this bill still owes`
        )

      const money = await insertMovement(tx, input.organizationId, commandId, {
        purpose: 'vendor_payment',
        amountMinor: input.amountMinor,
        when: { date: input.date },
        partyInstanceId: bill.vendorInstanceId,
        endpoint: {
          paymentGatewayId,
          cashAccountInstanceId: bankAccountInstanceId,
          currency: 'USD',
        },
        method: input.method,
        reference: input.reference,
        note: input.note,
      })

      const application = await insertApplication(tx, input.organizationId, commandId, {
        moneyTransactionId: money.id,
        operation: 'apply',
        amountMinor: input.amountMinor,
        discountMinor,
        vendorBillInstanceId: input.vendorBillInstanceId,
        effectiveDate: input.date,
        commandItemKey: 'vendor_bill_payment',
      })

      await syncVendorBillPaymentState(tx as unknown as Database, {
        organizationId: input.organizationId,
        userId: input.userId,
        vendorBillInstanceId: input.vendorBillInstanceId,
      })

      return { moneyTransactionId: money.id, moneyApplicationId: application.id }
    }
  )
}
