// packages/lib/src/money/customer-money/refund-accounting.ts

import { type Database, schema, type Transaction } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { and, asc, eq, isNull, sql } from 'drizzle-orm'
import { z } from 'zod'
import { getCachedEntityDefId, getOrgCache } from '../../cache'
import { ConflictError, UnprocessableEntityError } from '../../errors'
import { acceptEntryInTx } from '../../postings/accept-entry'
import { withAccountingCommitLock } from '../../postings/accounting-commit-lock'
import { isAccountingEnabled } from '../../postings/accounting-enabled'
import { resolveFulfillmentDeliveryIntentInTx } from '../../postings/book-connections'
import { buildEntry } from '../../postings/build-entry'
import { acceptedCustomerCreditEffectBasisSchema } from '../../postings/credit-effect-types'
import { deliverAccountingPosting, planAccountingDeliveryInTx } from '../../postings/delivery'
import {
  accountingBasisHash,
  customerRefundAccountingEffectKey,
  fromLedgerMinor,
  toLedgerMinor,
} from '../../postings/effect-basis'
import { acceptedCustomerReceiptEffectBasisSchema } from '../../postings/effect-types'
import { periodKeyForDate } from '../../postings/periods'
import {
  acceptedCustomerRefundEffectBasisSchema,
  type CustomerRefundAccountingBasisV1,
  type CustomerRefundWorkBasisInput,
  customerRefundWorkBasisSchema,
} from '../../postings/refund-effect-types'
import { resolveAccountLines } from '../../postings/resolve-roles'
import { FINALIZED_SETUP_STATE } from '../../postings/setup-readiness'
import type { GlPostingLineInput } from '../../postings/types'
import { getOrganizationSetting } from '../../settings/settings-service'
import {
  loadCreditMemo,
  sumCreditMemoApplications,
  sumReservedCreditMemoRefunds,
} from '../credit-memos/reads'

const logger = createScopedLogger('customer-refund-accounting')

export interface CustomerRefundAccountingInput {
  organizationId: string
  moneyTransactionId: string
  actorUserId?: string
}

export type CustomerRefundAccountingResult =
  | { status: 'accepted'; glPostingId: string }
  | { status: 'blocked'; reason: string }
  | { status: 'skipped'; reason: string }

type Settlement = {
  id: string
  amountMinor: bigint
  disposition: 'customer_credit' | 'vendor_credit' | 'unapplied_money'
  customerCreditMemoInstanceId: string | null
  originalTransactionId: string | null
}

// 58 D5: `PaymentRoute` is manual-only now; a receipt-backed refund routes
// through the original's frozen rail (`readFrozenReceiptRoute`) instead.
type RouteResolution = {
  route:
    | {
        kind: 'manual'
        paymentRouteId: string
        method: string
        settlementCurrency: string
        endpointGlAccountId: string
      }
    | {
        kind: 'rail'
        paymentGatewayId: string
        settlementCurrency: string
        endpointGlAccountId: string
      }
  endpointGlAccountId: string
  effectiveDate?: string
}

