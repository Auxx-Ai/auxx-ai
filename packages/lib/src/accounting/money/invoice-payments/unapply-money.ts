// packages/lib/src/accounting/money/invoice-payments/unapply-money.ts

/**
 * Taking applied money back off an invoice, so it is held again.
 *
 * Posts nothing: the money never left A/R, only its link to the invoice changes
 * (91 §4.3). The mirror of `apply-money.ts`, and the first half of `move-payment.ts`.
 */

import type { Database, Transaction } from '@auxx/database'
import { UnprocessableEntityError } from '../../../errors'
import { runMoneyCommand } from '../commands/run-money-command'
import { listLiveApplications } from '../reads'
import { insertApplication } from '../writes'
import { syncInvoicePaymentState } from './payment-state'

export interface UnapplyMoneyFromInvoiceInput {
  organizationId: string
  userId: string
  moneyTransactionId: string
  invoiceInstanceId: string
  amountMinor: number
  effectiveDate: string
  commandKey: string
}

export interface UnapplyMoneyFromInvoiceResult extends Record<string, string> {
  unappliedApplicationId: string
}

/**
 * The live `apply` row for this movement on this invoice.
 *
 * 🛑 An application already reversed by an `unapply` is not offered again - the
 * pair is the record that the money already left this invoice.
 */
async function readLiveApplication(
  tx: Transaction,
  organizationId: string,
  moneyTransactionId: string,
  invoiceInstanceId: string,
  amountMinor: bigint
) {
  const [live] = await listLiveApplications(tx, organizationId, moneyTransactionId, {
    invoiceInstanceId,
  })
  if (!live) throw new UnprocessableEntityError('That payment is not applied to this invoice')
  // Whole rows only: a partial unapply would need the original application split in two.
  if (live.amountMinor !== amountMinor)
    throw new UnprocessableEntityError(
      `That application is for ${live.amountMinor} cents and can only be taken back in full`
    )
  return live
}

/** Take money back off an invoice. */
export async function unapplyMoneyFromInvoice(
  db: Database,
  input: UnapplyMoneyFromInvoiceInput
): Promise<UnapplyMoneyFromInvoiceResult> {
  const applicationId = await db.transaction(async (tx) => {
    const live = await readLiveApplication(
      tx,
      input.organizationId,
      input.moneyTransactionId,
      input.invoiceInstanceId,
      BigInt(input.amountMinor)
    )
    return live.id
  })

  return runMoneyCommand(
    db,
    {
      organizationId: input.organizationId,
      userId: input.userId,
      commandKey: input.commandKey,
      kind: 'unapply_money_from_invoice',
      payload: {
        moneyTransactionId: input.moneyTransactionId,
        invoiceInstanceId: input.invoiceInstanceId,
        amountMinor: input.amountMinor,
        effectiveDate: input.effectiveDate,
      },
    },
    async (tx, commandId) => {
      const row = await insertApplication(tx, input.organizationId, commandId, {
        moneyTransactionId: input.moneyTransactionId,
        operation: 'unapply',
        amountMinor: input.amountMinor,
        invoiceInstanceId: input.invoiceInstanceId,
        effectiveDate: input.effectiveDate,
        reversesApplicationId: applicationId,
        commandItemKey: 'unapply_from_invoice',
      })

      await syncInvoicePaymentState({
        organizationId: input.organizationId,
        userId: input.userId,
        invoiceInstanceId: input.invoiceInstanceId,
        db: tx as unknown as Database,
      })

      return { unappliedApplicationId: row.id }
    }
  )
}
