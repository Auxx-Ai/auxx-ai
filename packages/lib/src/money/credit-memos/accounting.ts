// packages/lib/src/money/credit-memos/accounting.ts
import { type Database, schema, type Transaction } from '@auxx/database'
import { toRecordId } from '@auxx/types/resource'
import { and, eq, inArray, isNull, sql } from 'drizzle-orm'
import { z } from 'zod'
import { getEntityDefIdResolver } from '../../cache'
import { ConflictError, UnprocessableEntityError } from '../../errors'
import { FieldValueService } from '../../field-values/field-value-service'
import { acceptEntryInTx } from '../../postings/accept-entry'
import { isAccountingEnabled } from '../../postings/accounting-enabled'
import { resolveFulfillmentDeliveryIntentInTx } from '../../postings/book-connections'
import { buildCreditMemoEntitlementEntry } from '../../postings/build-credit-memo-entry'
import { buildEntry } from '../../postings/build-entry'
import {
  acceptedCustomerCreditEffectBasisSchema,
  type CustomerCreditAccountingBasisV1,
  customerCreditWorkBasisSchema,
} from '../../postings/credit-effect-types'
import { captureCustomerCreditWorkInTx } from '../../postings/credit-effect-work'
import { planAccountingDeliveryInTx } from '../../postings/delivery'
import { accountingBasisHash, toLedgerMinor } from '../../postings/effect-basis'
import {
  acceptedCustomerReceiptEffectBasisSchema,
  acceptedFulfillmentEffectBasisSchema,
} from '../../postings/effect-types'
import { resolveAccountLines, resolveRoles } from '../../postings/resolve-roles'
import { FINALIZED_SETUP_STATE } from '../../postings/setup-readiness'
import { runWithCreditAccountingIssue } from '../../postings/source-write-guard'
import type { GlPostingLineInput } from '../../postings/types'
import { getOrganizationSetting } from '../../settings/settings-service'
import { readOrderSourceScope } from '../customer-money/reads'
import { readOrderRecognitionFactsInTx } from '../customer-money/recognition-facts'
import { runCreditCommand } from './command'
import { loadCreditMemoLines, loadInvoiceForCredit, requireCreditMemo } from './reads'
import { CREDIT_MEMO_STATUS_BYPASS } from './settle'

const sourceAllocationSchema = z.strictObject({
  effectId: z.string().min(1),
  lineKey: z.string().min(1),
  amountMinor: z.string().regex(/^[1-9]\d*$/),
  componentKey: z.enum(['earned_revenue', 'customer_deposit', 'sales_tax']),
})

/** An exact portion of an accepted receipt or shipment reversed by a channel credit. */
export type CreditSourceAllocation = z.infer<typeof sourceAllocationSchema>

/** Issue a credit entitlement without recording or inferring a cash refund. */
export interface IssueCreditMemoAccountingInput {
  organizationId: string
  userId: string
  commandKey: string
  creditMemoInstanceId: string
  issuedAt: string
  sourceAllocations?: CreditSourceAllocation[]
}

const roles = {
  earned_revenue: 'revenue_returns_allowances',
  customer_deposit: 'customer_deposits',
  sales_tax: 'sales_tax_payable',
} as const