/** Insert or reuse the durable original customer-refund work item. */
export async function captureCustomerRefundWorkInTx(
  tx: Transaction,
  input: {
    organizationId: string
    moneyTransactionId: string
    eligibility: 'automatic' | 'manual' | 'excluded'
    basis: CustomerRefundWorkBasisInput
  }
) {
  const basis = customerRefundWorkBasisSchema.parse(input.basis)
  if (basis.moneyTransactionId !== input.moneyTransactionId)
    throw new ConflictError('Work source differs from its refund basis')
  await withAccountingCommitLock(tx, input.organizationId)
  const money = await tx.query.MoneyTransaction.findFirst({
    where: and(
      eq(schema.MoneyTransaction.organizationId, input.organizationId),
      eq(schema.MoneyTransaction.id, input.moneyTransactionId),
      eq(schema.MoneyTransaction.purpose, 'customer_refund')
    ),
  })
  if (!money)
    throw new UnprocessableEntityError(
      'Accounting work requires a customer refund in this organization'
    )
  const effectKey = customerRefundAccountingEffectKey(input.moneyTransactionId)
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
    if (!saved) throw new ConflictError('The selected refund accounting basis is missing')
    if (accountingBasisHash(saved.basis) !== accountingBasisHash(basis)) {
      if (!['pending', 'blocked'].includes(existing.state))
        throw new ConflictError('Accepted refund accounting requires a correction')
      const accepted = await tx.query.AccountingEffect.findFirst({
        where: and(
          eq(schema.AccountingEffect.organizationId, input.organizationId),
          eq(schema.AccountingEffect.workId, existing.id)
        ),
      })
      if (accepted) throw new ConflictError('Accepted refund accounting requires a correction')
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
          blockedReason:
            basis.status === 'incomplete' ? basis.missingDependencies.join(', ') : null,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(schema.AccountingWork.organizationId, input.organizationId),
            eq(schema.AccountingWork.id, existing.id)
          )
        )
        .returning()
      if (!nextBasis || !updated) throw new Error('Refund accounting basis update returned no row')
      return {
        work: updated,
        basis: nextBasis,
        existing: false,
      }
    }
    return { work: existing, basis: saved, existing: true }
  }
  const [work] = await tx
    .insert(schema.AccountingWork)
    .values({
      organizationId: input.organizationId,
      moneyTransactionId: input.moneyTransactionId,
      effectKind: 'customer_refund',
      effectKey,
      operation: 'original',
      basisVersion: 1,
      state: basis.status === 'ready' ? 'pending' : 'blocked',
      eligibility: input.eligibility,
      blockedReason: basis.status === 'incomplete' ? basis.missingDependencies.join(', ') : null,
    })
    .returning()
  if (!work) throw new Error('Refund accounting work insert returned no row')
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
  if (!saved) throw new Error('Refund accounting basis insert returned no row')
  return { work, basis: saved, existing: false }
}

async function readRoute(
  tx: Transaction,
  organizationId: string,
  money: typeof schema.MoneyTransaction.$inferSelect
): Promise<RouteResolution> {
  if (!money.paymentRouteId)
    throw new UnprocessableEntityError('Refund payment route is unresolved')
  const route = await tx.query.PaymentRoute.findFirst({
    where: and(
      eq(schema.PaymentRoute.organizationId, organizationId),
      eq(schema.PaymentRoute.id, money.paymentRouteId),
      isNull(schema.PaymentRoute.archivedAt),
      eq(schema.PaymentRoute.settlementCurrency, money.currency)
    ),
  })
  if (!route)
    throw new UnprocessableEntityError(
      'Refund payment route is missing, archived or in another currency'
    )

  let endpointGlAccountId: string | null = null
  if (route.cashGlAccountInstanceId) {
    endpointGlAccountId = route.cashGlAccountInstanceId
  } else if (route.bankAccountInstanceId) {
    const bankDefId = await getCachedEntityDefId(organizationId, 'bank_account')
    const field = await getOrgCache()
      .from(organizationId, 'customFields')
      .bySystemAttributes(['bank_account_gl_account'])
    const fieldId = field.bank_account_gl_account?.id
    if (!bankDefId || !fieldId)
      throw new UnprocessableEntityError('Refund bank account mapping is not provisioned')
    const [bank] = await tx
      .select({ id: schema.EntityInstance.id, archivedAt: schema.EntityInstance.archivedAt })
      .from(schema.EntityInstance)
      .where(
        and(
          eq(schema.EntityInstance.organizationId, organizationId),
          eq(schema.EntityInstance.entityDefinitionId, bankDefId),
          eq(schema.EntityInstance.id, route.bankAccountInstanceId)
        )
      )
      .limit(1)
    if (!bank || bank.archivedAt)
      throw new UnprocessableEntityError('Refund bank account is missing or archived')
    const [mapping] = await tx
      .select({ valueText: schema.FieldValue.valueText })
      .from(schema.FieldValue)
      .where(
        and(
          eq(schema.FieldValue.organizationId, organizationId),
          eq(schema.FieldValue.entityId, bank.id),
          eq(schema.FieldValue.fieldId, fieldId)
        )
      )
      .limit(1)
    endpointGlAccountId = mapping?.valueText?.trim() || null
  }
  if (!endpointGlAccountId)
    throw new UnprocessableEntityError('Refund route has no explicit cash or clearing account')
  return {
    endpointGlAccountId,
    route: {
      kind: 'manual',
      paymentRouteId: route.id,
      method: route.method,
      settlementCurrency: route.settlementCurrency,
      endpointGlAccountId,
    },
  }
}

