// packages/lib/src/accounting/money/invoice-payments/apply-money.ts

/**
 * Applying money a customer has already paid to an invoice
 * (plans/accounting/tasks/54-one-money-model.md unit 3).
 *
 * Posts nothing: the receipt already credited A/R for the whole movement, so the
 * application is a link that aging and the invoice balance read (91 §4.3).
 *
 * Held money only — money that arrived without a home. A payment taken against
 * a specific invoice is `record-payment.ts`.
 */

import { type Database, schema, type Transaction } from '@auxx/database'
import { and, eq, isNull } from 'drizzle-orm'
import { BadRequestError, UnprocessableEntityError } from '../../../errors'
import { loadInvoiceForIssuance } from '../../sales/invoices/issuance-reads'
import { runMoneyCommand } from '../commands/run-money-command'
import { readMovement, sumAppliedToInvoice, sumAppliedToMovement } from '../reads'
import { insertApplication } from '../writes'

export interface ApplyMoneyToInvoiceInput {
  organizationId: string
  userId: string
  /** The `MoneyTransaction` holding the money. Must be a `customer_receipt`. */
  moneyTransactionId: string
  /** `EntityInstance` id of the invoice to relieve. */
  invoiceInstanceId: string
  /** Integer minor units. Must fit both the held remainder and the invoice balance. */
  amountMinor: number
  /** `YYYY-MM-DD` — the day the money was applied, which is this entry's date. */
  effectiveDate: string
  /** Idempotency key. A retry returns the first run's application id. */
  commandKey: string
  /**
   * The quote this money was held against, when it was a quote deposit
   * (MIGRATION follow-up 7). Stamped on the row rather than read back off
   * `MoneyCommand.actorSnapshot`.
   */
  quoteInstanceId?: string
}

export interface ApplyMoneyToInvoiceResult extends Record<string, string> {
  moneyApplicationId: string
}

/**
 * How much of a movement is still unapplied.
 *
 * 🛑 Read from the application rows, never a column. The apply/unapply pair IS
 * the record of what is spoken for, exactly as the lane this replaces read held
 * money off the ledger rather than storing a remainder that could drift.
 */
async function readHeldMinor(
  tx: Transaction,
  organizationId: string,
  moneyTransactionId: string
): Promise<bigint> {
  const money = await readMovement(tx, organizationId, moneyTransactionId, {
    purpose: 'customer_receipt',
  })
  if (!money) throw new UnprocessableEntityError('That money is not a customer receipt')
  return money.amountMinor - (await sumAppliedToMovement(tx, organizationId, moneyTransactionId))
}

/** What the invoice still owes, netted from its own application rows. */
async function readInvoiceOutstanding(
  tx: Transaction,
  organizationId: string,
  invoiceInstanceId: string
): Promise<bigint> {
  // Through `EntityDefinition.entityType`: the FK proves an instance in this
  // org and nothing more, and relieving a receivable no invoice raised is not
  // recoverable by a later correction.
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
    throw new UnprocessableEntityError('That invoice has no total to apply against')

  const settled = await sumAppliedToInvoice(tx, organizationId, invoiceInstanceId)
  return BigInt(fields.totalMinor) - settled
}

/** Apply held money to one invoice. */
export async function applyMoneyToInvoice(
  db: Database,
  input: ApplyMoneyToInvoiceInput
): Promise<ApplyMoneyToInvoiceResult> {
  if (!Number.isSafeInteger(input.amountMinor) || input.amountMinor <= 0)
    throw new BadRequestError('An applied amount must be a positive whole number of cents')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.effectiveDate))
    throw new BadRequestError('An application needs a calendar date')

  return runMoneyCommand(
    db,
    {
      organizationId: input.organizationId,
      userId: input.userId,
      commandKey: input.commandKey,
      kind: 'apply_money_to_invoice',
      payload: {
        moneyTransactionId: input.moneyTransactionId,
        invoiceInstanceId: input.invoiceInstanceId,
        amountMinor: input.amountMinor,
        effectiveDate: input.effectiveDate,
      },
    },
    async (tx, commandId) => {
      const amount = BigInt(input.amountMinor)
      const held = await readHeldMinor(tx, input.organizationId, input.moneyTransactionId)
      if (amount > held)
        throw new UnprocessableEntityError(`Only ${held} cents of that payment is unapplied`)
      const outstanding = await readInvoiceOutstanding(
        tx,
        input.organizationId,
        input.invoiceInstanceId
      )
      if (amount > outstanding)
        throw new UnprocessableEntityError(
          `That is more than the ${outstanding} cents this invoice still owes`
        )

      const application = await insertApplication(tx, input.organizationId, commandId, {
        moneyTransactionId: input.moneyTransactionId,
        operation: 'apply',
        amountMinor: amount,
        invoiceInstanceId: input.invoiceInstanceId,
        effectiveDate: input.effectiveDate,
        quoteInstanceId: input.quoteInstanceId,
        commandItemKey: 'apply_to_invoice',
      })
      return { moneyApplicationId: application.id }
    }
  )
}
