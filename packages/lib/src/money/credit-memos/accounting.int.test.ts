// packages/lib/src/money/credit-memos/accounting.int.test.ts

import { type Database, schema } from '@auxx/database'
import { createTestOrganization, createTestUser, getTestDb } from '@auxx/test-utils'
import { and, eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getOrgCache } from '../../cache'
import { accountingBasisHash } from '../../postings/effect-basis'
import { acceptedCustomerReceiptEffectBasisSchema } from '../../postings/effect-types'
import { createEntityDefinitions } from '../../seed/entity-seeder/create-entity-defs'
import { createAllFields } from '../../seed/entity-seeder/create-fields'
import { linkRelationships } from '../../seed/entity-seeder/link-relationships'
import type { EntityDefMap } from '../../seed/entity-seeder/types'
import { issueCreditMemoAccounting } from './accounting'
import { applyCreditMemo, unapplyCreditMemo } from './apply'

// A command flush publishes ordinary record events after commit. Keep this suite focused on
// the transaction and ledger rows; no queue or provider is part of the fixture.
vi.mock('../../resources/crud/tx-write-flush', () => ({ flushTxWriteScope: vi.fn() }))
vi.mock('../../events', () => ({ publisher: { publish: vi.fn(), publishLater: vi.fn() } }))
vi.mock('../../postings/accounting-enabled', () => ({
  isAccountingEnabled: vi.fn(async () => true),
}))
vi.mock('@auxx/redis', async (original) => ({
  ...(await original<typeof import('@auxx/redis')>()),
  getRedisClient: async () => {
    throw new Error('No Redis in credit accounting database tests')
  },
}))

const db = () => getTestDb() as unknown as Database

type Fixture = {
  organizationId: string
  userId: string
  contactId: string
  contactDefinitionId: string
  orderId: string
  invoiceId: string
  memoId: string
  memoDefinitionId: string
  lineDefinitionId: string
  orderDefinitionId: string
  invoiceDefinitionId: string
  applicationDefinitionId: string
  lineItemDefinitionId: string
  taxLineDefinitionId: string
  fields: Map<string, typeof schema.CustomField.$inferSelect>
  accounts: Map<string, string>
}

let fixture: Fixture

async function instance(definitionId: string, userId: string) {
  const [row] = await db()
    .insert(schema.EntityInstance)
    .values({
      organizationId: fixture.organizationId,
      entityDefinitionId: definitionId,
      createdById: userId,
      updatedAt: new Date(),
    })
    .returning()
  return row!.id
}

async function fieldValue(
  entityId: string,
  attribute: string,
  data: Partial<typeof schema.FieldValue.$inferInsert>
) {
  const field = fixture.fields.get(attribute)
  if (!field) throw new Error(`fixture field missing: ${attribute}`)
  await db()
    .insert(schema.FieldValue)
    .values({
      organizationId: fixture.organizationId,
      entityId,
      fieldId: field.id,
      entityDefinitionId: field.entityDefinitionId!,
      sortKey: 'a0',
      ...data,
    })
}

async function seedChart() {
  const definition = fixture.accounts.get('__definition__')
  if (!definition) throw new Error('fixture GL definition missing')
  const roleTypes = {
    accounts_receivable: 'asset',
    clearing: 'asset',
    revenue_returns_allowances: 'revenue',
    customer_deposits: 'liability',
    sales_tax_payable: 'liability',
  } as const
  const accounts = new Map<string, string>()
  for (const [index, [role, type]] of Object.entries(roleTypes).entries()) {
    const accountId = await instance(definition, fixture.userId)
    await fieldValue(accountId, 'gl_account_code', { valueText: `${1200 + index * 100}` })
    await fieldValue(accountId, 'gl_account_name', { valueText: role })
    await fieldValue(accountId, 'gl_account_type', { optionId: type })
    accounts.set(role, accountId)
    await db().insert(schema.GlRoleAssignment).values({
      organizationId: fixture.organizationId,
      role,
      glAccountId: accountId,
      source: 'seed',
    })
  }
  fixture.accounts = accounts
}