async function readFrozenReceiptRoute(
  tx: Transaction,
  organizationId: string,
  originalTransactionId: string,
  refundPaymentRouteId: string | null
): Promise<RouteResolution | null> {
  const rows = await tx
    .select({
      basis: schema.AccountingEffect.acceptedBasis,
      workState: schema.AccountingWork.state,
      operation: schema.AccountingWork.operation,
    })
    .from(schema.AccountingEffect)
    .innerJoin(
      schema.AccountingWork,
      and(
        eq(schema.AccountingWork.organizationId, organizationId),
        eq(schema.AccountingWork.id, schema.AccountingEffect.workId)
      )
    )
    .where(
      and(
        eq(schema.AccountingEffect.organizationId, organizationId),
        eq(schema.AccountingWork.moneyTransactionId, originalTransactionId),
        eq(schema.AccountingWork.effectKind, 'customer_receipt')
      )
    )
  if (rows.some((row) => row.operation === 'correction'))
    throw new ConflictError('Refund corrections for the original receipt are not supported')
  const originals = rows.filter((row) => row.operation === 'original')
  if (originals.length !== 1 || originals[0]!.workState !== 'accepted')
    throw new UnprocessableEntityError('Refund original receipt has no accepted accounting effect')
  const parsed = acceptedCustomerReceiptEffectBasisSchema.safeParse(originals[0]!.basis)
  if (!parsed.success)
    throw new UnprocessableEntityError('Refund original receipt basis is invalid')
  // Task 54's invoice-receipt policy freezes a cash account, not a rail
  // clearing route — there is no gateway in that flow to settle back through.
  // Refunding one is a different command and does not belong on this path.
  const route = 'kind' in parsed.data.calculation ? undefined : parsed.data.calculation.route
  if (!route?.paymentGatewayId || !route.glAccountId)
    throw new UnprocessableEntityError('Refund original receipt has no frozen clearing route')
  // 58 D5: the original's rail is the whole answer here - a refund cannot also
  // carry its own manually-resolved `PaymentRoute` (that route kind is retired
  // for anything but a manual cash/bank refund with no original receipt).
  if (refundPaymentRouteId !== null)
    throw new ConflictError(
      'Refund cannot name its own payment route while correcting a receipt-backed original'
    )
  return {
    endpointGlAccountId: route.glAccountId,
    route: {
      kind: 'rail',
      paymentGatewayId: route.paymentGatewayId,
      settlementCurrency: parsed.data.currency,
      endpointGlAccountId: route.glAccountId,
    },
    effectiveDate: parsed.data.effectiveDate,
  }
}

