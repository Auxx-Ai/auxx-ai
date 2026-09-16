// packages/lib/src/money/invoices/unapply-money.ts

/**
 * Taking applied money back off an invoice, so it is held again
 * (plans/accounting/tasks/54-one-money-model.md unit 3).
 *
 * ```
 *   Dr accounts_receivable      the unapplied amount
 *       Cr customer_deposits      the same
 * ```
 *
 * The mirror of `apply-money.ts`, and the first half of
 * `move-payment.ts`. The invoice goes back to owing what it owed; the money
 * goes back to being a liability the business holds.
 *
 * ## 🔑 It is a CORRECTION of the application, not a new event
 *
 * `deposit_application`'s own contract says a second application is not a
 * correction (`application-effect-types.ts:30`) — applying more money later is
 * genuinely new. But taking an application BACK says the first one should not
 * have been made, which is exactly what `operation: 'correction'` means. So
 * this posts as a correction of the `deposit_application` effect and inherits
 * `accept-entry.ts`'s guarantee that the entry it posts is the exact reversal
 * of the one it names.
 *
 * ⚠️ That guarantee is why this module builds no entry of its own: it reads the
 * frozen contribution off the accepted effect and flips it. A hand-built
 * `Dr A/R Cr customer_deposits` could silently disagree with what was actually
 * posted — a different receivable counterparty, say — and the negation check
 * would refuse it. Reading the original is both simpler and correct.
 *
 * @see plans/accounting/tasks/54-one-money-model.md
 */

import { type Database, schema, type Transaction } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { and, eq } from 'drizzle-orm'
import { AuxxError, ConflictError, UnprocessableEntityError } from '../../errors'
import { acceptEntryInTx } from '../../postings/accept-entry'
import { isAccountingEnabled } from '../../postings/accounting-enabled'
import {
  acceptedMoneyApplicationEffectBasisSchema,
  MONEY_APPLICATION_POSTING_TYPE,
} from '../../postings/application-effect-types'
import { resolveFulfillmentDeliveryIntentInTx } from '../../postings/book-connections'
import { buildEntry } from '../../postings/build-entry'
import { deliverAccountingPosting, planAccountingDeliveryInTx } from '../../postings/delivery'
import { accountingBasisHash } from '../../postings/effect-basis'
import type { GlPostingLineInput } from '../../postings/types'
import { runMoneyCommand } from '../commands/run-money-command'

const logger = createScopedLogger('invoice-unapply-money')

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
 * The live `apply` row for this movement on this invoice, with its accepted
 * effect if one was ever posted.
 *
 * 🛑 An application already reversed by an `unapply` is not offered again — the
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
  // ⚠️ Whole rows only. A partial unapply would need the original split in two,
  // and splitting an accepted effect is not something the negation check can
  // express — it would no longer be an exact reversal.
  if (live.amountMinor !== amountMinor)
    throw new UnprocessableEntityError(
      `That application is for ${live.amountMinor} cents and can only be taken back in full`
    )

  const [effect] = await tx
    .select({
      effectId: schema.AccountingEffect.id,
      acceptedBasis: schema.AccountingEffect.acceptedBasis,
      workId: schema.AccountingWork.id,
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
        eq(schema.AccountingWork.effectKind, 'deposit_application'),
        eq(
          schema.AccountingWork.effectKey,
          'deposit_application:' + JSON.stringify([live.id, 'original'])
        )
      )
    )
    .limit(1)
  return { live, effect }
}

/**
 * Take money back off an invoice.
 *
 * 🔑 The application row is written whether or not a journal exists to reverse.
 * An application made while accounting was off has no effect to correct, and
 * refusing to unapply it would strand the money on an invoice forever.
 */
