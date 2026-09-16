// packages/lib/src/money/invoices/void-payment.ts

/**
 * Undoing a payment that should never have been recorded
 * (plans/accounting/tasks/54-one-money-model.md unit 3).
 *
 * The money model's answer to the legacy `deleteManualPayment`, and it is a
 * different answer on purpose.
 *
 * ## 🛑 Nothing is deleted
 *
 * `deleteManualPayment` reversed the postings and then DELETED the
 * `PaymentTransaction`, its allocations and its mirror records. That is not
 * available here and should not be: an `AccountingEffect` is immutable and
 * sha256-hashed, and the whole point of the effects model is that what was
 * approved stays on the record. A mistake is corrected by a SECOND entry —
 * ground rule 6, the same rule that stops a deposit application amending the
 * receipt it follows.
 *
 * So a void writes:
 *
 * ```
 *   AccountingWork  operation: 'correction', correctsEffectId -> the receipt
 *   GlPosting       Dr accounts_receivable / Cr <cash>   (the exact reversal)
 *   MoneyApplication  operation: 'unapply'  per apply row, freeing the invoice
 * ```
 *
 * ## ⚠️ This is NOT how you move money to another invoice
 *
 * A correction says *the receipt was a mistake* — the money never arrived, or
 * arrived in a form we recorded wrongly. If the money is real and simply
 * belongs against a different invoice, that is
 * {@link moveInvoicePayment}: an `unapply`/`apply` pair, two journals through
 * `customer_deposits`, and the receipt left exactly as it stands. Using a
 * correction for that would erase the fact that the money came in.
 *
 * @see plans/accounting/tasks/54-one-money-model.md
 */

import { type Database, schema, type Transaction } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { and, desc, eq } from 'drizzle-orm'
import { AuxxError, ConflictError, UnprocessableEntityError } from '../../errors'
import { acceptEntryInTx } from '../../postings/accept-entry'
import { isAccountingEnabled } from '../../postings/accounting-enabled'
import { resolveFulfillmentDeliveryIntentInTx } from '../../postings/book-connections'
import { buildEntry } from '../../postings/build-entry'
import { deliverAccountingPosting, planAccountingDeliveryInTx } from '../../postings/delivery'
import {
  accountingBasisHash,
  customerReceiptAccountingEffectKey,
  customerReceiptCorrectionAccountingEffectKey,
} from '../../postings/effect-basis'
import { acceptedCustomerReceiptEffectBasisSchema } from '../../postings/effect-types'
import type { GlPostingLineInput, PostResult } from '../../postings/types'
import { runMoneyCommand } from '../commands/run-money-command'

const logger = createScopedLogger('invoice-void-payment')

export interface VoidInvoicePaymentInput {
  organizationId: string
  userId: string
  /** The `MoneyTransaction` to void. Must be a `customer_receipt`. */
  moneyTransactionId: string
  /** Why, for the journal memo and the audit trail. */
  reason?: string
  /** Idempotency key. A retry returns the first run's ids. */
  commandKey: string
}

export interface VoidInvoicePaymentResult extends Record<string, string> {
  correctionWorkId: string
  glPostingId: string
}

/**
 * The accepted receipt effect for this movement, plus the head of any
 * correction chain already standing against it.
 *
 * 🛑 Refuses a movement that was never accepted. There is nothing to correct —
 * the caller wants the pending work cancelled, which is a different operation
 * and does not touch the ledger at all.
 */