async function readCreditControl(
  tx: Transaction,
  organizationId: string,
  creditMemoInstanceId: string
): Promise<{
  accountId: string
  basisHash: string
  contactInstanceId: string | null
  effectiveDate: string
}> {
  const rows = await tx
    .select({
      basis: schema.AccountingEffect.acceptedBasis,
      basisHash: schema.AccountingEffect.basisHash,
      workState: schema.AccountingWork.state,
      operation: schema.AccountingWork.operation,
    })
    .from(schema.AccountingEffect)
    .innerJoin(
      schema.AccountingWork,
      and(
        eq(schema.AccountingWork.organizationId, organizationId),
        eq(schema.AccountingWork.id, schema.AccountingEffect.workId)
      )
    )
    .where(
      and(
        eq(schema.AccountingEffect.organizationId, organizationId),
        eq(schema.AccountingWork.entityInstanceId, creditMemoInstanceId),
        eq(schema.AccountingWork.effectKind, 'customer_credit_issued')
      )
    )
  if (rows.some((row) => row.operation === 'correction'))
    throw new ConflictError('Refund corrections for the credit memo are not supported')
  const originals = rows.filter((row) => row.operation === 'original')
  if (originals.length !== 1 || originals[0]!.workState !== 'accepted')
    throw new UnprocessableEntityError('Refund requires one accepted credit memo accounting effect')
  const parsed = acceptedCustomerCreditEffectBasisSchema.safeParse(originals[0]!.basis)
  if (!parsed.success || parsed.data.calculation.creditMemoInstanceId !== creditMemoInstanceId)
    throw new UnprocessableEntityError('Refund credit memo accounting basis is invalid')
  const controlAccountId = parsed.data.calculation.creditControlGlAccountId
  const hasControlContribution = parsed.data.contribution.some(
    (line) => line.direction === 'credit' && line.glAccountId === controlAccountId
  )
  if (!hasControlContribution)
    throw new UnprocessableEntityError(
      'Accepted credit memo accounting has no valid credit control account'
    )
  const memo = await loadCreditMemo(tx, organizationId, creditMemoInstanceId)
  const acceptedTotal = BigInt(parsed.data.calculation.totalMinor)
  if (
    !memo ||
    !Number.isSafeInteger(memo.totalMinor) ||
    memo.totalMinor < 0 ||
    acceptedTotal > BigInt(Number.MAX_SAFE_INTEGER) ||
    BigInt(memo.totalMinor) !== acceptedTotal
  )
    throw new ConflictError('Credit memo total changed since its accounting effect was accepted')
  const [applied, reserved] = await Promise.all([
    sumCreditMemoApplications(tx, organizationId, creditMemoInstanceId),
    sumReservedCreditMemoRefunds(tx, organizationId, {
      id: creditMemoInstanceId,
      source: parsed.data.calculation.source,
      amountRefundedMinor: memo.amountRefundedMinor,
    }),
  ])
  if (
    !Number.isSafeInteger(applied) ||
    !Number.isSafeInteger(reserved) ||
    applied < 0 ||
    reserved < 0
  )
    throw new ConflictError('Credit memo consumption is outside the supported amount range')
  if (BigInt(applied) + BigInt(reserved) > acceptedTotal)
    throw new ConflictError('Refund exceeds the remaining credit memo entitlement')
  return {
    accountId: controlAccountId,
    basisHash: originals[0]!.basisHash,
    contactInstanceId: parsed.data.calculation.contactInstanceId,
    effectiveDate: parsed.data.effectiveDate,
  }
}