async function seedMemo() {
  const contactDefinitionId = fixture.contactDefinitionId
  fixture.contactId = await instance(contactDefinitionId, fixture.userId)
  fixture.orderId = await instance(fixture.orderDefinitionId, fixture.userId)
  fixture.invoiceId = await instance(fixture.invoiceDefinitionId, fixture.userId)
  const orderLineId = await instance(fixture.lineItemDefinitionId, fixture.userId)
  const taxLineId = await instance(fixture.taxLineDefinitionId, fixture.userId)
  await fieldValue(fixture.orderId, 'order_subtotal', { valueNumber: 1000 })
  await fieldValue(fixture.orderId, 'order_tax_total', { valueNumber: 100 })
  await fieldValue(fixture.orderId, 'order_shipping_total', { valueNumber: 0 })
  await fieldValue(fixture.orderId, 'order_total', { valueNumber: 1100 })
  await fieldValue(fixture.orderId, 'order_currency', { valueText: 'USD' })
  await fieldValue(fixture.orderId, 'order_channel', { optionId: 'dtc' })
  await fieldValue(fixture.orderId, 'order_contact', {
    relatedEntityId: fixture.contactId,
    relatedEntityDefinitionId: contactDefinitionId,
  })
  await fieldValue(orderLineId, 'line_item_order', {
    relatedEntityId: fixture.orderId,
    relatedEntityDefinitionId: fixture.orderDefinitionId,
  })
  await fieldValue(orderLineId, 'line_item_net_total', { valueNumber: 1000 })
  await fieldValue(taxLineId, 'tax_line_order', {
    relatedEntityId: fixture.orderId,
    relatedEntityDefinitionId: fixture.orderDefinitionId,
  })
  await fieldValue(taxLineId, 'tax_line_price', { valueNumber: 100 })
  await fieldValue(taxLineId, 'tax_line_title', { valueText: 'US-CA' })
  await fieldValue(taxLineId, 'tax_line_channel_liable', { valueBoolean: false })
  await fieldValue(fixture.invoiceId, 'invoice_number', { valueText: 'INV-INT-1' })
  await fieldValue(fixture.invoiceId, 'invoice_status', { optionId: 'sent' })
  await fieldValue(fixture.invoiceId, 'invoice_contact', {
    relatedEntityId: fixture.contactId,
    relatedEntityDefinitionId: contactDefinitionId,
  })
  await fieldValue(fixture.invoiceId, 'invoice_subtotal', { valueNumber: 1000 })
  await fieldValue(fixture.invoiceId, 'invoice_tax_total', { valueNumber: 100 })
  await fieldValue(fixture.invoiceId, 'invoice_total', { valueNumber: 1100 })
  await fieldValue(fixture.invoiceId, 'invoice_amount_paid', { valueNumber: 0 })
  await fieldValue(fixture.invoiceId, 'invoice_amount_credited', { valueNumber: 0 })
  await fieldValue(fixture.invoiceId, 'invoice_balance', { valueNumber: 1100 })
  fixture.memoId = await instance(fixture.memoDefinitionId, fixture.userId)
  const lineId = await instance(fixture.lineDefinitionId, fixture.userId)

  await fieldValue(fixture.memoId, 'credit_memo_number', { valueText: 'CM-INT-1' })
  await fieldValue(fixture.memoId, 'credit_memo_status', { optionId: 'draft' })
  await fieldValue(fixture.memoId, 'credit_memo_source', { optionId: 'native' })
  await fieldValue(fixture.memoId, 'credit_memo_contact', {
    relatedEntityId: fixture.contactId,
    relatedEntityDefinitionId: contactDefinitionId,
  })
  await fieldValue(fixture.memoId, 'credit_memo_subtotal', { valueNumber: 1000 })
  await fieldValue(fixture.memoId, 'credit_memo_tax_total', { valueNumber: 100 })
  await fieldValue(fixture.memoId, 'credit_memo_total', { valueNumber: 1100 })
  await fieldValue(fixture.memoId, 'credit_memo_balance', { valueNumber: 1100 })
  await fieldValue(fixture.memoId, 'credit_memo_lines', {
    relatedEntityId: lineId,
    relatedEntityDefinitionId: fixture.lineDefinitionId,
  })

  await fieldValue(lineId, 'credit_memo_line_credit_memo', {
    relatedEntityId: fixture.memoId,
    relatedEntityDefinitionId: fixture.memoDefinitionId,
  })
  await fieldValue(lineId, 'credit_memo_line_description', { valueText: 'Returned item' })
  await fieldValue(lineId, 'credit_memo_line_qty', { valueNumber: 1 })
  await fieldValue(lineId, 'credit_memo_line_unit_price', { valueNumber: 1000 })
  await fieldValue(lineId, 'credit_memo_line_subtotal', { valueNumber: 1000 })
  await fieldValue(lineId, 'credit_memo_line_tax_total', { valueNumber: 100 })
  await fieldValue(lineId, 'credit_memo_line_disposition', { optionId: 'returned' })
  await fieldValue(lineId, 'credit_memo_line_sort_order', { valueNumber: 0 })
}

