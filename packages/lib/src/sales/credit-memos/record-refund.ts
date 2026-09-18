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
 * ⚠️ The two-way endpoint is the receipt's choice reversed — a named bank
 * account, or undeposited funds — validated here against the org's
 * `accounting.paymentRoute.<method>` setting, because both wrong answers still
 * balance. `refund-accounting.ts`'s `readRoute` freezes the same choice.
 *
 * @see docs/lib-module-guide.md
 */

import { type Database, schema } from '@auxx/database'
import {
  type PaymentRouteMethod,
  resolvePaymentRoute,
} from '../../accounting/money/bank-deposits/route'
import { runMoneyCommand } from '../../accounting/money/commands/run-money-command'
import { getOrgCache } from '../../cache/singletons'
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
  method: PaymentRouteMethod
  /**
   * The `bank_account` record the money left. Required when the method's route
   * is `cash`, forbidden when it is `undeposited_funds`.
   */
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

  const settings = await getOrgCache().get(input.organizationId, 'orgSettings')
  const route = resolvePaymentRoute(input.method, settings)
  const bankAccountInstanceId = input.bankAccountInstanceId?.trim() || null
  if (route === 'cash' && !bankAccountInstanceId)
    throw new BadRequestError('Choose the bank account this refund was paid from')
  if (route === 'undeposited_funds' && bankAccountInstanceId)
    throw new BadRequestError(
      'This refund method comes out of undeposited funds and cannot name a bank account'
    )
  // 🔑 `clearing` does not carry over to a hand-recorded refund, the same rule
  // `record-payment.ts` states for a receipt: a clearing account exists to be
  // drained by a payout, and a refund auxx paid by hand produces none. The
  // recorder says where the money went instead.

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

      const [money] = await tx
        .insert(schema.MoneyTransaction)
        .values({
          organizationId: input.organizationId,
          purpose: 'customer_refund',
          amountMinor: BigInt(input.amountMinor),
          currency: 'USD',
          currencyExponent: 2,
          // `date`, not `instant`: nobody observed a time, and the schema CHECK
          // enforces the pairing.
          datePrecision: 'date',
          occurredOn: input.date,
          partyInstanceId: memo.contactInstanceId,
          cashAccountInstanceId: bankAccountInstanceId,
          method: input.method,
          recordedByCommandId: commandId,
          reference: input.reference?.trim() || null,
          note: input.note?.trim() || null,
        })
        .returning({ id: schema.MoneyTransaction.id })
      if (!money) throw new Error('Money transaction insert returned no row')

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