async function readAcceptedReceipt(
  tx: Transaction,
  organizationId: string,
  moneyTransactionId: string
) {
  const [row] = await tx
    .select({
      effectId: schema.AccountingEffect.id,
      acceptedBasis: schema.AccountingEffect.acceptedBasis,
      workId: schema.AccountingWork.id,
      effectiveDate: schema.AccountingEffect.effectiveDate,
    })
    .from(schema.AccountingWork)
    .innerJoin(
      schema.AccountingEffect,
      and(
        eq(schema.AccountingEffect.organizationId, schema.AccountingWork.organizationId),
        eq(schema.AccountingEffect.workId, schema.AccountingWork.id)
      )
    )
    .where(
      and(
        eq(schema.AccountingWork.organizationId, organizationId),
        eq(schema.AccountingWork.moneyTransactionId, moneyTransactionId),
        eq(schema.AccountingWork.effectKind, 'customer_receipt'),
        eq(schema.AccountingWork.effectKey, customerReceiptAccountingEffectKey(moneyTransactionId))
      )
    )
    .limit(1)
  if (!row) throw new UnprocessableEntityError('That payment has no accepted journal to correct')

  const parsed = acceptedCustomerReceiptEffectBasisSchema.safeParse(row.acceptedBasis)
  if (!parsed.success)
    throw new UnprocessableEntityError('That payment’s frozen accounting basis is unreadable')

  // 🛑 A second void of the same receipt would post a second reversal and
  // double the correction. The chain is the record of what has already been
  // undone; anything on it means this movement is already corrected.
  const [existingCorrection] = await tx
    .select({ id: schema.AccountingWork.id })
    .from(schema.AccountingWork)
    .where(
      and(
        eq(schema.AccountingWork.organizationId, organizationId),
        eq(schema.AccountingWork.correctsEffectId, row.effectId)
      )
    )
    .limit(1)
  if (existingCorrection) throw new ConflictError('That payment has already been corrected')

  return { ...row, basis: parsed.data }
}

/**
 * Void one recorded payment.
 *
 * **Never throws for accounting reasons** — refusals come back as a
 * {@link PostResult}-shaped error the caller surfaces, for the same reason the
 * rest of the money lane holds to it. Input and conflict errors DO throw: a
 * double void is a caller bug, not a bookkeeping outcome.
 */
