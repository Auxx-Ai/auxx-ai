// packages/lib/src/sales/credit-memos/card-refund.ts

/**
 * Giving a card-paid credit memo's balance back through Stripe Connect.
 *
 * The card sibling of `record-refund.ts`, which records a refund paid by hand.
 * Both end in the same two rows - a `customer_refund` `MoneyTransaction` and the
 * `MoneyRefundSettlement` naming the memo - and both post through
 * `postCustomerRefundAccounting`.
 *
 * No permission checks here. The router asserts (docs/lib-module-guide.md §6).
 */

import { type Database, schema } from '@auxx/database'
import { and, eq, inArray } from 'drizzle-orm'
import { runMoneyCommand } from '../../accounting/money/commands/run-money-command'
import { postCustomerRefundAccounting } from '../../accounting/money/customer-money/refund-accounting'
import { getPaymentAccount } from '../../accounting/money/stripe-connect/account'
import { getStripeConnectClient } from '../../accounting/money/stripe-connect/client'
import { BadRequestError, NotFoundError, UnprocessableEntityError } from '../../errors'
import { readCreditMemoForRefund } from './reads'
import { settleCreditMemo } from './settle'

export interface RefundCreditMemoToCardInput {
  organizationId: string
  userId: string
  /** `EntityInstance` id of the `issued` memo this refund settles. */
  creditMemoInstanceId: string
  /** Integer minor units. Must be positive and within the memo's balance. */
  amountMinor: number
  /**
   * The `MoneyTransaction` to refund - a card receipt carrying its Stripe
   * payment intent in `reference`. Absent picks the memo's invoice's newest
   * card receipt with room left on it.
   */
  moneyTransactionId?: string
  /** The idempotency key. Also the Stripe idempotency key - see the body. */
  commandKey: string
}

export interface RefundCreditMemoToCardResult extends Record<string, string> {
  moneyTransactionId: string
  moneySettlementId: string
  stripeRefundId: string
}

/** Card receipts against a memo's invoice with refundable room left, newest first. */
async function readRefundableCardReceipts(
  db: Database,
  organizationId: string,
  invoiceInstanceId: string
) {
  const applications = await db.query.MoneyApplication.findMany({
    where: and(
      eq(schema.MoneyApplication.organizationId, organizationId),
      eq(schema.MoneyApplication.invoiceInstanceId, invoiceInstanceId),
      eq(schema.MoneyApplication.operation, 'apply')
    ),
  })
  if (applications.length === 0) return []
  const receipts = await db.query.MoneyTransaction.findMany({
    where: and(
      eq(schema.MoneyTransaction.organizationId, organizationId),
      eq(schema.MoneyTransaction.purpose, 'customer_receipt'),
      inArray(
        schema.MoneyTransaction.id,
        applications.map((row) => row.moneyTransactionId)
      )
    ),
  })
  const settlements = await db.query.MoneyRefundSettlement.findMany({
    where: and(
      eq(schema.MoneyRefundSettlement.organizationId, organizationId),
      inArray(
        schema.MoneyRefundSettlement.originalTransactionId,
        receipts.map((row) => row.id)
      )
    ),
  })
  const usedById = new Map<string, bigint>()
  for (const row of settlements)
    usedById.set(
      row.originalTransactionId!,
      (usedById.get(row.originalTransactionId!) ?? 0n) + row.amountMinor
    )
  return receipts
    .filter((row) => row.method === 'card' && !!row.reference)
    .map((row) => ({
      id: row.id,
      reference: row.reference!,
      partyInstanceId: row.partyInstanceId,
      refundableMinor: Number(row.amountMinor - (usedById.get(row.id) ?? 0n)),
      occurredAt: row.occurredAt?.getTime() ?? 0,
    }))
    .filter((row) => row.refundableMinor > 0)
    .sort((a, b) => b.occurredAt - a.occurredAt)
}

/**
 * Give a card-paid credit memo's balance back through Stripe.
 *
 * 🛑 **Stripe is called BEFORE the money is recorded, and the order matters.**
 * A `MoneyTransaction` has no pending state, so a row written first and a
 * refund that then fails would be a refund the books claim and the customer
 * never received. Calling Stripe first inverts the risk into the safe
 * direction, and `commandKey` is passed as Stripe's own idempotency key: a
 * retry after a crash between the two returns the SAME refund rather than
 * issuing a second one, and then records it.
 *
 * The refund settles the MEMO, so no `MoneyApplication` is written - the invoice
 * the original charge paid stays exactly as paid as it was (`record-refund.ts`).
 */