async function makeChannelMemo() {
  await db()
    .update(schema.FieldValue)
    .set({ optionId: 'channel' })
    .where(
      and(
        eq(schema.FieldValue.entityId, fixture.memoId),
        eq(schema.FieldValue.fieldId, fixture.fields.get('credit_memo_source')!.id)
      )
    )
  await fieldValue(fixture.memoId, 'credit_memo_order', {
    relatedEntityId: fixture.orderId,
    relatedEntityDefinitionId: fixture.orderDefinitionId,
  })
  await fieldValue(fixture.memoId, 'credit_memo_issued_at', {
    valueDate: '2026-09-15T12:00:00.000Z',
  })
}

/** Seed a valid accepted receipt effect so channel credits must consume frozen source lines. */
async function seedAcceptedReceiptSource(orderInstanceId = fixture.orderId) {
  const sourceHash = 'b'.repeat(64)
  const historyHash = 'c'.repeat(64)
  const moneyCommand = await db()
    .insert(schema.MoneyCommand)
    .values({
      organizationId: fixture.organizationId,
      commandKey: `receipt-source-${orderInstanceId}`,
      kind: 'receipt-source-fixture',
      payloadHash: sourceHash,
      actorSnapshot: { kind: 'test' },
    })
    .returning({ id: schema.MoneyCommand.id })
  const money = await db()
    .insert(schema.MoneyTransaction)
    .values({
      organizationId: fixture.organizationId,
      purpose: 'customer_receipt',
      amountMinor: 1100n,
      currency: 'USD',
      currencyExponent: 2,
      datePrecision: 'date',
      occurredOn: '2026-09-15',
      partyInstanceId: fixture.contactId,
      recordedByCommandId: moneyCommand[0]!.id,
    })
    .returning({ id: schema.MoneyTransaction.id })
  const posting = await db()
    .insert(schema.GlPosting)
    .values({
      organizationId: fixture.organizationId,
      postingType: 'payment',
      postedAt: new Date('2026-09-15T12:00:00.000Z'),
      periodKey: `source-${orderInstanceId}`,
      txnDate: '2026-09-15',
      docNumber: `SRC-${orderInstanceId.slice(-8)}`,
      totalMinor: 1100,
      draft: {},
      requestId: `source-request-${orderInstanceId}`,
      deliveryIntent: 'not_required',
    })
    .returning({ id: schema.GlPosting.id })
  const calculation = {
    version: 1 as const,
    moneyTransactionId: money[0]!.id,
    orderInstanceId,
    sourceObjectId: null,
    sourceExternalId: 'receipt-source',
    sourceRevision: 'source-revision',
    sourceHash,
    historyHash,
    occurredAt: '2026-09-15T12:00:00.000Z',
    effectiveDate: '2026-09-15',
    currency: 'USD' as const,
    currencyExponent: 2 as const,
    amountMinor: '1100',
    orderSubtotalMinor: '1000',
    orderTaxMinor: '100',
    orderShippingMinor: '0',
    orderTotalMinor: '1100',
    receiptAmountMinor: '1100',
    receivableMinor: '0',
    depositMinor: '1000',
    taxMinor: '100',
    allocation: {
      amountMinor: '1100',
      depositMinor: '1000',
      receivableMinor: '0',
      taxMinor: '100',
    },
    paymentGatewayId: 'payment-gateway-source',
    sourceStoreId: 'source-store',
    route: {
      paymentGatewayId: 'payment-gateway-source',
      glAccountId: fixture.accounts.get('clearing')!,
      reason: 'fixture',
    },
    applications: [
      {
        applicationId: 'application-source',
        orderInstanceId,
        amountMinor: '1100',
        effectiveDate: '2026-09-15',
      },
    ],
    taxComponents: [
      {
        componentKey: 'sales-tax',
        amountMinor: '100',
        jurisdiction: 'US-CA',
        collector: 'merchant' as const,
        remitter: 'merchant' as const,
        withholdingEvidenceId: null,
      },
    ],
  }
  const acceptedBasis = {
    version: 1 as const,
    sourceBasisVersion: 1,
    sourceHash,
    policyKey: 'shopify_receipt_v1' as const,
    policyVersion: 1 as const,
    effectiveDate: '2026-09-15',
    bookTimeZone: 'UTC',
    currency: 'USD' as const,
    currencyExponent: 2 as const,
    documentRefs: [
      { resourceKind: 'order', entityInstanceId: orderInstanceId },
      { resourceKind: 'money_transaction', entityInstanceId: money[0]!.id },
    ],
    calculation,
    accountResolution: [
      {
        lineKey: 'line:ar',
        glAccountId: fixture.accounts.get('clearing')!,
        accountRole: 'clearing',
        selectedBy: 'route' as const,
        configurationHash: 'f'.repeat(64),
      },
      {
        lineKey: 'line:deposit',
        glAccountId: fixture.accounts.get('customer_deposits')!,
        accountRole: 'customer_deposits',
        selectedBy: 'org_role' as const,
        configurationHash: 'd'.repeat(64),
      },
      {
        lineKey: 'line:tax',
        glAccountId: fixture.accounts.get('sales_tax_payable')!,
        accountRole: 'sales_tax_payable',
        selectedBy: 'org_role' as const,
        configurationHash: 'e'.repeat(64),
      },
    ],
    contribution: [
      {
        lineKey: 'line:ar',
        glAccountId: fixture.accounts.get('clearing')!,
        direction: 'debit' as const,
        amountMinor: '1100',
        counterpartyType: null,
        counterpartyId: null,
        dimensions: {
          sourceProvider: 'shopify',
          sourceStoreId: 'source-store',
          paymentGatewayId: 'payment-gateway-source',
          orderId: orderInstanceId,
        },
      },
      {
        lineKey: 'line:deposit',
        glAccountId: fixture.accounts.get('customer_deposits')!,
        direction: 'credit' as const,
        amountMinor: '1000',
        counterpartyType: 'customer' as const,
        counterpartyId: fixture.contactId,
        dimensions: {
          sourceProvider: 'shopify',
          sourceStoreId: 'source-store',
          paymentGatewayId: 'payment-gateway-source',
          orderId: orderInstanceId,
        },
      },
      {
        lineKey: 'line:tax',
        glAccountId: fixture.accounts.get('sales_tax_payable')!,
        direction: 'credit' as const,
        amountMinor: '100',
        counterpartyType: null,
        counterpartyId: null,
        dimensions: {
          sourceProvider: 'shopify',
          sourceStoreId: 'source-store',
          paymentGatewayId: 'payment-gateway-source',
          orderId: orderInstanceId,
          jurisdiction: 'US-CA',
          taxComponentId: 'sales-tax',
        },
      },
    ],
  }
  const parsedAcceptedBasis = acceptedCustomerReceiptEffectBasisSchema.parse(acceptedBasis)
  const [work] = await db()
    .insert(schema.AccountingWork)
    .values({
      organizationId: fixture.organizationId,
      moneyTransactionId: money[0]!.id,
      effectKind: 'customer_receipt',
      effectKey: `receipt-source-effect-${orderInstanceId}`,
      operation: 'original',
      basisVersion: 1,
      state: 'accepted',
      eligibility: 'automatic',
    })
    .returning({ id: schema.AccountingWork.id })
  await db()
    .insert(schema.AccountingWorkBasis)
    .values({
      organizationId: fixture.organizationId,
      workId: work!.id,
      version: 1,
      sourceHash,
      effectiveDate: '2026-09-15',
      basis: {
        version: 1,
        status: 'ready',
        moneyTransactionId: money[0]!.id,
        sourceHash,
        effectiveDate: '2026-09-15',
        calculation,
      },
    })
  await db()
    .insert(schema.AccountingEffect)
    .values({
      organizationId: fixture.organizationId,
      workId: work!.id,
      basisVersion: 1,
      glPostingId: posting[0]!.id,
      effectiveDate: '2026-09-15',
      currency: 'USD',
      currencyExponent: 2,
      acceptedBasis: parsedAcceptedBasis,
      basisHash: accountingBasisHash(parsedAcceptedBasis),
    })
  return {
    effectId: (await db().query.AccountingEffect.findFirst({
      where: eq(schema.AccountingEffect.workId, work!.id),
    }))!.id,
  }
}