async function prepareCustomerRefund(
  tx: Transaction,
  input: CustomerRefundAccountingInput,
  basisVersion = 1
) {
  const money = await tx.query.MoneyTransaction.findFirst({
    where: and(
      eq(schema.MoneyTransaction.organizationId, input.organizationId),
      eq(schema.MoneyTransaction.id, input.moneyTransactionId),
      eq(schema.MoneyTransaction.purpose, 'customer_refund')
    ),
  })
  if (!money || money.currency !== 'USD' || money.currencyExponent !== 2)
    throw new UnprocessableEntityError('Refund requires a confirmed USD movement')
  if (
    (money.datePrecision === 'instant' && !money.occurredAt) ||
    (money.datePrecision === 'date' && !money.occurredOn)
  )
    throw new UnprocessableEntityError('Refund occurrence date is incomplete')
  const nativeOwnership = await tx.query.MoneyCommand.findFirst({
    where: and(
      eq(schema.MoneyCommand.organizationId, input.organizationId),
      eq(schema.MoneyCommand.kind, 'adopt_native_stripe_evidence'),
      sql`${schema.MoneyCommand.resultIds}->>'moneyTransactionId' = ${money.id}`
    ),
  })
  if (nativeOwnership)
    throw new UnprocessableEntityError(
      'Refund is linked to native payment accounting; repair its existing accounting membership before switching ownership'
    )
  const zone = await getOrganizationSetting({
    db: tx,
    organizationId: input.organizationId,
    key: 'accounting.bookTimeZone',
  })
  if (typeof zone !== 'string' || !zone)
    throw new UnprocessableEntityError('Book time zone is not configured')
  const effectiveDate =
    money.datePrecision === 'date'
      ? money.occurredOn!
      : periodKeyForDate(money.occurredAt!, 'day', zone)
  const settlements = (await tx.query.MoneyRefundSettlement.findMany({
    where: and(
      eq(schema.MoneyRefundSettlement.organizationId, input.organizationId),
      eq(schema.MoneyRefundSettlement.refundTransactionId, money.id)
    ),
    orderBy: asc(schema.MoneyRefundSettlement.id),
  })) as Settlement[]
  if (!settlements.length) throw new UnprocessableEntityError('Refund has no settlement partition')
  if (
    settlements.some((s) => s.disposition !== 'customer_credit' || !s.customerCreditMemoInstanceId)
  )
    throw new UnprocessableEntityError('Only customer-credit refund dispositions are supported')
  const total = settlements.reduce((sum, s) => sum + s.amountMinor, 0n)
  if (total !== money.amountMinor)
    throw new ConflictError('Refund settlement partitions do not equal the movement amount')
  if (total > BigInt(Number.MAX_SAFE_INTEGER))
    throw new UnprocessableEntityError('Refund exceeds the current ledger safe-number boundary')
  const memoIds = [...new Set(settlements.map((s) => s.customerCreditMemoInstanceId!))]
  const controls = new Map<
    string,
    {
      accountId: string
      basisHash: string
      contactInstanceId: string | null
      effectiveDate: string
    }
  >()
  for (const memoId of memoIds)
    controls.set(memoId, await readCreditControl(tx, input.organizationId, memoId))
  const customerInstanceId = money.partyInstanceId
  if (
    !customerInstanceId ||
    [...controls.values()].some((control) => control.contactInstanceId !== customerInstanceId)
  )
    throw new UnprocessableEntityError(
      'Refund requires the customer party to match every accepted credit memo'
    )
  if ([...controls.values()].some((control) => control.effectiveDate > effectiveDate))
    throw new ConflictError('Refund date precedes an accepted credit memo accounting effect')
  const originalRouteIds = [
    ...new Set(settlements.map((settlement) => settlement.originalTransactionId).filter(Boolean)),
  ] as string[]
  const hasOriginalReference = settlements.some((settlement) => settlement.originalTransactionId)
  if (hasOriginalReference !== settlements.every((settlement) => settlement.originalTransactionId))
    throw new UnprocessableEntityError('Refund partitions must agree on original receipt reference')
  let route: RouteResolution
  if (originalRouteIds.length > 0) {
    if (originalRouteIds.length !== 1)
      throw new UnprocessableEntityError('Refund partitions have different original receipt routes')
    const frozen = await readFrozenReceiptRoute(
      tx,
      input.organizationId,
      originalRouteIds[0]!,
      money.paymentRouteId
    )
    if (!frozen) throw new UnprocessableEntityError('Refund original receipt route is unresolved')
    const original = await tx.query.MoneyTransaction.findFirst({
      where: and(
        eq(schema.MoneyTransaction.organizationId, input.organizationId),
        eq(schema.MoneyTransaction.id, originalRouteIds[0]!)
      ),
    })
    if (
      !original ||
      original.purpose !== 'customer_receipt' ||
      original.currency !== money.currency ||
      original.partyInstanceId !== customerInstanceId
    )
      throw new ConflictError('Refund original receipt customer or currency differs')
    const priorRefunds = await tx.query.MoneyRefundSettlement.findMany({
      where: and(
        eq(schema.MoneyRefundSettlement.organizationId, input.organizationId),
        eq(schema.MoneyRefundSettlement.originalTransactionId, original.id)
      ),
    })
    const refunded = priorRefunds.reduce((sum, settlement) => sum + settlement.amountMinor, 0n)
    if (refunded > original.amountMinor)
      throw new ConflictError('Refund exceeds the original receipt amount')
    if (frozen.effectiveDate && frozen.effectiveDate > effectiveDate)
      throw new ConflictError('Refund date precedes the original receipt accounting effect')
    route = frozen
  } else {
    route = await readRoute(tx, input.organizationId, money)
  }
  const sourceHash = accountingBasisHash({
    money: {
      id: money.id,
      amountMinor: money.amountMinor.toString(),
      currency: money.currency,
      datePrecision: money.datePrecision,
      occurredAt: money.occurredAt?.toISOString() ?? null,
      occurredOn: money.occurredOn ?? null,
      partyInstanceId: money.partyInstanceId,
    },
    settlements: settlements.map((s) => ({
      id: s.id,
      amountMinor: s.amountMinor.toString(),
      disposition: s.disposition,
      creditMemoInstanceId: s.customerCreditMemoInstanceId,
      originalTransactionId: s.originalTransactionId,
    })),
    controls: [...controls.entries()],
    route: route.route,
  })
  const calculation: CustomerRefundAccountingBasisV1 = {
    version: 1,
    moneyTransactionId: money.id,
    currency: 'USD',
    currencyExponent: 2,
    amountMinor: money.amountMinor.toString(),
    datePrecision: money.datePrecision,
    occurredAt: money.occurredAt?.toISOString() ?? null,
    occurredOn: money.occurredOn ?? null,
    effectiveDate,
    creditMemoInstanceIds: memoIds,
    settlements: settlements.map((s) => ({
      settlementId: s.id,
      creditMemoInstanceId: s.customerCreditMemoInstanceId!,
      amountMinor: s.amountMinor.toString(),
      creditControlAccountId: controls.get(s.customerCreditMemoInstanceId!)!.accountId,
    })),
    route: route.route,
    sourceHash,
  }
  const lines: GlPostingLineInput[] = []
  for (const settlement of calculation.settlements) {
    lines.push({
      sourceType: 'money_transaction',
      sourceId: money.id,
      glAccountId: settlement.creditControlAccountId,
      direction: 'debit',
      amount: toLedgerMinor(settlement.amountMinor, 'USD', 2),
      counterpartyType: 'customer',
      counterpartyId: customerInstanceId,
      dimensions: {
        creditMemoInstanceId: settlement.creditMemoInstanceId,
        settlementId: settlement.settlementId,
      },
      memo: 'Customer credit refund',
      sortOrder: lines.length,
    })
  }
  lines.push({
    sourceType: 'money_transaction',
    sourceId: money.id,
    glAccountId: route.endpointGlAccountId,
    direction: 'credit',
    amount: toLedgerMinor(calculation.amountMinor, 'USD', 2),
    dimensions:
      route.route.kind === 'manual'
        ? { paymentRouteId: route.route.paymentRouteId }
        : { paymentGatewayId: route.route.paymentGatewayId },
    memo: 'Customer credit refund',
    sortOrder: lines.length,
  })
  const resolved = await resolveAccountLines(tx, input.organizationId, lines)
  if (resolved.isErr()) throw resolved.error
  const endpoint = resolved.value.at(-1)
  if (endpoint?.accountType !== 'asset')
    throw new UnprocessableEntityError('Refund route endpoint must be an active asset account')
  const workBasis = customerRefundWorkBasisSchema.parse({
    version: 1,
    status: 'ready',
    moneyTransactionId: money.id,
    sourceHash,
    effectiveDate,
    calculation,
  })
  const acceptedBasis = acceptedCustomerRefundEffectBasisSchema.parse({
    version: 1,
    sourceBasisVersion: basisVersion,
    sourceHash,
    policyKey: 'customer_refund_v1',
    policyVersion: 1,
    effectiveDate,
    bookTimeZone: zone,
    currency: 'USD',
    currencyExponent: 2,
    documentRefs: [
      { resourceKind: 'money_transaction', entityInstanceId: money.id },
      ...memoIds.map((id) => ({ resourceKind: 'credit_memo', entityInstanceId: id })),
    ],
    calculation,
    accountResolution: lines.map((line, i) => ({
      lineKey: `line:${i}`,
      glAccountId: resolved.value[i]!.glAccountId,
      accountRole: null,
      selectedBy: i < settlements.length ? 'original_effect' : 'route',
      configurationHash: accountingBasisHash(resolved.value[i]!),
    })),
    contribution: lines.map((line, i) => ({
      lineKey: `line:${i}`,
      glAccountId: resolved.value[i]!.glAccountId,
      direction: line.direction,
      amountMinor: fromLedgerMinor(line.amount),
      counterpartyType: line.counterpartyType ?? null,
      counterpartyId: line.counterpartyId ?? null,
      dimensions: line.dimensions ?? {},
    })),
  })
  const entry = buildEntry({
    postingType: 'payment',
    periodKey: `refund:${money.id}`,
    txnDate: effectiveDate,
    lines,
  })
  return { money, workBasis, acceptedBasis, entry }
}

