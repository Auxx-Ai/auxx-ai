// packages/lib/src/money/invoices/move-payment.ts

/**
 * Moving money from one invoice to another
 * (plans/accounting/tasks/54-one-money-model.md unit 3).
 *
 * ## 🔑 Why this is not a void, and not a correction
 *
 * A void says *the receipt was a mistake*. A move says the opposite: the money
 * is real, it arrived, and only the question of WHICH receivable it relieves
 * was answered wrongly. Correcting the receipt for that would erase the fact
 * that the customer paid, which is never true.
 *
 * So the receipt stands untouched and only the APPLICATION moves:
 *
 * ```
 *   unapply from A    Dr accounts_receivable   Cr customer_deposits
 *   apply to B        Dr customer_deposits     Cr accounts_receivable
 * ```
 *
 * Two entries through `customer_deposits`, netting to `Dr A/R[A] Cr A/R[B]`.
 * The money passes back through held state on its way, which is exactly what
 * happened in reality: for the moment between the two, it was money on account.
 *
 * ## 🛑 Only money that was APPLIED can be moved this way
 *
 * A payment recorded straight against an invoice by `record-payment.ts` posts
 * `Dr cash / Cr accounts_receivable` in ONE entry, with no separate application
 * posting to reverse. There is nothing here to move: the receipt's own entry
 * names invoice A.
 *
 * ⚠️ Moving one of those is `voidInvoicePayment` followed by a fresh
 * `recordInvoicePayment` against B. That is not a workaround — the two entries
 * net to the same `Dr A/R[A] Cr A/R[B]`, and it keeps the rule that a posted
 * entry is never quietly re-pointed at a different document.
 *
 * @see plans/accounting/tasks/54-one-money-model.md
 */

import type { Database } from '@auxx/database'
import { findLiveSubjectPosting } from '../../accounting/ledger/reads/list-postings'
import { BadRequestError, UnprocessableEntityError } from '../../errors'
import { applyMoneyToInvoice } from './apply-money'
import { unapplyMoneyFromInvoice } from './unapply-money'

export interface MoveInvoicePaymentInput {
  organizationId: string
  userId: string
  moneyTransactionId: string
  fromInvoiceInstanceId: string
  toInvoiceInstanceId: string
  amountMinor: number
  /** `YYYY-MM-DD` — the day the money was moved. Both entries carry it. */
  effectiveDate: string
  /** Idempotency key. Both halves derive their own from it. */
  commandKey: string
}

export interface MoveInvoicePaymentResult extends Record<string, string> {
  unappliedApplicationId: string
  moneyApplicationId: string
}

/**
 * Move applied money from one invoice to another.
 *
 * 🛑 Two commands, not one transaction, and deliberately so: each half is an
 * accounting event in its own right with its own journal, and
 * `runMoneyCommand` makes each independently idempotent. A crash between them
 * leaves the money HELD — visible, correct, and re-appliable — rather than
 * half-posted.
 */
export async function moveInvoicePayment(
  db: Database,
  input: MoveInvoicePaymentInput
): Promise<MoveInvoicePaymentResult> {
  if (input.fromInvoiceInstanceId === input.toInvoiceInstanceId)
    throw new BadRequestError('Choose a different invoice to move this payment to')
  if (!Number.isSafeInteger(input.amountMinor) || input.amountMinor <= 0)
    throw new BadRequestError('A moved amount must be a positive whole number of cents')

  // ⚠️ Refuse a receipt posted straight against its invoice. Its own entry
  // names that receivable, and re-pointing a posted entry is not available -
  // see the file header for the void-and-re-record remedy.
  const receiptPosting = await findLiveSubjectPosting(db, {
    organizationId: input.organizationId,
    sourceKind: 'money_transaction',
    sourceId: input.moneyTransactionId,
  })
  if (receiptPosting.isErr()) throw receiptPosting.error
  if (receiptPosting.value)
    throw new UnprocessableEntityError(
      'This payment was recorded against its invoice directly. Void it and record it again on the other invoice.'
    )

  const unapplied = await unapplyMoneyFromInvoice(db, {
    organizationId: input.organizationId,
    userId: input.userId,
    moneyTransactionId: input.moneyTransactionId,
    invoiceInstanceId: input.fromInvoiceInstanceId,
    amountMinor: input.amountMinor,
    effectiveDate: input.effectiveDate,
    commandKey: `${input.commandKey}:unapply`,
  })
  const applied = await applyMoneyToInvoice(db, {
    organizationId: input.organizationId,
    userId: input.userId,
    moneyTransactionId: input.moneyTransactionId,
    invoiceInstanceId: input.toInvoiceInstanceId,
    amountMinor: input.amountMinor,
    effectiveDate: input.effectiveDate,
    commandKey: `${input.commandKey}:apply`,
  })
  return {
    unappliedApplicationId: unapplied.unappliedApplicationId,
    moneyApplicationId: applied.moneyApplicationId,
  }
}
