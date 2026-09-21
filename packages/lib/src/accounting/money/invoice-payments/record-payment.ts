// packages/lib/src/accounting/money/invoice-payments/record-payment.ts

/**
 * Recording a payment received against an invoice, on the money model.
 *
 * ```
 *   MoneyCommand      the idempotency key and who pressed the button
 *   MoneyTransaction  the money itself — purpose `customer_receipt`
 *   MoneyApplication  what it was applied TO — this invoice
 * ```
 *
 * The one rule about where the money went: it names a rail, a bank account, or
 * neither (undeposited funds, waiting for a `bank_deposit` to group it).
 *
 * 🛑 Not a refund door. `purpose` is `customer_receipt` only.
 *
 * @see plans/accounting/tasks/done/71-one-cash-endpoint.md
 */

import { type Database, schema, type Transaction } from '@auxx/database'
import { and, eq, isNull } from 'drizzle-orm'
import { BadRequestError, UnprocessableEntityError } from '../../../errors'
import { loadInvoiceForIssuance } from '../../sales/invoices/issuance-reads'
import type { PaymentMethod } from '../client'
import { insertMovement } from '../commands/insert-movement'
import { runMoneyCommand } from '../commands/run-money-command'
import { sumAppliedToInvoice } from '../reads'
import { insertApplication } from '../writes'
import { syncInvoicePaymentState } from './payment-state'

export interface RecordInvoicePaymentInput {
  organizationId: string
  userId: string
  /** `EntityInstance` id of the invoice, not the `RecordId`. */
  invoiceInstanceId: string
  /** Integer minor units. Must be positive and within the invoice's balance. */
  amountMinor: number
  /** `YYYY-MM-DD`, the day the payment was received. May be backdated. */
  date: string
  method: PaymentMethod
  /** The `payment_gateway` the money arrived through, when it arrived through one. */
  paymentGatewayId?: string | null
  /** The `bank_account` record the money landed in. Exclusive with the gateway. */
  bankAccountInstanceId?: string | null
  reference?: string
  note?: string
  /**
   * The idempotency key. A double-submitted dialog carrying the same key
   * returns the first run's ids instead of recording the payment twice.
   */
  commandKey: string
}

export interface RecordInvoicePaymentResult extends Record<string, string> {
  moneyTransactionId: string
  moneyApplicationId: string
}

/** The invoice, its total, and what it still owed before this payment. */
async function readInvoiceBalance(
  tx: Transaction,
  organizationId: string,
  invoiceInstanceId: string
) {
  // 🛑 Through `EntityDefinition.entityType`, never the bare instance id: an
  // application against a record that is not an invoice would relieve a
  // receivable no invoice ever raised.
  const [invoice] = await tx
    .select({ id: schema.EntityInstance.id })
    .from(schema.EntityInstance)
    .innerJoin(
      schema.EntityDefinition,
      and(
        eq(schema.EntityDefinition.id, schema.EntityInstance.entityDefinitionId),
        eq(schema.EntityDefinition.organizationId, organizationId)
      )
    )
    .where(
      and(
        eq(schema.EntityInstance.organizationId, organizationId),
        eq(schema.EntityInstance.id, invoiceInstanceId),
        eq(schema.EntityDefinition.entityType, 'invoice'),
        isNull(schema.EntityInstance.archivedAt),
        isNull(schema.EntityDefinition.archivedAt)
      )
    )
    .limit(1)
  if (!invoice) throw new UnprocessableEntityError('That invoice does not exist')

  const fields = await loadInvoiceForIssuance(tx, organizationId, invoiceInstanceId)
  if (!fields?.totalMinor)
    throw new UnprocessableEntityError('That invoice has no total to pay against')

  // Settled is read from the applications themselves — the ledger is the record
  // of what is paid, and there is no `amountPaid` column to drift out of step.
  const settledMinor = await sumAppliedToInvoice(tx, organizationId, invoiceInstanceId)
  return {
    totalMinor: BigInt(fields.totalMinor),
    outstandingMinor: BigInt(fields.totalMinor) - settledMinor,
    contactInstanceId: fields.contactInstanceId,
  }
}

/**
 * Record one payment against one invoice.
 *
 * Returns the ids of what it wrote. Accounting is NOT posted here — the caller
 * runs `acceptInvoiceReceiptAccounting` once this has committed, so a ledger
 * that is misconfigured refuses the journal without also refusing to record
 * that the customer paid.
 */
export async function recordInvoicePayment(
  db: Database,
  input: RecordInvoicePaymentInput
): Promise<RecordInvoicePaymentResult> {
  if (!Number.isSafeInteger(input.amountMinor) || input.amountMinor <= 0)
    throw new BadRequestError('A payment amount must be a positive whole number of cents')
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
      kind: 'record_invoice_payment',
      payload: {
        invoiceInstanceId: input.invoiceInstanceId,
        amountMinor: input.amountMinor,
        date: input.date,
        method: input.method,
        paymentGatewayId,
        bankAccountInstanceId,
      },
    },
    async (tx, commandId) => {
      const invoice = await readInvoiceBalance(tx, input.organizationId, input.invoiceInstanceId)
      if (BigInt(input.amountMinor) > invoice.outstandingMinor)
        throw new UnprocessableEntityError(
          `That is more than the ${invoice.outstandingMinor} cents this invoice still owes`
        )

      const money = await insertMovement(tx, input.organizationId, commandId, {
        purpose: 'customer_receipt',
        amountMinor: input.amountMinor,
        // `date`, not `instant`: nobody observed a time, and inventing one would
        // make the book date depend on a fact that was never recorded.
        when: { date: input.date },
        partyInstanceId: invoice.contactInstanceId,
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
        invoiceInstanceId: input.invoiceInstanceId,
        effectiveDate: input.date,
        commandItemKey: 'invoice_payment',
      })

      // Project the ledger truth onto the invoice's mirrored `amountPaid`/`balance`/
      // `status` fields, same call `totals-hooks.ts` makes on every total change.
      await syncInvoicePaymentState({
        organizationId: input.organizationId,
        userId: input.userId,
        invoiceInstanceId: input.invoiceInstanceId,
        db: tx as unknown as Database,
      })

      return { moneyTransactionId: money.id, moneyApplicationId: application.id }
    }
  )
}