export async function unapplyMoneyFromInvoice(
  db: Database,
  input: UnapplyMoneyFromInvoiceInput
): Promise<UnapplyMoneyFromInvoiceResult> {
  const accountingOn = await isAccountingEnabled(db, input.organizationId)

  const result = await runMoneyCommand(
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
      const { live, effect } = await readLiveApplication(
        tx,
        input.organizationId,
        input.moneyTransactionId,
        input.invoiceInstanceId,
        BigInt(input.amountMinor)
      )

      const [row] = await tx
        .insert(schema.MoneyApplication)
        .values({
          organizationId: input.organizationId,
          moneyTransactionId: input.moneyTransactionId,
          operation: 'unapply',
          amountMinor: live.amountMinor,
          invoiceInstanceId: input.invoiceInstanceId,
          appliedAt: new Date(),
          effectiveDate: input.effectiveDate,
          reversesApplicationId: live.id,
          commandId,
          commandItemKey: 'unapply_from_invoice',
        })
        .returning({ id: schema.MoneyApplication.id })
      if (!row) throw new Error('Money unapplication insert returned no row')
      if (!accountingOn || !effect) return { unappliedApplicationId: row.id, glPostingId: '' }

      const parsed = acceptedMoneyApplicationEffectBasisSchema.safeParse(effect.acceptedBasis)
      if (!parsed.success)
        throw new UnprocessableEntityError('The application’s frozen basis is unreadable')
      const [already] = await tx
        .select({ id: schema.AccountingWork.id })
        .from(schema.AccountingWork)
        .where(
          and(
            eq(schema.AccountingWork.organizationId, input.organizationId),
            eq(schema.AccountingWork.correctsEffectId, effect.effectId)
          )
        )
        .limit(1)
      if (already) throw new ConflictError('That application has already been corrected')

      // Read the frozen contribution and flip it — see the file header on why
      // this is never hand-built.
      const lines = parsed.data.contribution.map((line, index) => ({
        sourceType: 'money_transaction',
        sourceId: input.moneyTransactionId,
        glAccountId: line.glAccountId,
        direction: line.direction === 'debit' ? ('credit' as const) : ('debit' as const),
        amount: Number(line.amountMinor),
        sortOrder: index,
        memo: 'Payment taken back off this invoice',
        ...(line.counterpartyType && line.counterpartyId
          ? { counterpartyType: line.counterpartyType, counterpartyId: line.counterpartyId }
          : {}),
        ...(Object.keys(line.dimensions ?? {}).length ? { dimensions: line.dimensions } : {}),
      })) as GlPostingLineInput[]

      const entry = buildEntry({
        postingType: MONEY_APPLICATION_POSTING_TYPE,
        periodKey: input.effectiveDate,
        txnDate: input.effectiveDate,
        lines,
      })
      const componentKey = accountingBasisHash({
        unapply: live.id,
        command: input.commandKey,
      })
      const [work] = await tx
        .insert(schema.AccountingWork)
        .values({
          organizationId: input.organizationId,
          moneyTransactionId: input.moneyTransactionId,
          effectKind: 'deposit_application',
          effectKey:
            'deposit_application:correction:' +
            JSON.stringify([effect.effectId, input.commandKey, componentKey]),
          componentKey,
          operation: 'correction',
          correctsEffectId: effect.effectId,
          basisVersion: 1,
          state: 'pending',
          eligibility: 'manual',
        })
        .returning()
      if (!work) throw new Error('Unapply correction work insert returned no row')

      await tx.insert(schema.AccountingWorkBasis).values({
        organizationId: input.organizationId,
        workId: work.id,
        version: 1,
        sourceHash: parsed.data.sourceHash,
        effectiveDate: input.effectiveDate,
        basis: {
          version: 1 as const,
          status: 'ready' as const,
          moneyApplicationId: live.id,
          moneyTransactionId: input.moneyTransactionId,
          sourceHash: parsed.data.sourceHash,
          effectiveDate: input.effectiveDate,
          calculation: parsed.data.calculation,
        },
      })

      const acceptedBasis = {
        ...parsed.data,
        sourceBasisVersion: 1,
        effectiveDate: input.effectiveDate,
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
          configurationHash: parsed.data.sourceHash,
        })),
      }

      const accepted = await acceptEntryInTx(
        tx,
        {
          organizationId: input.organizationId,
          actorUserId: input.userId,
          memo: `Payment unapplied - movement ${input.moneyTransactionId}`,
          entry,
          members: [
            {
              workId: work.id,
              expectedBasisVersion: 1,
              acceptedBasis,
              expectedCorrectionHeadId: null,
            },
          ],
          deliveryIntent: await resolveFulfillmentDeliveryIntentInTx(
            tx,
            input.organizationId,
            entry.txnDate
          ),
        },
        { revalidateMemberInTx: async () => acceptedBasis }
      )
      if (accepted.status !== 'accepted' || !accepted.glPostingId)
        throw new ConflictError('Unapply accounting membership changed')
      await planAccountingDeliveryInTx(tx, {
        organizationId: input.organizationId,
        glPostingId: accepted.glPostingId,
      })
      return { unappliedApplicationId: row.id, glPostingId: accepted.glPostingId }
    }
  )

  if (result.glPostingId)
    try {
      await deliverAccountingPosting(db, {
        organizationId: input.organizationId,
        glPostingId: result.glPostingId,
      })
    } catch (error) {
      logger.warn('An accepted unapply awaits delivery recovery', {
        organizationId: input.organizationId,
        glPostingId: result.glPostingId,
        error: error instanceof AuxxError ? error.message : String(error),
      })
    }
  return { unappliedApplicationId: result.unappliedApplicationId }
}
