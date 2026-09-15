// packages/lib/src/postings/effect-work.ts
import { schema, type Transaction } from '@auxx/database'
import { and, eq, isNull } from 'drizzle-orm'
import { ConflictError, UnprocessableEntityError } from '../errors'
import { withAccountingCommitLock } from './accounting-commit-lock'
import {
  accountingBasisHash,
  customerReceiptAccountingEffectKey,
  fulfillmentAccountingEffectKey,
} from './effect-basis'
import {
  type AccountingWorkBasisInput,
  type CustomerReceiptWorkBasisInput,
  customerReceiptWorkBasisSchema,
  fulfillmentWorkBasisSchema,
} from './effect-types'

/** Create inputs carry evidence, never a caller-selected original effect identity. */
export interface CaptureFulfillmentWorkInput {
  organizationId: string
  fulfillmentInstanceId: string
  eligibility: 'automatic' | 'manual' | 'excluded'
  basis: AccountingWorkBasisInput
}

async function assertFulfillment(
  tx: Transaction,
  organizationId: string,
  entityInstanceId: string
) {
  const [source] = await tx
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
        eq(schema.EntityInstance.id, entityInstanceId),
        eq(schema.EntityDefinition.entityType, 'fulfillment'),
        isNull(schema.EntityInstance.archivedAt),
        isNull(schema.EntityDefinition.archivedAt)
      )
    )
    .limit(1)
  if (!source)
    throw new UnprocessableEntityError(
      'Accounting work requires a live fulfillment in this organization'
    )
}

/**
 * Capture the original obligation and its first input in the caller's transaction.
 * A replay must match the selected basis. Changed evidence uses appendFulfillmentWorkBasisInTx;
 * an old initial payload replayed after an append is a conflict, never a second original.
 */
export async function captureFulfillmentWorkInTx(
  tx: Transaction,
  input: CaptureFulfillmentWorkInput
) {
  const basis = fulfillmentWorkBasisSchema.parse(input.basis)
  if (basis.fulfillmentInstanceId !== input.fulfillmentInstanceId)
    throw new ConflictError('Work source differs from its input basis')
  await withAccountingCommitLock(tx, input.organizationId)
  await assertFulfillment(tx, input.organizationId, input.fulfillmentInstanceId)
  const effectKey = fulfillmentAccountingEffectKey(input.fulfillmentInstanceId)
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
    if (!saved || accountingBasisHash(saved.basis) !== accountingBasisHash(basis))
      throw new ConflictError(
        'Original work already exists with a different basis; append a version or create a correction'
      )
    return { work: existing, basis: saved, existing: true }
  }
  const [work] = await tx
    .insert(schema.AccountingWork)
    .values({
      organizationId: input.organizationId,
      entityInstanceId: input.fulfillmentInstanceId,
      effectKind: 'fulfillment_accounting',
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

/** Append corrected pending evidence; accepted obligations can only change through correction work. */
export async function appendFulfillmentWorkBasisInTx(
  tx: Transaction,
  input: {
    organizationId: string
    workId: string
    expectedBasisVersion: number
    basis: AccountingWorkBasisInput
  }
) {
  const basis = fulfillmentWorkBasisSchema.parse(input.basis)
  await withAccountingCommitLock(tx, input.organizationId)
  const [work] = await tx
    .select()
    .from(schema.AccountingWork)
    .where(
      and(
        eq(schema.AccountingWork.organizationId, input.organizationId),
        eq(schema.AccountingWork.id, input.workId)
      )
    )
    .for('update')
  if (!work || !['pending', 'blocked'].includes(work.state))
    throw new ConflictError('Only pending or blocked work can select a new input version')
  if (work.entityInstanceId !== basis.fulfillmentInstanceId)
    throw new ConflictError('Cannot change the accounting source owner')
  await assertFulfillment(tx, input.organizationId, work.entityInstanceId)
  const accepted = await tx.query.AccountingEffect.findFirst({
    where: and(
      eq(schema.AccountingEffect.organizationId, input.organizationId),
      eq(schema.AccountingEffect.workId, work.id)
    ),
  })
  if (accepted) throw new ConflictError('Accepted accounting requires a correction')
  const current = await tx.query.AccountingWorkBasis.findFirst({
    where: and(
      eq(schema.AccountingWorkBasis.organizationId, input.organizationId),
      eq(schema.AccountingWorkBasis.workId, work.id),
      eq(schema.AccountingWorkBasis.version, work.basisVersion)
    ),
  })
  if (!current) throw new ConflictError('The selected accounting basis is missing')
  if (accountingBasisHash(current.basis) === accountingBasisHash(basis)) return current
  if (work.basisVersion !== input.expectedBasisVersion)
    throw new ConflictError('The accounting basis changed; reload before updating')
  const version = work.basisVersion + 1
  const [saved] = await tx
    .insert(schema.AccountingWorkBasis)
    .values({
      organizationId: input.organizationId,
      workId: work.id,
      version,
      sourceHash: basis.sourceHash,
      effectiveDate: basis.effectiveDate,
      basis,
    })
    .returning()
  await tx
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
        eq(schema.AccountingWork.id, work.id)
      )
    )
  if (!saved) throw new Error('Accounting basis insert returned no row')
  return saved
}