beforeEach(async () => {
  const organization = await createTestOrganization()
  const user = await createTestUser({ name: 'Credit accountant' })
  const organizationId = organization.id
  await db()
    .update(schema.Organization)
    .set({ systemUserId: user.id })
    .where(eq(schema.Organization.id, organizationId))

  const all = await createEntityDefinitions(db(), organizationId)
  const kinds = [
    'contact',
    'order',
    'line_item',
    'tax_line',
    'invoice',
    'credit_memo_application',
    'credit_memo',
    'credit_memo_line',
    'gl_account',
  ]
  const defs: EntityDefMap = new Map([...all].filter(([kind]) => kinds.includes(kind)))
  const seededFields = await createAllFields(db(), organizationId, defs)
  const fieldMap = (
    await db()
      .select()
      .from(schema.CustomField)
      .where(eq(schema.CustomField.organizationId, organizationId))
  ).reduce((map, field) => {
    if (field.systemAttribute) map.set(field.systemAttribute, field)
    return map
  }, new Map<string, typeof schema.CustomField.$inferSelect>())
  await linkRelationships(db(), defs, seededFields)
  await getOrgCache().invalidateAndRecompute(organizationId, ['customFields', 'resources'])

  fixture = {
    organizationId,
    userId: user.id,
    contactId: '',
    contactDefinitionId: defs.get('contact')!.id,
    orderId: '',
    invoiceId: '',
    memoId: '',
    memoDefinitionId: defs.get('credit_memo')!.id,
    lineDefinitionId: defs.get('credit_memo_line')!.id,
    orderDefinitionId: defs.get('order')!.id,
    invoiceDefinitionId: defs.get('invoice')!.id,
    applicationDefinitionId: defs.get('credit_memo_application')!.id,
    lineItemDefinitionId: defs.get('line_item')!.id,
    taxLineDefinitionId: defs.get('tax_line')!.id,
    fields: fieldMap,
    accounts: new Map([['__definition__', defs.get('gl_account')!.id]]),
  }
  await db()
    .insert(schema.OrganizationSetting)
    .values([
      { organizationId, key: 'accounting.setupState', value: 'finalized', updatedAt: new Date() },
      { organizationId, key: 'accounting.bookTimeZone', value: 'UTC', updatedAt: new Date() },
      { organizationId, key: 'organization.currency', value: 'USD', updatedAt: new Date() },
    ])
  await seedChart()
  await seedMemo()
  await getOrgCache().invalidateAndRecompute(organizationId, ['customFields', 'resources'])
})

