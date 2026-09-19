// packages/lib/src/sales/credit-memos/record-refund.ts

/**
 * Recording a manual refund of an issued credit memo, on the money model
 * (plans/accounting/tasks/64-what-58-left-behind.md §2 U2).
 *
 * The replacement for `payments/ledger.ts`'s `recordManualRefund`, which wrote a
 * `PaymentTransaction` and posted through `syncTransaction`. This writes the
 * three rows that model the same fact durably, the mirror of
 * `invoices/record-payment.ts` with the sign flipped:
 *
 * ```
 *   MoneyCommand           the idempotency key and who pressed the button
 *   MoneyTransaction       the money itself — purpose `customer_refund`
 *   MoneyRefundSettlement  what it settled — this credit memo
 * ```
 *
 * 🛑 A refund settles the MEMO, not an invoice, so no `MoneyApplication` is
 * written: an application is what relieves an invoice's receivable, and an
 * unapplied memo may be refunded with its invoice still at full balance.
 *
 * The endpoint is the receipt's choice reversed: a rail, a bank account, or
 * neither. `refund-accounting.ts` resolves the same three shapes at post time.
 *
 * @see docs/lib-module-guide.md
 */

import { type Database, schema } from '@auxx/database'
import type { PaymentMethod } from '../../accounting/money/client'
import { insertMovement } from '../../accounting/money/commands/insert-movement'
import { runMoneyCommand } from '../../accounting/money/commands/run-money-command'
import { BadRequestError } from '../../errors'
import { readCreditMemoForRefund } from './reads'

export interface RecordCreditMemoRefundInput {
  organizationId: string
  userId: string
  /** `EntityInstance` id of the `issued` credit memo this refund settles, not the `RecordId`. */
  creditMemoInstanceId: string
  /** Integer minor units. Must be positive and within the memo's balance. */
  amountMinor: number
  /** `YYYY-MM-DD`, the day the money went back. May be backdated. */
  date: string
  method: PaymentMethod
  /** The `payment_gateway` the money went back through, when it went through one. */
  paymentGatewayId?: string | null
  /** The `bank_account` record the money left. Exclusive with the gateway. */
  bankAccountInstanceId?: string | null
  reference?: string
  note?: string
  /** The idempotency key. A double-submitted dialog returns the first run's ids. */
  commandKey: string
}

export interface RecordCreditMemoRefundResult extends Record<string, string> {
  moneyTransactionId: string
  moneySettlementId: string
}

/**
 * Record one manual refund against one issued credit memo.
 *
 * Returns the ids of what it wrote. Accounting is NOT posted here — the caller
 * runs `postCustomerRefundAccounting` once this has committed, so a ledger that
 * is misconfigured refuses the journal without also refusing to record that the
 * customer got their money back.
 */
export async function recordCreditMemoRefund(
  db: Database,
  input: RecordCreditMemoRefundInput
): Promise<RecordCreditMemoRefundResult> {
  if (!Number.isSafeInteger(input.amountMinor) || input.amountMinor <= 0)
    throw new BadRequestError('A refund amount must be a positive whole number of cents')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date))
    throw new BadRequestError('A refund needs a calendar date')

  const bankAccountInstanceId = input.bankAccountInstanceId?.trim() || null
  const paymentGatewayId = input.paymentGatewayId?.trim() || null

  return runMoneyCommand(
    db,
    {
      organizationId: input.organizationId,
      userId: input.userId,
      commandKey: input.commandKey,
      kind: 'record_credit_memo_refund',
      payload: {
        creditMemoInstanceId: input.creditMemoInstanceId,
        amountMinor: input.amountMinor,
        date: input.date,
        method: input.method,
        paymentGatewayId,
        bankAccountInstanceId,
      },
    },
    async (tx, commandId) => {
      // Under the shared money lock `runMoneyCommand` holds, so the capacity
      // this checks cannot be consumed by a concurrent refund between the check
      // and the settlement insert.
      const memo = await readCreditMemoForRefund({
        organizationId: input.organizationId,
        userId: input.userId,
        creditMemoInstanceId: input.creditMemoInstanceId,
        amount: input.amountMinor,
        db: tx as unknown as Database,
      })

      const money = await insertMovement(tx, input.organizationId, commandId, {
        purpose: 'customer_refund',
        amountMinor: input.amountMinor,
        when: { date: input.date },
        partyInstanceId: memo.contactInstanceId,
        endpoint: {
          paymentGatewayId,
          cashAccountInstanceId: bankAccountInstanceId,
          currency: 'USD',
        },
        method: input.method,
        reference: input.reference,
        note: input.note,
      })

      const [settlement] = await tx
        .insert(schema.MoneyRefundSettlement)
        .values({
          organizationId: input.organizationId,
          refundTransactionId: money.id,
          amountMinor: BigInt(input.amountMinor),
          disposition: 'customer_credit',
          customerCreditMemoInstanceId: input.creditMemoInstanceId,
          commandId,
          commandItemKey: 'credit_memo_refund',
        })
        .returning({ id: schema.MoneyRefundSettlement.id })
      if (!settlement) throw new Error('Money refund settlement insert returned no row')

      return { moneyTransactionId: money.id, moneySettlementId: settlement.id }
    }
  )
}
