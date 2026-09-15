// packages/lib/src/money/customer-money/accounting.ts
import { type Database, schema, type Transaction } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { ConflictError, UnprocessableEntityError } from '../../errors'
import { acceptEntryInTx } from '../../postings/accept-entry'
import { withAccountingCommitLock } from '../../postings/accounting-commit-lock'
import { isAccountingEnabled } from '../../postings/accounting-enabled'
import { resolveFulfillmentDeliveryIntentInTx } from '../../postings/book-connections'
import { buildEntry } from '../../postings/build-entry'
import { deliverAccountingPosting, planAccountingDeliveryInTx } from '../../postings/delivery'
import { accountingBasisHash, fromLedgerMinor, toLedgerMinor } from '../../postings/effect-basis'
import {
  acceptedCustomerReceiptEffectBasisSchema,
  type CustomerReceiptWorkBasisInput,
  customerReceiptWorkBasisSchema,
} from '../../postings/effect-types'
import {
  appendCustomerReceiptWorkBasisInTx,
  captureCustomerReceiptWorkInTx,
} from '../../postings/effect-work'
import { resolveAccountLines } from '../../postings/resolve-roles'
import { FINALIZED_SETUP_STATE } from '../../postings/setup-readiness'
import type { GlPostingLineInput } from '../../postings/types'
import type { SettingKey } from '../../settings/catalog'
import { getOrganizationSetting } from '../../settings/settings-service'
import {
  listCustomerReceiptAccountingCandidates,
  readCustomerReceiptAccountingSource,
} from './receipt-accounting'
import { allocateRecognitionTaxComponents } from './recognition'
import { readOrderRecognitionFactsInTx } from './recognition-facts'
import {
  readOrderRecognitionSource,
  requireCompleteOrderRecognitionSource,
} from './recognition-source'

const logger = createScopedLogger('customer-receipt-accounting')
export interface CustomerReceiptAccountingResult {
  status: 'accepted' | 'blocked' | 'skipped'
  glPostingId?: string
  reason?: string
}
type Command = {
  organizationId: string
  moneyTransactionId: string
  actorUserId?: string
  automatic?: boolean
}
const setting = (tx: Transaction, organizationId: string, key: SettingKey) =>
  getOrganizationSetting({ db: tx, organizationId, key })

