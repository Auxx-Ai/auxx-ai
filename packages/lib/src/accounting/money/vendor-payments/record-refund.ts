// packages/lib/src/accounting/money/vendor-payments/record-refund.ts

/**
 * Recording a supplier's refund of an issued vendor credit — the customer
 * refund pair with the sides flipped (task 71 §5 U7).
 *
 * ```
 *   MoneyCommand           the idempotency key and who pressed the button
 *   MoneyTransaction       the money itself — purpose `vendor_refund`
 *   MoneyRefundSettlement  what it settled — this vendor credit
 * ```
 *
 * 🛑 A refund settles the CREDIT, not a bill, so no `MoneyApplication` is
 * written: an application is what relieves a bill's payable, and an unapplied
 * credit may be refunded with its bill still at full balance.
 *
 * The endpoint is the payment's choice reversed: a rail, a bank account, or
 * neither. `refund-accounting.ts` resolves the same three shapes at post time.
 */

import { type Database, schema } from '@auxx/database'
import { BadRequestError, UnprocessableEntityError } from '../../../errors'
import {
  requireVendorCredit,
  sumVendorCreditApplications,
  sumVendorCreditRefunds,
} from '../../purchasing/vendor-credit/reads'
import type { PaymentMethod } from '../client'
import { insertMovement } from '../commands/insert-movement'
import { runMoneyCommand } from '../commands/run-money-command'

export interface RecordVendorRefundInput {
  organizationId: string
  userId: string
  /** `EntityInstance` id of the `issued` vendor credit this refund settles. */
  vendorCreditInstanceId: string
  /** Integer minor units. Must be positive and within the credit's balance. */
  amountMinor: number
  /** `YYYY-MM-DD`, the day the money arrived. May be backdated. */
  date: string
  method: PaymentMethod
  /** The `payment_gateway` the money arrived on. Exclusive with the bank account. */
  paymentGatewayId?: string | null
  /** The `bank_account` record the money arrived in. Exclusive with the gateway. */
  bankAccountInstanceId?: string | null
  reference?: string
  note?: string
  /** The idempotency key. A double-submitted dialog returns the first run's ids. */
  commandKey: string
}

export interface RecordVendorRefundResult extends Record<string, string> {
  moneyTransactionId: string
  moneySettlementId: string
}

/**
 * Record one refund against one issued vendor credit.
 *
 * Returns the ids of what it wrote. Accounting is NOT posted here — the caller
 * runs `postVendorRefundAccounting` once this has committed, so a ledger that
 * is misconfigured refuses the journal without also refusing to record that the
 * supplier sent the money back.
 */
export async function recordVendorRefund(
  db: Database,
  input: RecordVendorRefundInput
): Promise<RecordVendorRefundResult> {
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
      kind: 'record_vendor_refund',
      payload: {
        vendorCreditInstanceId: input.vendorCreditInstanceId,
        amountMinor: input.amountMinor,
        date: input.date,
        method: input.method,
        paymentGatewayId,
        bankAccountInstanceId,
      },
    },
    async (tx, commandId) => {
      const scoped = tx as unknown as Database
      // Under the shared money lock `runMoneyCommand` holds, so the capacity
      // this checks cannot be consumed by a concurrent refund between the check
      // and the settlement insert.
      const credit = await requireVendorCredit(
        scoped,
        input.organizationId,
        input.vendorCreditInstanceId
      )
      if (credit.status !== 'issued')
        throw new UnprocessableEntityError(
          credit.status === 'draft'
            ? 'Issue this vendor credit before refunding it'
            : credit.status === 'settled'
              ? 'This vendor credit is settled - it has no balance left to refund'
              : 'A void vendor credit cannot be refunded',
          { vendorCreditInstanceId: input.vendorCreditInstanceId, status: credit.status }
        )

      const [applied, refunded] = await Promise.all([
        sumVendorCreditApplications(scoped, input.organizationId, input.vendorCreditInstanceId),
        sumVendorCreditRefunds(scoped, input.organizationId, input.vendorCreditInstanceId),
      ])
      const balance = Math.max(0, credit.totalMinor - applied - refunded)
      if (input.amountMinor > balance)
        throw new UnprocessableEntityError(
          `That is more than the ${balance} cents left on vendor credit ${credit.number}`,
          { vendorCreditInstanceId: input.vendorCreditInstanceId }
        )

      const money = await insertMovement(tx, input.organizationId, commandId, {
        purpose: 'vendor_refund',
        amountMinor: input.amountMinor,
        when: { date: input.date },
        partyInstanceId: credit.vendorCompanyInstanceId,
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
          disposition: 'vendor_credit',
          vendorCreditInstanceId: input.vendorCreditInstanceId,
          commandId,
          commandItemKey: 'vendor_credit_refund',
        })
        .returning({ id: schema.MoneyRefundSettlement.id })
      if (!settlement) throw new Error('Money refund settlement insert returned no row')

      return { moneyTransactionId: money.id, moneySettlementId: settlement.id }
    }
  )
}
