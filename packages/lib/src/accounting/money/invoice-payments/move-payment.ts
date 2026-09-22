// packages/lib/src/accounting/money/invoice-payments/move-payment.ts

/**
 * Moving money from one invoice to another
 * (plans/accounting/tasks/54-one-money-model.md unit 3).
 *
 * Not a void: the money is real and the receipt stands; only the application
 * moves. The receipt credited A/R for the customer, so unapply-then-apply posts
 * nothing and aging follows the new application (91 §4.3).
 *
 * @see plans/accounting/tasks/54-one-money-model.md
 */

import type { Database } from '@auxx/database'
import { BadRequestError } from '../../../errors'
import { applyMoneyToInvoice } from './apply-money'
import { unapplyMoneyFromInvoice } from './unapply-money'

export interface MoveInvoicePaymentInput {
  organizationId: string
  userId: string
  moneyTransactionId: string
  fromInvoiceInstanceId: string
  toInvoiceInstanceId: string
  amountMinor: number
  /** `YYYY-MM-DD` — the day the money was moved. Both applications carry it. */
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
 * Two commands, each idempotent through `runMoneyCommand`: a crash between them
 * leaves the money held and re-appliable.
 */
export async function moveInvoicePayment(
  db: Database,
  input: MoveInvoicePaymentInput
): Promise<MoveInvoicePaymentResult> {
  if (input.fromInvoiceInstanceId === input.toInvoiceInstanceId)
    throw new BadRequestError('Choose a different invoice to move this payment to')
  if (!Number.isSafeInteger(input.amountMinor) || input.amountMinor <= 0)
    throw new BadRequestError('A moved amount must be a positive whole number of cents')

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