export async function refundCreditMemoToCard(
  db: Database,
  input: RefundCreditMemoToCardInput
): Promise<RefundCreditMemoToCardResult> {
  if (!Number.isSafeInteger(input.amountMinor) || input.amountMinor <= 0)
    throw new BadRequestError('A refund amount must be a positive whole number of cents')

  const memo = await readCreditMemoForRefund({
    organizationId: input.organizationId,
    userId: input.userId,
    creditMemoInstanceId: input.creditMemoInstanceId,
    amount: input.amountMinor,
    db,
  })
  if (!memo.invoiceInstanceId)
    throw new UnprocessableEntityError('This credit memo names no invoice to refund a card on')

  const candidates = await readRefundableCardReceipts(
    db,
    input.organizationId,
    memo.invoiceInstanceId
  )
  const receipt = input.moneyTransactionId
    ? candidates.find((row) => row.id === input.moneyTransactionId)
    : candidates.find((row) => row.refundableMinor >= input.amountMinor)
  if (!receipt)
    throw new UnprocessableEntityError('No card payment on this invoice can be refunded')
  if (receipt.refundableMinor < input.amountMinor)
    throw new UnprocessableEntityError(
      `That card payment has only ${receipt.refundableMinor} cents left to refund`
    )
  if (memo.contactInstanceId && receipt.partyInstanceId !== memo.contactInstanceId)
    throw new BadRequestError('The credit memo belongs to a different contact than this payment')

  const account = await getPaymentAccount(input.organizationId)
  if (!account?.stripeAccountId)
    throw new NotFoundError('No Stripe account is connected for this organization')

  const refund = await getStripeConnectClient().refunds.create(
    {
      payment_intent: receipt.reference,
      amount: input.amountMinor,
      refund_application_fee: true,
    },
    { stripeAccount: account.stripeAccountId, idempotencyKey: input.commandKey }
  )

  const saved = await runMoneyCommand(
    db,
    {
      organizationId: input.organizationId,
      userId: input.userId,
      commandKey: input.commandKey,
      kind: 'refund_credit_memo_to_card',
      payload: {
        creditMemoInstanceId: input.creditMemoInstanceId,
        amountMinor: input.amountMinor,
        originalTransactionId: receipt.id,
      },
      actorContext: { stripeRefundId: refund.id },
    },
    async (tx, commandId) => {
      const [money] = await tx
        .insert(schema.MoneyTransaction)
        .values({
          organizationId: input.organizationId,
          purpose: 'customer_refund',
          amountMinor: BigInt(input.amountMinor),
          currency: 'USD',
          currencyExponent: 2,
          datePrecision: 'instant',
          occurredAt: new Date((refund.created ?? Math.floor(Date.now() / 1000)) * 1000),
          partyInstanceId: memo.contactInstanceId,
          method: 'card',
          recordedByCommandId: commandId,
          reference: refund.id,
        })
        .returning({ id: schema.MoneyTransaction.id })
      if (!money) throw new Error('Money transaction insert returned no row')

      const [settlement] = await tx
        .insert(schema.MoneyRefundSettlement)
        .values({
          organizationId: input.organizationId,
          refundTransactionId: money.id,
          originalTransactionId: receipt.id,
          amountMinor: BigInt(input.amountMinor),
          disposition: 'customer_credit',
          customerCreditMemoInstanceId: input.creditMemoInstanceId,
          commandId,
          commandItemKey: 'credit_memo_card_refund',
        })
        .returning({ id: schema.MoneyRefundSettlement.id })
      if (!settlement) throw new Error('Money refund settlement insert returned no row')

      return { moneyTransactionId: money.id, moneySettlementId: settlement.id }
    }
  )

  await postCustomerRefundAccounting(db, {
    organizationId: input.organizationId,
    moneyTransactionId: saved.moneyTransactionId,
    actorUserId: input.userId,
  })
  await settleCreditMemo(db, {
    organizationId: input.organizationId,
    userId: input.userId,
    creditMemoInstanceId: input.creditMemoInstanceId,
  })

  return { ...saved, stripeRefundId: refund.id }
}