async function allocationComponents(
  tx: Transaction,
  input: IssueCreditMemoAccountingInput,
  memo: Awaited<ReturnType<typeof requireCreditMemo>>,
  subtotal: bigint,
  tax: bigint
) {
  const allocations = z.array(sourceAllocationSchema).parse(input.sourceAllocations ?? [])
  if (memo.source === 'native') {
    if (allocations.length)
      throw new UnprocessableEntityError('Native credit memos use their own document line basis')
    return {
      allocations,
      components: [
        ...(subtotal > 0n
          ? [{ componentKey: 'earned_revenue' as const, amountMinor: subtotal.toString() }]
          : []),
        ...(tax > 0n ? [{ componentKey: 'sales_tax' as const, amountMinor: tax.toString() }] : []),
      ],
      evidence: [],
    }
  }
  if (!memo.orderInstanceId || !allocations.length)
    throw new UnprocessableEntityError('Channel credit needs explicit accepted order components')
  const orderFacts = await readOrderRecognitionFactsInTx(
    tx,
    input.organizationId,
    memo.orderInstanceId
  )
  if (orderFacts.customerInstanceId !== memo.contactInstanceId)
    throw new UnprocessableEntityError('Credit customer does not match the order customer')
  const seen = new Set<string>()
  const totals = new Map<CreditSourceAllocation['componentKey'], bigint>()
  const prior = await tx
    .select({
      basis: schema.AccountingEffect.acceptedBasis,
      operation: schema.AccountingWork.operation,
    })
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
        eq(schema.AccountingWork.effectKind, 'customer_credit_issued')
      )
    )
  const evidence = []
  const orderEffects = await tx
    .select({
      basis: schema.AccountingEffect.acceptedBasis,
      effectiveDate: schema.AccountingEffect.effectiveDate,
      operation: schema.AccountingWork.operation,
    })
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
        inArray(schema.AccountingWork.effectKind, ['customer_receipt', 'fulfillment_accounting']),
        eq(
          sql<string>`${schema.AccountingEffect.acceptedBasis}->'calculation'->>'orderInstanceId'`,
          memo.orderInstanceId
        )
      )
    )
  let availableDeposits = 0n
  for (const effect of orderEffects) {
    if (effect.operation !== 'original' || effect.effectiveDate > input.issuedAt)
      throw new UnprocessableEntityError(
        'Credit requires a current uncorrected order accounting basis'
      )
    const original = z
      .union([acceptedCustomerReceiptEffectBasisSchema, acceptedFulfillmentEffectBasisSchema])
      .parse(effect.basis)
    if (
      'customerInstanceId' in original.calculation &&
      original.calculation.customerInstanceId !== memo.contactInstanceId
    )
      throw new UnprocessableEntityError('Credit source customer does not match the memo customer')
    for (const line of original.contribution) {
      if (
        original.accountResolution.find((r) => r.lineKey === line.lineKey)?.accountRole ===
        'customer_deposits'
      )
        availableDeposits += (line.direction === 'credit' ? 1n : -1n) * BigInt(line.amountMinor)
    }
  }
  for (const row of prior) {
    const credit = acceptedCustomerCreditEffectBasisSchema.parse(row.basis)
    if (credit.calculation.orderInstanceId !== memo.orderInstanceId) continue
    if (row.operation !== 'original')
      throw new ConflictError(
        'Credit correction history must be reconciled before issuing another credit'
      )
    availableDeposits -= credit.calculation.components.reduce(
      (sum, component) =>
        component.componentKey === 'customer_deposit' ? sum + BigInt(component.amountMinor) : sum,
      0n
    )
  }
  for (const allocation of allocations) {
    const key = `${allocation.effectId}:${allocation.lineKey}`
    if (seen.has(key))
      throw new ConflictError('A credit source component may only be selected once')
    seen.add(key)
    const [source] = await tx
      .select({
        effect: schema.AccountingEffect,
        effectKind: schema.AccountingWork.effectKind,
        operation: schema.AccountingWork.operation,
        moneyTransactionId: schema.AccountingWork.moneyTransactionId,
      })
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
          eq(schema.AccountingEffect.id, allocation.effectId)
        )
      )
      .limit(1)
    if (!source) throw new UnprocessableEntityError('Credit source effect is missing')
    if (
      source.operation !== 'original' ||
      !['customer_receipt', 'fulfillment_accounting'].includes(source.effectKind)
    )
      throw new ConflictError(
        'Credit source corrections must be reconciled before issuing a credit'
      )
    const effect = source.effect
    if (source.effectKind === 'customer_receipt') {
      const receipt = await tx.query.MoneyTransaction.findFirst({
        where: and(
          eq(schema.MoneyTransaction.organizationId, input.organizationId),
          eq(schema.MoneyTransaction.id, source.moneyTransactionId!),
          eq(schema.MoneyTransaction.purpose, 'customer_receipt')
        ),
      })
      if (receipt?.partyInstanceId !== memo.contactInstanceId)
        throw new UnprocessableEntityError(
          'Credit receipt customer does not match the memo customer'
        )
    }
    const parsed = z
      .union([acceptedCustomerReceiptEffectBasisSchema, acceptedFulfillmentEffectBasisSchema])
      .safeParse(effect.acceptedBasis)
    // An invoice receipt (task 54's second policy) has no `orderInstanceId` at
    // all, so it can never be the source of an order-scoped credit — refuse it
    // here rather than letting the comparison read `undefined`.
    if (
      !parsed.success ||
      'kind' in parsed.data.calculation ||
      parsed.data.calculation.orderInstanceId !== memo.orderInstanceId
    )
      throw new UnprocessableEntityError('Credit source effect does not belong to this order')
    if (
      'customerInstanceId' in parsed.data.calculation &&
      parsed.data.calculation.customerInstanceId !== memo.contactInstanceId
    )
      throw new UnprocessableEntityError('Credit source customer does not match the memo customer')
    if (effect.effectiveDate > input.issuedAt)
      throw new UnprocessableEntityError('Credit cannot precede the component it reverses')
    const line = parsed.data.contribution.find((item) => item.lineKey === allocation.lineKey)
    const resolution = parsed.data.accountResolution.find(
      (item) => item.lineKey === allocation.lineKey
    )
    const expectedRoles =
      allocation.componentKey === 'earned_revenue'
        ? ['revenue_product', 'revenue_shipping']
        : [roles[allocation.componentKey]]
    if (
      !line ||
      line.direction !== 'credit' ||
      !resolution?.accountRole ||
      !expectedRoles.includes(resolution.accountRole)
    )
      throw new UnprocessableEntityError('Credit allocation does not match the accepted component')
    let consumed = 0n
    for (const row of prior) {
      const credit = acceptedCustomerCreditEffectBasisSchema.parse(row.basis)
      for (const used of credit.calculation.sourceAllocations)
        if (used.effectId === allocation.effectId && used.lineKey === allocation.lineKey)
          consumed += BigInt(used.amountMinor)
    }
    if (consumed + BigInt(allocation.amountMinor) > BigInt(line.amountMinor))
      throw new ConflictError('The accepted source component has already been credited')
    totals.set(
      allocation.componentKey,
      (totals.get(allocation.componentKey) ?? 0n) + BigInt(allocation.amountMinor)
    )
    evidence.push({ allocation, basisHash: effect.basisHash, contribution: line })
  }
  if (
    (totals.get('earned_revenue') ?? 0n) + (totals.get('customer_deposit') ?? 0n) !== subtotal ||
    (totals.get('sales_tax') ?? 0n) !== tax
  )
    throw new UnprocessableEntityError(
      'Selected components must match the credit net and tax amounts exactly'
    )
  if ((totals.get('customer_deposit') ?? 0n) > availableDeposits)
    throw new ConflictError('The selected advance payment has already been recognized or credited')
  return {
    allocations,
    components: [...totals].map(([componentKey, amount]) => ({
      componentKey,
      amountMinor: amount.toString(),
    })),
    evidence,
  }
}

