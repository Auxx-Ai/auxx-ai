// packages/lib/src/money/invoices/apply-money.ts

/**
 * Applying money a customer has already paid to an invoice
 * (plans/accounting/tasks/54-one-money-model.md unit 3).
 *
 * ```
 *   Dr customer_deposits        the applied amount
 *       Cr accounts_receivable    the same
 * ```
 *
 * ## 🔑 The producer `deposit_application` has been waiting for
 *
 * `customer-money/deposit-application-accounting.ts` has been complete,
 * documented and tested since before this task — and idle, because the only
 * writer of `MoneyApplication` (`customer-money/ingest.ts`) applies money to
 * ORDERS and never to invoices, so its candidate query always returned nothing.
 * This is the missing writer. The accounting half is unchanged; this module
 * writes the row and hands off.
 *
 * ## ⚠️ HELD money only, and that is the whole distinction
 *
 * This applies money that arrived without a home — a prepayment, a deposit, an
 * overpayment — and is sitting in `customer_deposits`. It is NOT how a payment
 * taken against a specific invoice is recorded: that is
 * `record-payment.ts`, which posts `Dr cash / Cr accounts_receivable` in one
 * step because the money was never held.
 *
 * 🛑 The receipt is never amended. The prepayment was a liability on the day it
 * arrived and this is a second, later entry saying it stopped being one — the
 * same rule `payments/post-deposit-application.ts:15` states for the lane this
 * replaces.
 *
 * @see plans/accounting/tasks/54-one-money-model.md
 */

import { type Database, schema, type Transaction } from '@auxx/database'
import { and, eq, isNull } from 'drizzle-orm'
import { BadRequestError, UnprocessableEntityError } from '../../errors'
import { runMoneyCommand } from '../commands/run-money-command'
import { acceptDepositApplicationAccounting } from '../customer-money/deposit-application-accounting'
import { loadInvoiceForIssuance } from './issuance-reads'

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
  const money = await tx.query.MoneyTransaction.findFirst({
    where: and(
      eq(schema.MoneyTransaction.organizationId, organizationId),
      eq(schema.MoneyTransaction.id, moneyTransactionId),
      eq(schema.MoneyTransaction.purpose, 'customer_receipt')
    ),
  })
  if (!money) throw new UnprocessableEntityError('That money is not a customer receipt')

  const applications = await tx.query.MoneyApplication.findMany({
    where: and(
      eq(schema.MoneyApplication.organizationId, organizationId),
      eq(schema.MoneyApplication.moneyTransactionId, moneyTransactionId)
    ),
  })
  const spokenFor = applications.reduce(
    (sum, a) => sum + (a.operation === 'apply' ? a.amountMinor : -a.amountMinor),
    0n
  )
  return money.amountMinor - spokenFor
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

  const applications = await tx.query.MoneyApplication.findMany({
    where: and(
      eq(schema.MoneyApplication.organizationId, organizationId),
      eq(schema.MoneyApplication.invoiceInstanceId, invoiceInstanceId)
    ),
  })
  const settled = applications.reduce(
    (sum, a) => sum + (a.operation === 'apply' ? a.amountMinor : -a.amountMinor),
    0n
  )
  return BigInt(fields.totalMinor) - settled
}

/**
 * Apply held money to one invoice, then post the reclass.
 *
 * The application is written and committed first; the journal is accepted
 * after, by the module that owns that contract. A ledger that is not set up
 * refuses the posting without also refusing to record that the customer's money
 * now sits against this invoice.
 */
export async function applyMoneyToInvoice(
  db: Database,
  input: ApplyMoneyToInvoiceInput
): Promise<ApplyMoneyToInvoiceResult> {
  if (!Number.isSafeInteger(input.amountMinor) || input.amountMinor <= 0)
    throw new BadRequestError('An applied amount must be a positive whole number of cents')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.effectiveDate))
    throw new BadRequestError('An application needs a calendar date')

  const applied = await runMoneyCommand(
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

      const [application] = await tx
        .insert(schema.MoneyApplication)
        .values({
          organizationId: input.organizationId,
          moneyTransactionId: input.moneyTransactionId,
          operation: 'apply',
          amountMinor: amount,
          invoiceInstanceId: input.invoiceInstanceId,
          appliedAt: new Date(),
          effectiveDate: input.effectiveDate,
          commandId,
          commandItemKey: 'apply_to_invoice',
          ...(input.quoteInstanceId ? { quoteInstanceId: input.quoteInstanceId } : {}),
        })
        .returning({ id: schema.MoneyApplication.id })
      if (!application) throw new Error('Money application insert returned no row')
      return { moneyApplicationId: application.id }
    }
  )

  // The `deposit_application` producer, unchanged and finally fed. Never throws
  // — it returns a `PostResult`, because an application must not fail because
  // its bookkeeping did.
  await acceptDepositApplicationAccounting(db, {
    organizationId: input.organizationId,
    moneyApplicationId: applied.moneyApplicationId,
    actorUserId: input.userId,
  })
  return applied
}
