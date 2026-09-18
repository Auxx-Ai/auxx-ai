// packages/lib/src/money/invoices/unapply-money.ts

/**
 * Taking applied money back off an invoice, so it is held again.
 *
 * ```
 *   Dr accounts_receivable      the unapplied amount
 *       Cr customer_deposits      the same
 * ```
 *
 * The mirror of `apply-money.ts`, and the first half of `move-payment.ts`. The
 * invoice goes back to owing what it owed; the money goes back to being a
 * liability the business holds.
 *
 * 🛑 The entry is the REVERSAL of the application's own posting, never a
 * hand-built opposite: the reversal lands on the accounts the original used,
 * and it frees the application's subject claim so the money can be applied
 * again.
 */

import { type Database, schema, type Transaction } from '@auxx/database'
import { and, eq } from 'drizzle-orm'
import { didLedgerAccept } from '../../accounting/ledger/post/ledger-accepted'
import { isAccountingEnabled } from '../../accounting/ledger/setup/accounting-enabled'
import { ConflictError, UnprocessableEntityError } from '../../errors'
import { runMoneyCommand } from '../commands/run-money-command'
import { reverseDepositApplicationAccounting } from '../customer-money/deposit-application-accounting'
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
  const applications = await tx.query.MoneyApplication.findMany({
    where: and(
      eq(schema.MoneyApplication.organizationId, organizationId),
      eq(schema.MoneyApplication.moneyTransactionId, moneyTransactionId),
      eq(schema.MoneyApplication.invoiceInstanceId, invoiceInstanceId)
    ),
  })
  const reversed = new Set(
    applications.flatMap((a) => (a.reversesApplicationId ? [a.reversesApplicationId] : []))
  )
  const live = applications.find((a) => a.operation === 'apply' && !reversed.has(a.id))
  if (!live) throw new UnprocessableEntityError('That payment is not applied to this invoice')
  // ⚠️ Whole rows only. A partial unapply would need the original application
  // split in two, and its posting cannot be split after the fact.
  if (live.amountMinor !== amountMinor)
    throw new UnprocessableEntityError(
      `That application is for ${live.amountMinor} cents and can only be taken back in full`
    )
  return live
}

/**
 * Take money back off an invoice.
 *
 * 🔑 The unapply row is written whether or not a journal exists to reverse. An
 * application made while accounting was off has nothing to back out, and
 * refusing would strand the money on an invoice forever.
 */
export async function unapplyMoneyFromInvoice(
  db: Database,
  input: UnapplyMoneyFromInvoiceInput
): Promise<UnapplyMoneyFromInvoiceResult> {
  const accountingOn = await isAccountingEnabled(db, input.organizationId)

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

  // 🛑 The ledger goes FIRST, outside the command: a refused reversal must
  // leave the application standing, not half-taken-back.
  if (accountingOn) {
    const reversal = await reverseDepositApplicationAccounting(db, {
      organizationId: input.organizationId,
      moneyApplicationId: applicationId,
      actorUserId: input.userId,
      memo: 'Payment taken back off this invoice',
    })
    if (reversal && !didLedgerAccept(reversal))
      throw new ConflictError(
        `That application's journal could not be reversed${reversal.error ? `: ${reversal.error}` : ` (${reversal.status})`}`,
        { moneyApplicationId: applicationId }
      )
  }

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
      const [row] = await tx
        .insert(schema.MoneyApplication)
        .values({
          organizationId: input.organizationId,
          moneyTransactionId: input.moneyTransactionId,
          operation: 'unapply',
          amountMinor: BigInt(input.amountMinor),
          invoiceInstanceId: input.invoiceInstanceId,
          appliedAt: new Date(),
          effectiveDate: input.effectiveDate,
          reversesApplicationId: applicationId,
          commandId,
          commandItemKey: 'unapply_from_invoice',
        })
        .returning({ id: schema.MoneyApplication.id })
      if (!row) throw new Error('Money unapplication insert returned no row')

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