describe('issueCreditMemoAccounting against PostgreSQL', () => {
  const input = () => ({
    organizationId: fixture.organizationId,
    userId: fixture.userId,
    commandKey: 'issue-native-credit',
    creditMemoInstanceId: fixture.memoId,
    issuedAt: '2026-09-15',
  })

  it('issues a native credit from actual memo fields and mapped roles', async () => {
    const result = await issueCreditMemoAccounting(db(), input())
    expect(result).toMatchObject({ creditMemoInstanceId: fixture.memoId })

    const effects = await db().query.AccountingEffect.findMany()
    expect(effects).toHaveLength(1)
    const [work] = await db().query.AccountingWork.findMany()
    expect(work).toMatchObject({
      effectKind: 'customer_credit_issued',
      entityInstanceId: fixture.memoId,
      state: 'accepted',
    })
    const [posting] = await db().query.GlPosting.findMany()
    expect(posting).toMatchObject({ postingType: 'credit_memo', txnDate: '2026-09-15' })
    const lines = await db().query.GlPostingLine.findMany()
    expect(lines).toHaveLength(3)
    expect(lines.reduce((sum, line) => sum + line.amountMinor, 0)).toBe(2200)
    expect(new Set(lines.map((line) => line.glAccountId))).toEqual(
      new Set([
        fixture.accounts.get('accounts_receivable'),
        fixture.accounts.get('revenue_returns_allowances'),
        fixture.accounts.get('sales_tax_payable'),
      ])
    )
  })

  it('replays the same command result without another journal or effect', async () => {
    const first = await issueCreditMemoAccounting(db(), input())
    const second = await issueCreditMemoAccounting(db(), input())
    expect(second).toEqual(first)
    expect(await db().query.MoneyCommand.findMany()).toHaveLength(1)
    expect(await db().query.GlPosting.findMany()).toHaveLength(1)
    expect(await db().query.AccountingEffect.findMany()).toHaveLength(1)
  })

  it('keeps application and inverse application usable after accepted credit issuance', async () => {
    await issueCreditMemoAccounting(db(), input())
    const applied = await applyCreditMemo(db(), {
      organizationId: fixture.organizationId,
      userId: fixture.userId,
      creditMemoInstanceId: fixture.memoId,
      invoiceInstanceId: fixture.invoiceId,
      amount: 500,
      commandKey: 'credit-application-after-issue',
    })
    expect(applied.applicationInstanceId).toBeTruthy()
    const afterApply = await db().query.FieldValue.findMany({
      where: eq(schema.FieldValue.entityId, fixture.memoId),
    })
    expect(
      afterApply.find((row) => row.fieldId === fixture.fields.get('credit_memo_amount_applied')!.id)
        ?.valueNumber
    ).toBe(500)
    await unapplyCreditMemo(db(), {
      organizationId: fixture.organizationId,
      userId: fixture.userId,
      applicationInstanceId: applied.applicationInstanceId,
    })
    const applications = await db().query.EntityInstance.findMany({
      where: eq(schema.EntityInstance.entityDefinitionId, fixture.applicationDefinitionId),
    })
    expect(applications).toHaveLength(2)
    const afterUnapply = await db().query.FieldValue.findMany({
      where: eq(schema.FieldValue.entityId, fixture.memoId),
    })
    expect(
      afterUnapply.find((row) => row.fieldId === fixture.fields.get('credit_memo_balance')!.id)
        ?.valueNumber
    ).toBe(1100)
  })

  it('rejects source allocations on a native memo before creating accounting history', async () => {
    await expect(
      issueCreditMemoAccounting(db(), {
        ...input(),
        commandKey: 'native-source-allocation',
        sourceAllocations: [
          {
            effectId: 'accepted-effect',
            lineKey: 'line:0',
            amountMinor: '1000',
            componentKey: 'earned_revenue',
          },
        ],
      })
    ).rejects.toThrow(/Native credit memos use their own document line basis/)
    expect(await db().query.MoneyCommand.findMany()).toHaveLength(0)
    expect(await db().query.AccountingWork.findMany()).toHaveLength(0)
    expect(await db().query.AccountingEffect.findMany()).toHaveLength(0)
    expect(await db().query.GlPosting.findMany()).toHaveLength(0)
  })

  it('issues a channel credit only against matching accepted source lines', async () => {
    await makeChannelMemo()
    const source = await seedAcceptedReceiptSource()
    const result = await issueCreditMemoAccounting(db(), {
      ...input(),
      commandKey: 'channel-source-credit',
      sourceAllocations: [
        {
          effectId: source.effectId,
          lineKey: 'line:deposit',
          amountMinor: '1000',
          componentKey: 'customer_deposit',
        },
        {
          effectId: source.effectId,
          lineKey: 'line:tax',
          amountMinor: '100',
          componentKey: 'sales_tax',
        },
      ],
    })
    expect(result).toMatchObject({ creditMemoInstanceId: fixture.memoId })
    expect(await db().query.AccountingEffect.findMany()).toHaveLength(2)
    expect(await db().query.GlPosting.findMany()).toHaveLength(2)
  })

  it('rejects channel source lines from another order and amounts beyond the accepted line', async () => {
    await makeChannelMemo()
    const validSource = await seedAcceptedReceiptSource()
    const wrongOrderSource = await seedAcceptedReceiptSource('other-order')
    const base = {
      ...input(),
      sourceAllocations: [
        {
          effectId: wrongOrderSource.effectId,
          lineKey: 'line:deposit',
          amountMinor: '1000',
          componentKey: 'customer_deposit' as const,
        },
        {
          effectId: wrongOrderSource.effectId,
          lineKey: 'line:tax',
          amountMinor: '100',
          componentKey: 'sales_tax' as const,
        },
      ],
    }
    await expect(
      issueCreditMemoAccounting(db(), { ...base, commandKey: 'wrong-order-source' })
    ).rejects.toThrow(/does not belong to this order/)
    await expect(
      issueCreditMemoAccounting(db(), {
        ...base,
        commandKey: 'over-credit-source',
        sourceAllocations: [
          { ...base.sourceAllocations[0]!, effectId: validSource.effectId, amountMinor: '1001' },
          { ...base.sourceAllocations[1]!, effectId: validSource.effectId },
        ],
      })
    ).rejects.toThrow(/already been credited/)
    expect(await db().query.AccountingEffect.findMany()).toHaveLength(2)
    expect(await db().query.GlPosting.findMany()).toHaveLength(2)
  })

  it('rejects a changed channel date and a receipt belonging to another customer', async () => {
    await makeChannelMemo()
    const source = await seedAcceptedReceiptSource()
    const request = {
      ...input(),
      sourceAllocations: [
        {
          effectId: source.effectId,
          lineKey: 'line:deposit',
          amountMinor: '1000',
          componentKey: 'customer_deposit' as const,
        },
        {
          effectId: source.effectId,
          lineKey: 'line:tax',
          amountMinor: '100',
          componentKey: 'sales_tax' as const,
        },
      ],
    }
    await expect(
      issueCreditMemoAccounting(db(), { ...request, issuedAt: '2026-09-16' })
    ).rejects.toThrow(/stored provider credit date/)
    const otherCustomer = await instance(fixture.contactDefinitionId, fixture.userId)
    await db()
      .update(schema.MoneyTransaction)
      .set({ partyInstanceId: otherCustomer })
      .where(eq(schema.MoneyTransaction.organizationId, fixture.organizationId))
    await expect(issueCreditMemoAccounting(db(), request)).rejects.toThrow(
      /receipt customer does not match/
    )
    expect(await db().query.AccountingEffect.findMany()).toHaveLength(1)
  })

  it('rolls back fields, work, effect and command when a role is missing', async () => {
    await db()
      .delete(schema.GlRoleAssignment)
      .where(
        and(
          eq(schema.GlRoleAssignment.organizationId, fixture.organizationId),
          eq(schema.GlRoleAssignment.role, 'accounts_receivable')
        )
      )
    await expect(issueCreditMemoAccounting(db(), input())).rejects.toThrow(/accounts_receivable/)
    expect(await db().query.MoneyCommand.findMany()).toHaveLength(0)
    expect(await db().query.AccountingWork.findMany()).toHaveLength(0)
    expect(await db().query.AccountingEffect.findMany()).toHaveLength(0)
    expect(await db().query.GlPosting.findMany()).toHaveLength(0)
    const status = await db().query.FieldValue.findMany({
      where: eq(schema.FieldValue.entityId, fixture.memoId),
    })
    expect(
      status.find((row) => row.fieldId === fixture.fields.get('credit_memo_status')!.id)?.optionId
    ).toBe('draft')
  })

  it('rolls back the pre-acceptance stamps when the accounting period is closed', async () => {
    await db().insert(schema.OrganizationSetting).values({
      organizationId: fixture.organizationId,
      key: 'ledger.lockedThroughMonth',
      value: '2026-09',
      updatedAt: new Date(),
    })
    await expect(issueCreditMemoAccounting(db(), input())).rejects.toThrow(
      /Accounting period 2026-09 is closed through 2026-09/
    )
    expect(await db().query.MoneyCommand.findMany()).toHaveLength(0)
    expect(await db().query.AccountingWork.findMany()).toHaveLength(0)
    expect(await db().query.AccountingEffect.findMany()).toHaveLength(0)
    expect(await db().query.GlPosting.findMany()).toHaveLength(0)
    const values = await db().query.FieldValue.findMany({
      where: eq(schema.FieldValue.entityId, fixture.memoId),
    })
    expect(
      values.find((row) => row.fieldId === fixture.fields.get('credit_memo_status')!.id)?.optionId
    ).toBe('draft')
  })
})
