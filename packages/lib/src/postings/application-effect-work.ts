// packages/lib/src/postings/application-effect-work.ts

import { schema, type Transaction } from '@auxx/database'
import { and, eq, isNotNull } from 'drizzle-orm'
import { ConflictError, UnprocessableEntityError } from '../errors'
import { withAccountingCommitLock } from './accounting-commit-lock'
import {
  type MoneyApplicationWorkBasisInput,
  moneyApplicationWorkBasisSchema,
} from './application-effect-types'
import { accountingBasisHash } from './effect-basis'

/**
 * Stable original identity for one money application's accounting obligation.
 *
 * 🔑 Keyed on the APPLICATION, never on the movement. One receipt applied to
 * three invoices is three events on three days, and keying on the movement would
 * let the first swallow the other two — the same mistake the dispatch-era
 * `depositApplicationPeriodKey` avoids by keying on its allocation row.
 *
 * Deliberately excludes the date, the amount and the input hash, exactly as
 * `customerReceiptAccountingEffectKey` does: an application re-dated before it
 * posts is the SAME obligation with a new basis version, not a second one.
 */
export function moneyApplicationAccountingEffectKey(moneyApplicationId: string): string {
  if (!moneyApplicationId) throw new UnprocessableEntityError('A money application ID is required')
  return 'deposit_application:' + JSON.stringify([moneyApplicationId, 'original'])
}

/** Create inputs carry evidence; the original identity comes from the application. */
export interface CaptureMoneyApplicationWorkInput {
  organizationId: string
  /** The `MoneyApplication` row this obligation is for. */
  moneyApplicationId: string
  /** Its `MoneyTransaction` — the `AccountingWork` owner column. */
  moneyTransactionId: string
  eligibility: 'automatic' | 'manual' | 'excluded'
  basis: MoneyApplicationWorkBasisInput
}

/**
 * Refuse anything that is not a live invoice APPLICATION of the named movement.
 *
 * ⚠️ `operation: 'unapply'` is excluded on purpose. An unapplication reverses an
 * earlier apply and its accounting is the correction of that effect, not a
 * second original reclass in the same direction.
 */
async function assertMoneyApplication(
  tx: Transaction,
  organizationId: string,
  moneyApplicationId: string,
  moneyTransactionId: string
) {
  const [application] = await tx
    .select({ id: schema.MoneyApplication.id })
    .from(schema.MoneyApplication)
    .where(
      and(
        eq(schema.MoneyApplication.organizationId, organizationId),
        eq(schema.MoneyApplication.id, moneyApplicationId),
        eq(schema.MoneyApplication.moneyTransactionId, moneyTransactionId),
        eq(schema.MoneyApplication.operation, 'apply'),
        isNotNull(schema.MoneyApplication.invoiceInstanceId)
      )
    )
    .limit(1)
  if (!application)
    throw new UnprocessableEntityError(
      'Accounting work requires a live invoice application of this movement'
    )
}

/**
 * Capture one application's original obligation and its selected input basis.
 *
 * The caller owns the surrounding domain transaction; this only records the
 * durable obligation. The accepted journal is created later by `acceptEntryInTx`
 * under the same commit lock.
 *
 * Replay is convergent: an identical basis returns the saved row, and changed
 * evidence on a still-pending obligation appends a version rather than minting a
 * second original. An obligation that has already been ACCEPTED refuses, because
 * an accepted effect is immutable and the only way past it is a correction.
 */
export async function captureMoneyApplicationWorkInTx(
  tx: Transaction,
  input: CaptureMoneyApplicationWorkInput
) {
  const basis = moneyApplicationWorkBasisSchema.parse(input.basis)
  if (basis.moneyApplicationId !== input.moneyApplicationId)
    throw new ConflictError('Work source differs from its input basis')
  if (basis.moneyTransactionId !== input.moneyTransactionId)
    throw new ConflictError('Work movement differs from its input basis')
  await withAccountingCommitLock(tx, input.organizationId)
  await assertMoneyApplication(
    tx,
    input.organizationId,
    input.moneyApplicationId,
    input.moneyTransactionId
  )

  const effectKey = moneyApplicationAccountingEffectKey(input.moneyApplicationId)
  const existing = await tx.query.AccountingWork.findFirst({
    where: and(
      eq(schema.AccountingWork.organizationId, input.organizationId),
      eq(schema.AccountingWork.effectKey, effectKey)
    ),
  })
  if (existing) {
    const saved = await tx.query.AccountingWorkBasis.findFirst({
      where: and(
        eq(schema.AccountingWorkBasis.organizationId, input.organizationId),
        eq(schema.AccountingWorkBasis.workId, existing.id),
        eq(schema.AccountingWorkBasis.version, existing.basisVersion)
      ),
    })
    if (!saved) throw new ConflictError('The selected application accounting basis is missing')
    if (accountingBasisHash(saved.basis) === accountingBasisHash(basis))
      return { work: existing, basis: saved, existing: true }
    if (!['pending', 'blocked'].includes(existing.state))
      throw new ConflictError(
        'Accepted application work already exists with a different basis; create a correction'
      )
    const accepted = await tx.query.AccountingEffect.findFirst({
      where: and(
        eq(schema.AccountingEffect.organizationId, input.organizationId),
        eq(schema.AccountingEffect.workId, existing.id)
      ),
    })
    if (accepted) throw new ConflictError('Accepted application accounting requires a correction')
    const version = existing.basisVersion + 1
    const [nextBasis] = await tx
      .insert(schema.AccountingWorkBasis)
      .values({
        organizationId: input.organizationId,
        workId: existing.id,
        version,
        sourceHash: basis.sourceHash,
        effectiveDate: basis.effectiveDate,
        basis,
      })
      .returning()
    const [updated] = await tx
      .update(schema.AccountingWork)
      .set({
        basisVersion: version,
        state: basis.status === 'ready' ? 'pending' : 'blocked',
        blockedReason: basis.status === 'incomplete' ? basis.missingDependencies.join(', ') : null,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(schema.AccountingWork.organizationId, input.organizationId),
          eq(schema.AccountingWork.id, existing.id)
        )
      )
      .returning()
    if (!nextBasis || !updated)
      throw new Error('Application accounting basis update returned no row')
    return { work: updated, basis: nextBasis, existing: true }
  }

  const [work] = await tx
    .insert(schema.AccountingWork)
    .values({
      organizationId: input.organizationId,
      // 🛑 Money-owned: the movement is the owner and `entityInstanceId` stays
      // null. The invoice is a REFERENCE and lives in the calculation and in
      // `documentRefs`. See the header of `application-effect-types.ts`.
      moneyTransactionId: input.moneyTransactionId,
      effectKind: 'deposit_application',
      componentKey: 'original',
      effectKey,
      operation: 'original',
      basisVersion: 1,
      state: basis.status === 'ready' ? 'pending' : 'blocked',
      eligibility: input.eligibility,
      blockedReason: basis.status === 'incomplete' ? basis.missingDependencies.join(', ') : null,
    })
    .returning()
  if (!work) throw new Error('Accounting work insert returned no row')

  const [saved] = await tx
    .insert(schema.AccountingWorkBasis)
    .values({
      organizationId: input.organizationId,
      workId: work.id,
      version: 1,
      sourceHash: basis.sourceHash,
      effectiveDate: basis.effectiveDate,
      basis,
    })
    .returning()
  if (!saved) throw new Error('Accounting basis insert returned no row')
  return { work, basis: saved, existing: false }
}