async function prepareCredit(tx: Transaction, input: IssueCreditMemoAccountingInput) {
  const memo = await requireCreditMemo(tx, input.organizationId, input.creditMemoInstanceId)
  if (!memo.contactInstanceId || !memo.number || memo.glPostingId)
    throw new UnprocessableEntityError(
      'Credit needs a customer and number and must not already have a posting'
    )
  if (memo.source === 'channel' && memo.issuedAt !== input.issuedAt)
    throw new ConflictError('Channel credit date must match the stored provider credit date')
  const [customer] = await tx
    .select({ id: schema.EntityInstance.id })
    .from(schema.EntityInstance)
    .innerJoin(
      schema.EntityDefinition,
      and(
        eq(schema.EntityDefinition.id, schema.EntityInstance.entityDefinitionId),
        eq(schema.EntityDefinition.organizationId, input.organizationId),
        eq(schema.EntityDefinition.entityType, 'contact'),
        isNull(schema.EntityDefinition.archivedAt)
      )
    )
    .where(
      and(
        eq(schema.EntityInstance.organizationId, input.organizationId),
        eq(schema.EntityInstance.id, memo.contactInstanceId),
        isNull(schema.EntityInstance.archivedAt)
      )
    )
    .limit(1)
  if (!customer) throw new UnprocessableEntityError('Credit customer is missing or archived')
  const [legacyPosting] = await tx
    .select({ id: schema.GlPosting.id })
    .from(schema.GlPostingLine)
    .innerJoin(
      schema.GlPosting,
      and(
        eq(schema.GlPosting.organizationId, input.organizationId),
        eq(schema.GlPosting.id, schema.GlPostingLine.glPostingId)
      )
    )
    .where(
      and(
        eq(schema.GlPostingLine.organizationId, input.organizationId),
        eq(schema.GlPostingLine.sourceType, 'credit_memo'),
        eq(schema.GlPostingLine.sourceId, memo.id)
      )
    )
    .limit(1)
  if (legacyPosting)
    throw new ConflictError(
      'Credit has existing journal history; reconcile its ownership before issuing again'
    )
  const lines = await loadCreditMemoLines(tx, input.organizationId, memo.lineIds)
  if (memo.invoiceInstanceId) {
    const invoice = await loadInvoiceForCredit(tx, input.organizationId, memo.invoiceInstanceId)
    if (
      !invoice ||
      invoice.contactInstanceId !== memo.contactInstanceId ||
      ['draft', 'void', 'written_off'].includes(invoice.status)
    )
      throw new UnprocessableEntityError(
        'Credit invoice must belong to the same customer and remain eligible for credit'
      )
  }
  if (!lines.length) throw new UnprocessableEntityError('Credit needs at least one line')
  let subtotal = 0n
  let tax = 0n
  for (const line of lines) {
    if (memo.source === 'channel' && line.taxTotalMinor === null)
      throw new UnprocessableEntityError(
        'Channel credit lines need explicit tax amounts, including zero'
      )
    for (const amount of [line.subtotalMinor, line.taxTotalMinor ?? 0])
      if (!Number.isSafeInteger(amount) || amount < 0)
        throw new UnprocessableEntityError(
          'Credit line amounts must be nonnegative exact minor units'
        )
    subtotal += BigInt(line.subtotalMinor)
    tax += BigInt(line.taxTotalMinor ?? 0)
  }
  const total = toLedgerMinor(subtotal + tax, 'USD', 2)
  if (!total) throw new UnprocessableEntityError('Credit must have a positive total')
  const currency = await getOrganizationSetting({
    db: tx,
    organizationId: input.organizationId,
    key: 'organization.currency',
  })
  if (currency !== 'USD') throw new UnprocessableEntityError('Credit accounting requires USD')
  const zone = await getOrganizationSetting({
    db: tx,
    organizationId: input.organizationId,
    key: 'accounting.bookTimeZone',
  })
  if (typeof zone !== 'string' || !zone)
    throw new UnprocessableEntityError('Book time zone is not configured')
  const scope = await readOrderSourceScope(tx, input.organizationId, memo.orderInstanceId)
  const resolvedControl = await resolveRoles(
    tx,
    input.organizationId,
    ['accounts_receivable'],
    scope
  )
  if (resolvedControl.isErr()) throw resolvedControl.error
  const controlId = resolvedControl.value.get('accounts_receivable')!.glAccountId
  const selected = await allocationComponents(tx, input, memo, subtotal, tax)
  const sourceHash = accountingBasisHash({
    memo: {
      id: memo.id,
      source: memo.source,
      number: memo.number,
      contact: memo.contactInstanceId,
      order: memo.orderInstanceId,
      invoice: memo.invoiceInstanceId,
    },
    lines,
    issuedAt: input.issuedAt,
    sourceAllocations: selected.evidence,
    sourceStoreId: scope.store ?? null,
    controlId,
  })
  const calculation: CustomerCreditAccountingBasisV1 = {
    version: 1,
    creditMemoInstanceId: memo.id,
    sourceHash,
    source: z.enum(['native', 'channel']).parse(memo.source),
    number: memo.number,
    contactInstanceId: memo.contactInstanceId,
    invoiceInstanceId: memo.invoiceInstanceId,
    orderInstanceId: memo.orderInstanceId,
    sourceStoreId: scope.store ?? null,
    creditControlGlAccountId: controlId,
    issuedAt: input.issuedAt,
    effectiveDate: input.issuedAt,
    currency: 'USD',
    currencyExponent: 2,
    subtotalMinor: subtotal.toString(),
    taxTotalMinor: tax.toString(),
    totalMinor: total.toString(),
    reverseRevenue: selected.components.some((c) => c.componentKey === 'earned_revenue'),
    sourceAllocations: selected.allocations,
    components: selected.components.map((c) => ({
      ...c,
      accountRole: roles[c.componentKey],
      direction: 'debit',
    })),
  }
  const workBasis = customerCreditWorkBasisSchema.parse({
    version: 1,
    status: 'ready',
    creditMemoInstanceId: memo.id,
    sourceHash,
    effectiveDate: input.issuedAt,
    calculation,
  })
  const built = buildCreditMemoEntitlementEntry({
    creditMemoId: memo.id,
    number: memo.number,
    issuedAt: input.issuedAt,
    currency: 'USD',
    ledgerCurrency: 'USD',
    total,
    components: calculation.components.map((c) => ({
      ...c,
      amount: toLedgerMinor(c.amountMinor, 'USD', 2),
    })),
    creditControlGlAccountId: controlId,
    contactInstanceId: memo.contactInstanceId,
  })
  if (memo.source === 'channel') {
    const componentLines: GlPostingLineInput[] = selected.evidence.map((source, sortOrder) => ({
      sourceType: 'credit_memo',
      sourceId: memo.id,
      ...(source.allocation.componentKey === 'earned_revenue'
        ? { accountRole: 'revenue_returns_allowances' }
        : { glAccountId: source.contribution.glAccountId }),
      direction: 'debit',
      amount: toLedgerMinor(source.allocation.amountMinor, 'USD', 2),
      sortOrder,
      dimensions: source.contribution.dimensions,
    }))
    componentLines.push({
      sourceType: 'credit_memo',
      sourceId: memo.id,
      glAccountId: controlId,
      direction: 'credit',
      amount: total,
      sortOrder: componentLines.length,
      counterpartyType: 'customer',
      counterpartyId: memo.contactInstanceId,
    })
    built.entry = buildEntry({
      postingType: 'credit_memo',
      periodKey: input.issuedAt,
      txnDate: input.issuedAt,
      lines: componentLines,
    })
  }
  for (const line of built.entry.lines) {
    line.dimensions = { ...line.dimensions, ...(scope.store ? { sourceStoreId: scope.store } : {}) }
    if (line.accountRole) line.sourceScope = scope
  }
  const resolved = await resolveAccountLines(tx, input.organizationId, built.entry.lines)
  if (resolved.isErr()) throw resolved.error
  const acceptedBasis = acceptedCustomerCreditEffectBasisSchema.parse({
    version: 1,
    sourceBasisVersion: 1,
    sourceHash,
    policyKey: 'customer_credit_issued_v1',
    policyVersion: 1,
    effectiveDate: input.issuedAt,
    bookTimeZone: zone,
    currency: 'USD',
    currencyExponent: 2,
    documentRefs: [{ resourceKind: 'credit_memo', entityInstanceId: memo.id }],
    calculation,
    accountResolution: built.entry.lines.map((line, i) => ({
      lineKey: `line:${i}`,
      glAccountId: resolved.value[i]!.glAccountId,
      accountRole: line.accountRole ?? null,
      selectedBy: line.glAccountId
        ? i < selected.evidence.length
          ? 'original_effect'
          : 'document'
        : 'org_role',
      configurationHash: accountingBasisHash(resolved.value[i]!),
    })),
    contribution: built.entry.lines.map((line, i) => ({
      lineKey: `line:${i}`,
      glAccountId: resolved.value[i]!.glAccountId,
      direction: line.direction,
      amountMinor: String(line.amount),
      counterpartyType: line.counterpartyType ?? null,
      counterpartyId: line.counterpartyId ?? null,
      dimensions: line.dimensions ?? {},
    })),
  })
  return {
    memo,
    total,
    subtotal: Number(subtotal),
    tax: Number(tax),
    workBasis,
    acceptedBasis,
    entry: built.entry,
  }
}

