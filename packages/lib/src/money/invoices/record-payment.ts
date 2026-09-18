// packages/lib/src/money/invoices/record-payment.ts

/**
 * Recording a payment received against an invoice, on the money model
 * (plans/accounting/tasks/54-one-money-model.md unit 2b).
 *
 * The replacement for `payments/ledger.ts`'s `recordManualPayment`, which wrote
 * a `PaymentTransaction` + `PaymentAllocation` pair. This writes the three rows
 * that model the same fact durably:
 *
 * ```
 *   MoneyCommand      the idempotency key and who pressed the button
 *   MoneyTransaction  the money itself — purpose `customer_receipt`
 *   MoneyApplication  what it was applied TO — this invoice
 * ```
 *
 * ## 🔑 The bank account is optional, and that is an accounting decision
 *
 * `bank-deposits/route.ts` routes cash and cheque to **undeposited funds** on
 * purpose: five cheques banked together arrive at the bank as ONE line, and
 * five separate cash postings can never match it. So a receipt with no named
 * bank account is not an incomplete record — it is money received and not yet
 * banked, and it sits in the `undeposited_funds` role until a `bank_deposit`
 * groups it.
 *
 * ⚠️ The org's `accounting.paymentRoute.<method>` setting decides which of the
 * two a method takes, so a `bank` payment (routed to `cash` by default) MUST
 * name an account and a `cash` one must not. This function enforces that rather
 * than silently picking, because both wrong answers still balance.
 *
 * 🛑 The `clearing` route is the exception and does not apply here — see the
 * comment on it below. A hand-recorded card payment has no payout coming to
 * drain a clearing account.
 *
 * ## 🛑 Not a refund door
 *
 * `purpose` is `customer_receipt` only. A refund is `customer_refund` with its
 * own effect and its own settlement rules; see unit 4.
 *
 * @see plans/accounting/tasks/54-one-money-model.md
 * @see docs/lib-module-guide.md
 */

import { type Database, schema, type Transaction } from '@auxx/database'
import { and, eq, isNull } from 'drizzle-orm'
import { getOrgCache } from '../../cache/singletons'
import { BadRequestError, UnprocessableEntityError } from '../../errors'
import { type PaymentRouteMethod, resolvePaymentRoute } from '../bank-deposits/route'
import { runMoneyCommand } from '../commands/run-money-command'
import { loadInvoiceForIssuance } from './issuance-reads'
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
  method: PaymentRouteMethod
  /**
   * The `bank_account` record the money landed in. Required when the method's
   * route is `cash`, forbidden when it is `undeposited_funds`.
   */
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
  const applications = await tx.query.MoneyApplication.findMany({
    where: and(
      eq(schema.MoneyApplication.organizationId, organizationId),
      eq(schema.MoneyApplication.invoiceInstanceId, invoiceInstanceId)
    ),
  })
  const settledMinor = applications.reduce(
    (sum, a) => sum + (a.operation === 'apply' ? a.amountMinor : -a.amountMinor),
    0n
  )
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

  // Through the org cache, as `bank-deposits/reads.ts` reads the same table:
  // `orgSettings` is a cached key and a fresh query would defeat invalidation.
  const settings = await getOrgCache().get(input.organizationId, 'orgSettings')
  const route = resolvePaymentRoute(input.method, settings)
  const bankAccountInstanceId = input.bankAccountInstanceId?.trim() || null
  if (route === 'cash' && !bankAccountInstanceId)
    throw new BadRequestError('Choose the bank account this payment landed in')
  if (route === 'undeposited_funds' && bankAccountInstanceId)
    throw new BadRequestError(
      'This payment method is held in undeposited funds until a bank deposit banks it'
    )
  // 🔑 `clearing` is the one route that does NOT carry over to a hand-recorded
  // payment, and it is the subtlest rule here. A clearing account exists to be
  // DRAINED by a payout entry (`route.ts`: card settles net, days later). A card
  // taken on a terminal auxx knows nothing about produces no payout, so booking
  // it to clearing leaves a balance nothing will ever clear. The recorder says
  // where the money went instead: a named bank account, or undeposited funds.

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
        bankAccountInstanceId,
      },
    },
    async (tx, commandId) => {
      const invoice = await readInvoiceBalance(tx, input.organizationId, input.invoiceInstanceId)
      if (BigInt(input.amountMinor) > invoice.outstandingMinor)
        throw new UnprocessableEntityError(
          `That is more than the ${invoice.outstandingMinor} cents this invoice still owes`
        )

      const [money] = await tx
        .insert(schema.MoneyTransaction)
        .values({
          organizationId: input.organizationId,
          purpose: 'customer_receipt',
          amountMinor: BigInt(input.amountMinor),
          currency: 'USD',
          currencyExponent: 2,
          // 🛑 `date`, not `instant`. Nobody observed a time — inventing one
          // would make the book date depend on converting a fact that was
          // never recorded. The schema CHECK enforces the pairing.
          datePrecision: 'date',
          occurredOn: input.date,
          partyInstanceId: invoice.contactInstanceId,
          cashAccountInstanceId: bankAccountInstanceId,
          method: input.method,
          recordedByCommandId: commandId,
          reference: input.reference?.trim() || null,
          note: input.note?.trim() || null,
        })
        .returning({ id: schema.MoneyTransaction.id })
      if (!money) throw new Error('Money transaction insert returned no row')

      const [application] = await tx
        .insert(schema.MoneyApplication)
        .values({
          organizationId: input.organizationId,
          moneyTransactionId: money.id,
          operation: 'apply',
          amountMinor: BigInt(input.amountMinor),
          invoiceInstanceId: input.invoiceInstanceId,
          appliedAt: new Date(),
          effectiveDate: input.date,
          commandId,
          commandItemKey: 'invoice_payment',
        })
        .returning({ id: schema.MoneyApplication.id })
      if (!application) throw new Error('Money application insert returned no row')

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