/** Accept one refund effect in the caller's transaction. */
export async function postCustomerRefundAccountingInTx(
  tx: Transaction,
  input: CustomerRefundAccountingInput
): Promise<CustomerRefundAccountingResult> {
  await withAccountingCommitLock(tx, input.organizationId)
  const existing = await tx
    .select({ glPostingId: schema.AccountingEffect.glPostingId })
    .from(schema.AccountingEffect)
    .innerJoin(
      schema.AccountingWork,
      and(
        eq(schema.AccountingWork.organizationId, input.organizationId),
        eq(schema.AccountingWork.id, schema.AccountingEffect.workId)
      )
    )
    .where(
      and(
        eq(schema.AccountingWork.organizationId, input.organizationId),
        eq(schema.AccountingWork.moneyTransactionId, input.moneyTransactionId),
        eq(schema.AccountingWork.effectKind, 'customer_refund'),
        eq(schema.AccountingWork.operation, 'original')
      )
    )
  if (existing[0]) return { status: 'accepted', glPostingId: existing[0].glPostingId }
  if (!(await isAccountingEnabled(tx, input.organizationId)))
    return { status: 'skipped', reason: 'Accounting is not enabled' }
  const setup = await getOrganizationSetting({
    db: tx,
    organizationId: input.organizationId,
    key: 'accounting.setupState',
  })
  if (setup !== FINALIZED_SETUP_STATE)
    throw new UnprocessableEntityError('Finalize accounting setup before posting customer refunds')
  const prepared = await prepareCustomerRefund(tx, input)
  const cutoff = await getOrganizationSetting({
    db: tx,
    organizationId: input.organizationId,
    key: 'accounting.cutoffPeriod',
  })
  if (typeof cutoff === 'string' && prepared.entry.txnDate.slice(0, 7) <= cutoff)
    throw new UnprocessableEntityError(`Refund is before the accounting opening cutoff ${cutoff}`)
  const selected = await captureCustomerRefundWorkInTx(tx, {
    organizationId: input.organizationId,
    moneyTransactionId: input.moneyTransactionId,
    eligibility: 'manual',
    basis: prepared.workBasis,
  })
  const accepted = await acceptEntryInTx(
    tx,
    {
      organizationId: input.organizationId,
      actorUserId: input.actorUserId,
      entry: prepared.entry,
      members: [
        {
          workId: selected.work.id,
          expectedBasisVersion: selected.work.basisVersion,
          acceptedBasis: {
            ...prepared.acceptedBasis,
            sourceBasisVersion: selected.work.basisVersion,
          },
        },
      ],
      deliveryIntent: await resolveFulfillmentDeliveryIntentInTx(
        tx,
        input.organizationId,
        prepared.entry.txnDate
      ),
    },
    {
      revalidateMemberInTx: async (lockedTx, work) =>
        (await prepareCustomerRefund(lockedTx, input, work.basisVersion)).acceptedBasis,
    }
  )
  if (accepted.status !== 'accepted' || !accepted.glPostingId)
    throw new ConflictError('Refund accounting membership changed during acceptance')
  await planAccountingDeliveryInTx(tx, {
    organizationId: input.organizationId,
    glPostingId: accepted.glPostingId,
  })
  return { status: 'accepted', glPostingId: accepted.glPostingId }
}