/** Commit credit issuance, exact accounting membership and delivery planning as one command. */
export async function issueCreditMemoAccounting(
  db: Database,
  input: IssueCreditMemoAccountingInput
) {
  z.iso.date().parse(input.issuedAt)
  return runCreditCommand(
    db,
    {
      organizationId: input.organizationId,
      userId: input.userId,
      commandKey: input.commandKey,
      kind: 'issue_customer_credit_accounting',
      payload: {
        creditMemoInstanceId: input.creditMemoInstanceId,
        issuedAt: input.issuedAt,
        sourceAllocations: input.sourceAllocations ?? [],
      },
    },
    async (tx) => {
      if (!(await isAccountingEnabled(tx, input.organizationId)))
        throw new UnprocessableEntityError('Accounting is not enabled')
      const setup = await getOrganizationSetting({
        db: tx,
        organizationId: input.organizationId,
        key: 'accounting.setupState',
      })
      if (setup !== FINALIZED_SETUP_STATE)
        throw new UnprocessableEntityError(
          'Finalize accounting setup before issuing accounting credits'
        )
      const cutoff = await getOrganizationSetting({
        db: tx,
        organizationId: input.organizationId,
        key: 'accounting.cutoffPeriod',
      })
      if (typeof cutoff === 'string' && input.issuedAt.slice(0, 7) <= cutoff)
        throw new UnprocessableEntityError('Credit precedes the accounting opening cutoff')
      const prepared = await prepareCredit(tx, input)
      if (prepared.memo.status !== 'draft')
        throw new ConflictError('Only a draft credit memo can be issued')
      const definition = await getEntityDefIdResolver(input.organizationId)
      const service = new FieldValueService(input.organizationId, input.userId, tx, undefined, {
        bypassFieldGuards: CREDIT_MEMO_STATUS_BYPASS,
      })
      const states = await service.setValuesForEntity({
        recordId: toRecordId(definition('credit_memo'), input.creditMemoInstanceId),
        values: [
          { fieldId: 'credit_memo_status', value: 'issued' },
          { fieldId: 'credit_memo_issued_at', value: `${input.issuedAt}T12:00:00.000Z` },
          { fieldId: 'credit_memo_subtotal', value: prepared.subtotal },
          { fieldId: 'credit_memo_tax_total', value: prepared.tax },
          { fieldId: 'credit_memo_total', value: prepared.total },
          { fieldId: 'credit_memo_balance', value: prepared.total },
        ],
      })
      if (states.some((state) => state.state === 'failed'))
        throw new ConflictError('Credit issuance fields could not be saved')
      const selected = await captureCustomerCreditWorkInTx(tx, {
        organizationId: input.organizationId,
        creditMemoInstanceId: input.creditMemoInstanceId,
        eligibility: 'manual',
        basis: prepared.workBasis,
      })
      const accepted = await acceptEntryInTx(
        tx,
        {
          organizationId: input.organizationId,
          actorUserId: input.userId,
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
            input.issuedAt
          ),
        },
        {
          revalidateMemberInTx: async (lockedTx, work) => ({
            ...(await prepareCredit(lockedTx, input)).acceptedBasis,
            sourceBasisVersion: work.basisVersion,
          }),
        }
      )
      if (accepted.status !== 'accepted' || !accepted.glPostingId)
        throw new ConflictError('Credit accounting membership changed')
      const stamp = await runWithCreditAccountingIssue([input.creditMemoInstanceId], () =>
        service.setValuesForEntity({
          recordId: toRecordId(definition('credit_memo'), input.creditMemoInstanceId),
          values: [{ fieldId: 'credit_memo_gl_posting', value: accepted.glPostingId }],
        })
      )
      if (stamp.some((state) => state.state === 'failed'))
        throw new ConflictError('Credit posting stamp could not be saved')
      await planAccountingDeliveryInTx(tx, {
        organizationId: input.organizationId,
        glPostingId: accepted.glPostingId,
      })
      return { glPostingId: accepted.glPostingId, creditMemoInstanceId: input.creditMemoInstanceId }
    }
  )
}