async function prepareReceipt(tx: Transaction, input: Command, basisVersion: number) {
  const zone = await setting(tx, input.organizationId, 'accounting.bookTimeZone')
  if (typeof zone !== 'string' || !zone)
    throw new UnprocessableEntityError('Book time zone is not configured')
  const source = await readCustomerReceiptAccountingSource(
    tx,
    input.organizationId,
    input.moneyTransactionId,
    zone
  )
  const facts = await readOrderRecognitionFactsInTx(tx, input.organizationId, source.orderId)
  if (source.money.partyInstanceId && source.money.partyInstanceId !== facts.customerInstanceId)
    throw new UnprocessableEntityError('Receipt customer differs from the order customer')
  const timeline = requireCompleteOrderRecognitionSource(
    await readOrderRecognitionSource(tx, {
      organizationId: input.organizationId,
      orderId: source.orderId,
      orderNetMinor: (facts.subtotal + facts.shipping).toString(),
      orderTaxMinor: facts.tax.toString(),
      bookTimeZone: zone,
      target: { kind: 'receipt', id: source.money.id },
    })
  )
  const allocation = timeline.target
  if (!allocation)
    throw new UnprocessableEntityError('Receipt is absent from the recognition timeline')
  const taxShares = allocateRecognitionTaxComponents(timeline.allocations, facts.taxComponents).get(
    source.money.id
  )!
  const taxComponents = facts.taxComponents.map((component) => ({
    ...component,
    amountMinor: taxShares.find((share) => share.componentKey === component.componentKey)!
      .amountMinor,
  }))
  const sourceHash = accountingBasisHash({
    receipt: source.sourceHash,
    history: allocation.historyHash,
    order: {
      subtotal: facts.subtotal.toString(),
      shipping: facts.shipping.toString(),
      tax: facts.tax.toString(),
      total: facts.total.toString(),
      customer: facts.customerInstanceId,
      channel: facts.channel ?? null,
      taxComponents: facts.taxComponents,
    },
  })
  const basis = customerReceiptWorkBasisSchema.parse({
    version: 1,
    status: 'ready',
    moneyTransactionId: source.money.id,
    sourceHash,
    effectiveDate: source.effectiveDate,
    calculation: {
      version: 1,
      moneyTransactionId: source.money.id,
      orderInstanceId: source.orderId,
      sourceObjectId: source.sourceObjectId,
      sourceExternalId: source.sourceExternalId,
      sourceRevision: source.sourceRevision,
      sourceHash,
      historyHash: allocation.historyHash,
      occurredAt: source.money.occurredAt!.toISOString(),
      effectiveDate: source.effectiveDate,
      currency: 'USD',
      currencyExponent: 2,
      amountMinor: allocation.amountMinor,
      receiptAmountMinor: source.money.amountMinor.toString(),
      depositMinor: allocation.depositMinor,
      receivableMinor: allocation.receivableMinor,
      taxMinor: allocation.taxMinor,
      allocation: {
        amountMinor: allocation.amountMinor,
        depositMinor: allocation.depositMinor,
        receivableMinor: allocation.receivableMinor,
        taxMinor: allocation.taxMinor,
      },
      orderSubtotalMinor: facts.subtotal.toString(),
      orderTaxMinor: facts.tax.toString(),
      orderShippingMinor: facts.shipping.toString(),
      orderTotalMinor: facts.total.toString(),
      paymentRouteId: source.route.id,
      sourceStoreId: source.sourceStoreId,
      processorAccountId: source.processorAccountId,
      route: {
        paymentRouteId: source.route.id,
        processorAccountId: source.processorAccountId,
        glAccountId: source.clearingGlAccountId,
        reason: 'Confirmed receipt processor clearing account',
      },
      applications: source.applications.map((a) => ({
        applicationId: a.id,
        orderInstanceId: a.orderInstanceId!,
        amountMinor: a.amountMinor.toString(),
        effectiveDate: a.effectiveDate,
      })),
      taxComponents,
    },
  })
  if (basis.status !== 'ready') throw new Error('Expected ready receipt basis')
  const dimensions = {
    sourceProvider: 'shopify',
    ...(facts.channel ? { channel: facts.channel } : {}),
    sourceStoreId: source.sourceStoreId,
    processorAccountId: source.processorAccountId,
    paymentRouteId: source.route.id,
    orderId: source.orderId,
  }
  const base = { sourceType: 'money_transaction', sourceId: source.money.id, dimensions }
  const money = (amount: string) => toLedgerMinor(amount, 'USD', 2)
  const lines: GlPostingLineInput[] = [
    {
      ...base,
      glAccountId: source.clearingGlAccountId,
      direction: 'debit',
      amount: money(allocation.amountMinor),
      sortOrder: 0,
      memo: 'Customer payment received',
    },
  ]
  if (BigInt(allocation.receivableMinor) > 0n)
    lines.push({
      ...base,
      accountRole: 'accounts_receivable',
      direction: 'credit',
      amount: money(allocation.receivableMinor),
      sortOrder: lines.length,
      counterpartyType: 'customer',
      counterpartyId: facts.customerInstanceId,
      memo: 'Payment applied to shipped order',
    })
  if (BigInt(allocation.depositMinor) > 0n)
    lines.push({
      ...base,
      accountRole: 'customer_deposits',
      direction: 'credit',
      amount: money(allocation.depositMinor),
      sortOrder: lines.length,
      memo: 'Advance payment held for shipment',
    })
  for (const tax of taxComponents)
    if (BigInt(tax.amountMinor) > 0n)
      lines.push({
        ...base,
        accountRole: 'sales_tax_payable',
        direction: 'credit',
        amount: money(tax.amountMinor),
        sortOrder: lines.length,
        dimensions: {
          ...dimensions,
          jurisdiction: tax.jurisdiction!,
          taxComponentId: tax.componentKey,
        },
        memo: 'Sales tax on advance payment',
      })
  const label = [source.storeDomain, source.sourceExternalId, source.gatewayName, facts.channel]
    .filter(Boolean)
    .join(' / ')
  for (const line of lines) line.memo = `${label}: ${line.memo}`
  const entry = buildEntry({
    postingType: 'payment',
    periodKey: source.effectiveDate,
    txnDate: source.effectiveDate,
    lines,
  })
  const resolved = await resolveAccountLines(tx, input.organizationId, lines)
  if (resolved.isErr()) throw resolved.error
  if (resolved.value[0]?.accountType !== 'asset')
    throw new UnprocessableEntityError('Receipt processor clearing must be an asset account')
  const acceptedBasis = acceptedCustomerReceiptEffectBasisSchema.parse({
    version: 1,
    sourceBasisVersion: basisVersion,
    sourceHash,
    policyKey: 'shopify_receipt_v1',
    policyVersion: 1,
    effectiveDate: source.effectiveDate,
    bookTimeZone: zone,
    currency: 'USD',
    currencyExponent: 2,
    documentRefs: [
      { resourceKind: 'order', entityInstanceId: source.orderId },
      { resourceKind: 'money_transaction', entityInstanceId: source.money.id },
    ],
    calculation: basis.calculation,
    accountResolution: lines.map((line, i) => ({
      lineKey: `line:${i}`,
      glAccountId: resolved.value[i]!.glAccountId,
      accountRole: line.accountRole ?? null,
      selectedBy: line.glAccountId ? 'route' : 'org_role',
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
  return { basis, acceptedBasis, entry }
}

async function selectBasis(tx: Transaction, input: Command, basis: CustomerReceiptWorkBasisInput) {
  const work = await tx.query.AccountingWork.findFirst({
    where: and(
      eq(schema.AccountingWork.organizationId, input.organizationId),
      eq(schema.AccountingWork.moneyTransactionId, input.moneyTransactionId),
      eq(schema.AccountingWork.effectKind, 'customer_receipt'),
      eq(schema.AccountingWork.operation, 'original')
    ),
  })
  const eligibility = input.automatic ? ('automatic' as const) : ('manual' as const)
  if (!work)
    return (await captureCustomerReceiptWorkInTx(tx, { ...input, eligibility, basis })).work
  if (!['pending', 'blocked'].includes(work.state)) return work
  const saved = await appendCustomerReceiptWorkBasisInTx(tx, {
    organizationId: input.organizationId,
    workId: work.id,
    expectedBasisVersion: work.basisVersion,
    basis,
  })
  await tx
    .update(schema.AccountingWork)
    .set({ eligibility, updatedAt: new Date() })
    .where(
      and(
        eq(schema.AccountingWork.organizationId, input.organizationId),
        eq(schema.AccountingWork.id, work.id)
      )
    )
  return { ...work, basisVersion: saved.version }
}

/** Accept one receipt and pin its delivery atomically; retries return its immutable journal. */
export async function postCustomerReceiptAccounting(
  db: Database,
  input: Command
): Promise<CustomerReceiptAccountingResult> {
  let result: CustomerReceiptAccountingResult
  try {
    result = await db.transaction(async (tx) => {
      await withAccountingCommitLock(tx, input.organizationId)
      const existing = await tx
        .select({ glPostingId: schema.AccountingEffect.glPostingId })
        .from(schema.AccountingWork)
        .innerJoin(
          schema.AccountingEffect,
          and(
            eq(schema.AccountingEffect.organizationId, input.organizationId),
            eq(schema.AccountingEffect.workId, schema.AccountingWork.id)
          )
        )
        .where(
          and(
            eq(schema.AccountingWork.organizationId, input.organizationId),
            eq(schema.AccountingWork.moneyTransactionId, input.moneyTransactionId),
            eq(schema.AccountingWork.effectKind, 'customer_receipt'),
            eq(schema.AccountingWork.operation, 'original')
          )
        )
      if (existing[0]) return { status: 'accepted', glPostingId: existing[0].glPostingId }
      if (!(await isAccountingEnabled(tx, input.organizationId)))
        return { status: 'skipped', reason: 'Accounting is not enabled' }
      if (
        input.automatic &&
        (await setting(tx, input.organizationId, 'accounting.fulfillmentPosting')) !== 'auto'
      )
        return { status: 'skipped', reason: 'Automatic accounting is not enabled' }
      if (
        (await setting(tx, input.organizationId, 'accounting.setupState')) !== FINALIZED_SETUP_STATE
      )
        throw new UnprocessableEntityError(
          'Finalize accounting setup before posting customer payments'
        )
      const prepared = await prepareReceipt(tx, input, 1)
      const cutoff = await setting(tx, input.organizationId, 'accounting.cutoffPeriod')
      if (typeof cutoff === 'string' && prepared.entry.txnDate.slice(0, 7) <= cutoff)
        throw new UnprocessableEntityError(
          `Receipt is before the accounting opening cutoff ${cutoff}`
        )
      const work = await selectBasis(tx, input, prepared.basis)
      const acceptedBasis = { ...prepared.acceptedBasis, sourceBasisVersion: work.basisVersion }
      const accepted = await acceptEntryInTx(
        tx,
        {
          organizationId: input.organizationId,
          actorUserId: input.actorUserId,
          entry: prepared.entry,
          members: [{ workId: work.id, expectedBasisVersion: work.basisVersion, acceptedBasis }],
          deliveryIntent: await resolveFulfillmentDeliveryIntentInTx(
            tx,
            input.organizationId,
            prepared.entry.txnDate
          ),
        },
        {
          revalidateMemberInTx: async (lockedTx, currentWork) =>
            (await prepareReceipt(lockedTx, input, currentWork.basisVersion)).acceptedBasis,
        }
      )
      if (accepted.status !== 'accepted' || !accepted.glPostingId)
        throw new ConflictError('Receipt accounting membership changed during acceptance')
      await planAccountingDeliveryInTx(tx, {
        organizationId: input.organizationId,
        glPostingId: accepted.glPostingId,
      })
      return { status: 'accepted', glPostingId: accepted.glPostingId }
    })
  } catch (error) {
    if (
      !(
        error instanceof UnprocessableEntityError ||
        error instanceof ConflictError ||
        error instanceof z.ZodError
      )
    )
      throw error
    const reason = error.message
    // The failed transaction has rolled back before durable refusal capture begins.
    result = await db.transaction(async (tx) => {
      await withAccountingCommitLock(tx, input.organizationId)
      const basis: CustomerReceiptWorkBasisInput = {
        version: 1,
        status: 'incomplete',
        moneyTransactionId: input.moneyTransactionId,
        sourceHash: accountingBasisHash({ moneyTransactionId: input.moneyTransactionId, reason }),
        effectiveDate: null,
        missingDependencies: [reason],
        observed: { moneyTransactionId: input.moneyTransactionId, reason },
      }
      const work = await selectBasis(tx, input, basis)
      if (work.state === 'accepted') {
        const effect = await tx.query.AccountingEffect.findFirst({
          where: and(
            eq(schema.AccountingEffect.organizationId, input.organizationId),
            eq(schema.AccountingEffect.workId, work.id)
          ),
        })
        if (effect) return { status: 'accepted', glPostingId: effect.glPostingId }
      }
      await tx
        .update(schema.AccountingWork)
        .set({ nextAttemptAt: new Date(Date.now() + 60_000), updatedAt: new Date() })
        .where(
          and(
            eq(schema.AccountingWork.organizationId, input.organizationId),
            eq(schema.AccountingWork.id, work.id)
          )
        )
      return { status: 'blocked', reason }
    })
  }
  if (result.status === 'accepted' && result.glPostingId) {
    try {
      await deliverAccountingPosting(db, {
        organizationId: input.organizationId,
        glPostingId: result.glPostingId,
      })
    } catch (error) {
      logger.warn('Accepted customer receipt awaits delivery recovery', {
        organizationId: input.organizationId,
        glPostingId: result.glPostingId,
        error: String(error),
      })
    }
  }
  return result
}

/** Bounded recovery retries repaired receipt evidence without starving later movements. */
export async function sweepCustomerReceiptAccounting(
  db: Database,
  input: { organizationId: string; limit?: number; timeBudgetMs?: number }
) {
  const started = Date.now()
  const ids = await listCustomerReceiptAccountingCandidates(
    db,
    input.organizationId,
    Math.min(input.limit ?? 100, 500)
  )
  const counts = { scanned: 0, accepted: 0, blocked: 0, skipped: 0 }
  for (const moneyTransactionId of ids) {
    if (input.timeBudgetMs != null && Date.now() - started >= input.timeBudgetMs) break
    const result = await postCustomerReceiptAccounting(db, {
      organizationId: input.organizationId,
      moneyTransactionId,
      automatic: true,
    })
    counts.scanned++
    counts[result.status]++
  }
  return counts
}