/** Public refund accounting door with durable blocked work and post-commit delivery. */
export async function postCustomerRefundAccounting(
  db: Database,
  input: CustomerRefundAccountingInput
): Promise<CustomerRefundAccountingResult> {
  let result: CustomerRefundAccountingResult
  try {
    result = await db.transaction((tx) => postCustomerRefundAccountingInTx(tx, input))
  } catch (error) {
    if (
      !(
        error instanceof UnprocessableEntityError ||
        error instanceof ConflictError ||
        error instanceof z.ZodError
      )
    )
      throw error
    const reason = error instanceof Error ? error.message : String(error)
    result = await db.transaction(async (tx) => {
      await withAccountingCommitLock(tx, input.organizationId)
      const [accepted] = await tx
        .select({ glPostingId: schema.AccountingEffect.glPostingId })
        .from(schema.AccountingEffect)
        .innerJoin(
          schema.AccountingWork,
          and(
            eq(schema.AccountingWork.organizationId, input.organizationId),
            eq(schema.AccountingWork.id, schema.AccountingEffect.workId)
          )
        )
        .where(
          and(
            eq(schema.AccountingEffect.organizationId, input.organizationId),
            eq(schema.AccountingWork.moneyTransactionId, input.moneyTransactionId),
            eq(schema.AccountingWork.effectKind, 'customer_refund'),
            eq(schema.AccountingWork.operation, 'original'),
            eq(schema.AccountingWork.state, 'accepted')
          )
        )
      if (accepted?.glPostingId)
        return { status: 'accepted' as const, glPostingId: accepted.glPostingId }
      const basis: CustomerRefundWorkBasisInput = {
        version: 1,
        status: 'incomplete',
        moneyTransactionId: input.moneyTransactionId,
        sourceHash: accountingBasisHash({ moneyTransactionId: input.moneyTransactionId, reason }),
        effectiveDate: null,
        missingDependencies: [reason],
        observed: { moneyTransactionId: input.moneyTransactionId, reason },
      }
      const work = await captureCustomerRefundWorkInTx(tx, {
        organizationId: input.organizationId,
        moneyTransactionId: input.moneyTransactionId,
        eligibility: 'manual',
        basis,
      })
      await tx
        .update(schema.AccountingWork)
        .set({
          nextAttemptAt: new Date(Date.now() + 60_000),
          updatedAt: new Date(),
          blockedReason: reason,
        })
        .where(
          and(
            eq(schema.AccountingWork.organizationId, input.organizationId),
            eq(schema.AccountingWork.id, work.work.id)
          )
        )
      return { status: 'blocked', reason }
    })
  }
  if (result.status === 'accepted') {
    try {
      await deliverAccountingPosting(db, {
        organizationId: input.organizationId,
        glPostingId: result.glPostingId,
      })
    } catch (error) {
      logger.warn('Accepted customer refund awaits delivery recovery', { error: String(error) })
    }
  }
  return result
}