/** Create inputs carry evidence; the original receipt identity comes from the money row. */
export interface CaptureCustomerReceiptWorkInput {
  organizationId: string
  moneyTransactionId: string
  eligibility: 'automatic' | 'manual' | 'excluded'
  basis: CustomerReceiptWorkBasisInput
}

async function assertCustomerReceipt(
  tx: Transaction,
  organizationId: string,
  moneyTransactionId: string
) {
  const [money] = await tx
    .select({ id: schema.MoneyTransaction.id, purpose: schema.MoneyTransaction.purpose })
    .from(schema.MoneyTransaction)
    .where(
      and(
        eq(schema.MoneyTransaction.organizationId, organizationId),
        eq(schema.MoneyTransaction.id, moneyTransactionId)
      )
    )
    .limit(1)
  if (!money || money.purpose !== 'customer_receipt')
    throw new UnprocessableEntityError(
      'Accounting work requires a customer receipt in this organization'
    )
}

/** Capture one original customer-receipt accounting obligation. */
export async function captureCustomerReceiptWorkInTx(
  tx: Transaction,
  input: CaptureCustomerReceiptWorkInput
) {
  const basis = customerReceiptWorkBasisSchema.parse(input.basis)
  if (basis.moneyTransactionId !== input.moneyTransactionId)
    throw new ConflictError('Work source differs from its receipt basis')
  await withAccountingCommitLock(tx, input.organizationId)
  await assertCustomerReceipt(tx, input.organizationId, input.moneyTransactionId)
  const effectKey = customerReceiptAccountingEffectKey(input.moneyTransactionId)
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
    if (!saved || accountingBasisHash(saved.basis) !== accountingBasisHash(basis))
      throw new ConflictError(
        'Original receipt work already exists with a different basis; append a version or create a correction'
      )
    return { work: existing, basis: saved, existing: true }
  }
  const [work] = await tx
    .insert(schema.AccountingWork)
    .values({
      organizationId: input.organizationId,
      moneyTransactionId: input.moneyTransactionId,
      effectKind: 'customer_receipt',
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

/** Append corrected pending receipt evidence; accepted receipts require correction work. */
export async function appendCustomerReceiptWorkBasisInTx(
  tx: Transaction,
  input: {
    organizationId: string
    workId: string
    expectedBasisVersion: number
    basis: CustomerReceiptWorkBasisInput
  }
) {
  const basis = customerReceiptWorkBasisSchema.parse(input.basis)
  await withAccountingCommitLock(tx, input.organizationId)
  const [work] = await tx
    .select()
    .from(schema.AccountingWork)
    .where(
      and(
        eq(schema.AccountingWork.organizationId, input.organizationId),
        eq(schema.AccountingWork.id, input.workId)
      )
    )
    .for('update')
  if (!work || !['pending', 'blocked'].includes(work.state))
    throw new ConflictError('Only pending or blocked work can select a new input version')
  if (
    work.effectKind !== 'customer_receipt' ||
    work.moneyTransactionId !== basis.moneyTransactionId
  )
    throw new ConflictError('Cannot change the accounting source owner')
  await assertCustomerReceipt(tx, input.organizationId, work.moneyTransactionId!)
  const accepted = await tx.query.AccountingEffect.findFirst({
    where: and(
      eq(schema.AccountingEffect.organizationId, input.organizationId),
      eq(schema.AccountingEffect.workId, work.id)
    ),
  })
  if (accepted) throw new ConflictError('Accepted accounting requires a correction')
  const current = await tx.query.AccountingWorkBasis.findFirst({
    where: and(
      eq(schema.AccountingWorkBasis.organizationId, input.organizationId),
      eq(schema.AccountingWorkBasis.workId, work.id),
      eq(schema.AccountingWorkBasis.version, work.basisVersion)
    ),
  })
  if (!current) throw new ConflictError('The selected accounting basis is missing')
  if (accountingBasisHash(current.basis) === accountingBasisHash(basis)) return current
  if (work.basisVersion !== input.expectedBasisVersion)
    throw new ConflictError('The accounting basis changed; reload before updating')
  const version = work.basisVersion + 1
  const [saved] = await tx
    .insert(schema.AccountingWorkBasis)
    .values({
      organizationId: input.organizationId,
      workId: work.id,
      version,
      sourceHash: basis.sourceHash,
      effectiveDate: basis.effectiveDate,
      basis,
    })
    .returning()
  await tx
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
        eq(schema.AccountingWork.id, input.workId)
      )
    )
  if (!saved) throw new Error('Accounting basis insert returned no row')
  return saved
}