export async function voidInvoicePayment(
  db: Database,
  input: VoidInvoicePaymentInput
): Promise<VoidInvoicePaymentResult> {
  if (!(await isAccountingEnabled(db, input.organizationId)))
    throw new UnprocessableEntityError('Accounting is not enabled for this organization')

  const result = await runMoneyCommand(
    db,
    {
      organizationId: input.organizationId,
      userId: input.userId,
      commandKey: input.commandKey,
      kind: 'void_invoice_payment',
      payload: { moneyTransactionId: input.moneyTransactionId, reason: input.reason ?? null },
    },
    async (tx, commandId) => {
      const receipt = await readAcceptedReceipt(tx, input.organizationId, input.moneyTransactionId)

      // The exact negation, account for account — `assertCorrectionNegatesOriginal`
      // in `accept-entry.ts` re-checks this against the frozen original and
      // refuses anything that is not a true reversal.
      const lines: GlPostingLineInput[] = receipt.basis.contribution.map((line, index) => ({
        sourceType: 'money_transaction',
        sourceId: input.moneyTransactionId,
        glAccountId: line.glAccountId,
        direction: line.direction === 'debit' ? ('credit' as const) : ('debit' as const),
        amount: Number(line.amountMinor),
        sortOrder: index,
        memo: input.reason?.trim() || 'Payment recorded in error',
        ...(line.counterpartyType && line.counterpartyId
          ? { counterpartyType: line.counterpartyType, counterpartyId: line.counterpartyId }
          : {}),
        ...(Object.keys(line.dimensions ?? {}).length ? { dimensions: line.dimensions } : {}),
      })) as GlPostingLineInput[]

      // 🛑 The CORRECTION's own day, not the receipt's. The receipt was true on
      // the day it posted; today is the day we learned it was not. Backdating
      // would move money out of a period somebody may already have closed.
      const effectiveDate = new Date().toISOString().split('T')[0]!
      const entry = buildEntry({
        postingType: 'payment',
        periodKey: effectiveDate,
        txnDate: effectiveDate,
        lines,
      })

      const componentKey = accountingBasisHash({
        void: input.moneyTransactionId,
        command: input.commandKey,
      })
      const [work] = await tx
        .insert(schema.AccountingWork)
        .values({
          organizationId: input.organizationId,
          moneyTransactionId: input.moneyTransactionId,
          effectKind: 'customer_receipt',
          effectKey: customerReceiptCorrectionAccountingEffectKey(
            receipt.effectId,
            input.commandKey,
            componentKey
          ),
          componentKey,
          operation: 'correction',
          correctsEffectId: receipt.effectId,
          basisVersion: 1,
          state: 'pending',
          eligibility: 'manual',
        })
        .returning()
      if (!work) throw new Error('Correction work insert returned no row')

      // The correction's INPUT basis names the same calculation as the original
      // — same money, same invoice, same amount. What differs is the
      // contribution, which is the reversal.
      const workBasis = {
        version: 1 as const,
        status: 'ready' as const,
        moneyTransactionId: input.moneyTransactionId,
        sourceHash: receipt.basis.sourceHash,
        effectiveDate,
        calculation: receipt.basis.calculation,
      }
      await tx.insert(schema.AccountingWorkBasis).values({
        organizationId: input.organizationId,
        workId: work.id,
        version: 1,
        sourceHash: receipt.basis.sourceHash,
        effectiveDate,
        basis: workBasis,
      })

      const acceptedBasis = {
        ...receipt.basis,
        sourceBasisVersion: 1,
        effectiveDate,
        contribution: lines.map((line, index) => ({
          lineKey: `line:${index}`,
          glAccountId: line.glAccountId!,
          direction: line.direction,
          amountMinor: String(line.amount),
          counterpartyType: line.counterpartyType ?? null,
          counterpartyId: line.counterpartyId ?? null,
          dimensions: line.dimensions ?? {},
        })),
        accountResolution: lines.map((line, index) => ({
          lineKey: `line:${index}`,
          glAccountId: line.glAccountId!,
          accountRole: null,
          selectedBy: 'original_effect' as const,
          configurationHash: receipt.basis.sourceHash,
        })),
      }

      const accepted = await acceptEntryInTx(
        tx,
        {
          organizationId: input.organizationId,
          actorUserId: input.userId,
          memo: `Payment voided - movement ${input.moneyTransactionId}`,
          entry,
          members: [
            {
              workId: work.id,
              expectedBasisVersion: 1,
              acceptedBasis,
              // First correction against this original; the chain is empty.
              expectedCorrectionHeadId: null,
            },
          ],
          deliveryIntent: await resolveFulfillmentDeliveryIntentInTx(
            tx,
            input.organizationId,
            entry.txnDate
          ),
        },
        {
          revalidateMemberInTx: async () => acceptedBasis,
        }
      )
      if (accepted.status !== 'accepted' || !accepted.glPostingId)
        throw new ConflictError('Void accounting membership changed')

      // 🔑 Free the invoice. Without this the receivable is relieved in the
      // ledger and still shows as settled on the document — the two halves must
      // move together or the invoice can never be paid again.
      const applications = await tx.query.MoneyApplication.findMany({
        where: and(
          eq(schema.MoneyApplication.organizationId, input.organizationId),
          eq(schema.MoneyApplication.moneyTransactionId, input.moneyTransactionId),
          eq(schema.MoneyApplication.operation, 'apply')
        ),
      })
      for (const [index, application] of applications.entries())
        await tx.insert(schema.MoneyApplication).values({
          organizationId: input.organizationId,
          moneyTransactionId: input.moneyTransactionId,
          operation: 'unapply',
          amountMinor: application.amountMinor,
          invoiceInstanceId: application.invoiceInstanceId,
          orderInstanceId: application.orderInstanceId,
          vendorBillInstanceId: application.vendorBillInstanceId,
          appliedAt: new Date(),
          effectiveDate,
          reversesApplicationId: application.id,
          commandId,
          commandItemKey: `unapply:${index}`,
        })

      await planAccountingDeliveryInTx(tx, {
        organizationId: input.organizationId,
        glPostingId: accepted.glPostingId,
      })
      return { correctionWorkId: work.id, glPostingId: accepted.glPostingId }
    }
  )

  try {
    await deliverAccountingPosting(db, {
      organizationId: input.organizationId,
      glPostingId: result.glPostingId,
    })
  } catch (error) {
    logger.warn('An accepted payment void awaits delivery recovery', {
      organizationId: input.organizationId,
      glPostingId: result.glPostingId,
      error: error instanceof AuxxError ? error.message : String(error),
    })
  }
  return result
}
