// packages/lib/src/postings/credit-effect-work.ts

import { schema, type Transaction } from '@auxx/database'
import { and, eq, isNull } from 'drizzle-orm'
import { ConflictError, UnprocessableEntityError } from '../errors'
import { withAccountingCommitLock } from './accounting-commit-lock'
import {
  type CustomerCreditWorkBasisInput,
  customerCreditWorkBasisSchema,
} from './credit-effect-types'
import { accountingBasisHash } from './effect-basis'

/** Input for creating the original customer-credit accounting obligation. */
export interface CaptureCustomerCreditWorkInput {
  organizationId: string
  creditMemoInstanceId: string
  eligibility: 'automatic' | 'manual' | 'excluded'
  basis: CustomerCreditWorkBasisInput
}

/** Stable original identity for one issued credit entitlement. */
export function customerCreditAccountingEffectKey(creditMemoInstanceId: string): string {
  if (!creditMemoInstanceId) throw new UnprocessableEntityError('A credit memo ID is required')
  return 'customer_credit_issued:' + JSON.stringify([creditMemoInstanceId, 'original'])
}

async function assertCreditMemo(
  tx: Transaction,
  organizationId: string,
  creditMemoInstanceId: string
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
        eq(schema.EntityInstance.id, creditMemoInstanceId),
        eq(schema.EntityDefinition.entityType, 'credit_memo'),
        isNull(schema.EntityInstance.archivedAt),
        isNull(schema.EntityDefinition.archivedAt)
      )
    )
    .limit(1)
  if (!source)
    throw new UnprocessableEntityError(
      'Accounting work requires a live credit memo in this organization'
    )
}

/**
 * Capture an issued credit memo's original work and selected input basis.
 *
 * The caller owns the surrounding domain transaction. This helper only records the durable
 * obligation; accepted journals are created later by `acceptEntryInTx` under the same lock.
 */
export async function captureCustomerCreditWorkInTx(
  tx: Transaction,
  input: CaptureCustomerCreditWorkInput
) {
  const basis = customerCreditWorkBasisSchema.parse(input.basis)
  if (basis.creditMemoInstanceId !== input.creditMemoInstanceId)
    throw new ConflictError('Work source differs from its input basis')
  await withAccountingCommitLock(tx, input.organizationId)
  await assertCreditMemo(tx, input.organizationId, input.creditMemoInstanceId)

  const effectKey = customerCreditAccountingEffectKey(input.creditMemoInstanceId)
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
    if (!saved) throw new ConflictError('The selected credit accounting basis is missing')
    if (accountingBasisHash(saved.basis) === accountingBasisHash(basis))
      return { work: existing, basis: saved, existing: true }
    if (!['pending', 'blocked'].includes(existing.state))
      throw new ConflictError(
        'Accepted credit work already exists with a different basis; create a correction'
      )
    const accepted = await tx.query.AccountingEffect.findFirst({
      where: and(
        eq(schema.AccountingEffect.organizationId, input.organizationId),
        eq(schema.AccountingEffect.workId, existing.id)
      ),
    })
    if (accepted) throw new ConflictError('Accepted credit accounting requires a correction')
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
    if (!nextBasis || !updated) throw new Error('Credit accounting basis update returned no row')
    return { work: updated, basis: nextBasis, existing: true }
  }

  const [work] = await tx
    .insert(schema.AccountingWork)
    .values({
      organizationId: input.organizationId,
      entityInstanceId: input.creditMemoInstanceId,
      effectKind: 'customer_credit_issued',
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

/** Build the entitlement calculation from the issue-domain facts. */
export function customerCreditBasisFromMemo(input: {
  creditMemoInstanceId: string
  source: 'native' | 'channel'
  number: string
  contactInstanceId: string | null
  invoiceInstanceId: string | null
  orderInstanceId: string | null
  sourceStoreId: string | null
  creditControlGlAccountId: string
  issuedAt: string
  subtotalMinor: number
  taxTotalMinor: number
  totalMinor: number
  sourceHash: string
  reverseRevenue: boolean
  components: Array<{
    componentKey: 'earned_revenue' | 'customer_deposit' | 'sales_tax'
    accountRole: 'revenue_returns_allowances' | 'customer_deposits' | 'sales_tax_payable'
    direction: 'debit'
    amountMinor: number
  }>
  sourceAllocations: Array<{
    effectId: string
    lineKey: string
    amountMinor: number
    componentKey: 'earned_revenue' | 'customer_deposit' | 'sales_tax'
  }>
}): Extract<CustomerCreditWorkBasisInput, { status: 'ready' }> {
  const calculation = {
    version: 1 as const,
    creditMemoInstanceId: input.creditMemoInstanceId,
    sourceHash: input.sourceHash,
    source: input.source,
    number: input.number,
    contactInstanceId: input.contactInstanceId,
    invoiceInstanceId: input.invoiceInstanceId,
    orderInstanceId: input.orderInstanceId,
    sourceStoreId: input.sourceStoreId,
    creditControlGlAccountId: input.creditControlGlAccountId,
    issuedAt: input.issuedAt,
    effectiveDate: input.issuedAt,
    currency: 'USD' as const,
    currencyExponent: 2 as const,
    subtotalMinor: String(input.subtotalMinor),
    taxTotalMinor: String(input.taxTotalMinor),
    totalMinor: String(input.totalMinor),
    reverseRevenue: input.reverseRevenue,
    components: input.components.map((component) => ({
      ...component,
      amountMinor: String(component.amountMinor),
    })),
    sourceAllocations: input.sourceAllocations.map((allocation) => ({
      ...allocation,
      amountMinor: String(allocation.amountMinor),
    })),
  }
  return customerCreditWorkBasisSchema.parse({
    version: 1,
    status: 'ready',
    creditMemoInstanceId: input.creditMemoInstanceId,
    sourceHash: input.sourceHash,
    effectiveDate: input.issuedAt,
    calculation,
  }) as Extract<CustomerCreditWorkBasisInput, { status: 'ready' }>
}
