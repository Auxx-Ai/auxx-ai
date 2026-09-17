// packages/lib/src/money/customer-money/__tests__/accounting.int.test.ts
import { schema } from '@auxx/database'
import { createTestOrganization, createTestUser, getTestDb } from '@auxx/test-utils'
import { and, eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { accountingBasisHash } from '../../../postings/effect-basis'
import { acceptFulfillmentWorkGroup } from '../../fulfillment-posting/run'
import { postCustomerReceiptAccounting } from '../accounting'

vi.mock('../../../postings/accounting-enabled', () => ({
  isAccountingEnabled: async () => true,
}))

const db = () => getTestDb()
const SOURCE_HASH = 'a'.repeat(64)
const processedAt = '2026-09-15T10:00:00.000Z'

type Field = { id: string; definitionId: string }

let organizationId: string
let orderId: string
let lineItemId: string
let taxLineId: string
let sourceStoreId: string
let gatewayId: string
let clearingGlAccountId: string
let coverageId: string
let receiptCount: number
let fields: Record<string, Field>

async function createDefinition(entityType: string, attributes: string[]) {
  const [definition] = await db()
    .insert(schema.EntityDefinition)
    .values({
      organizationId,
      entityType,
      apiSlug: entityType,
      singular: entityType,
      plural: entityType,
    })
    .returning()
  for (const attribute of attributes) {
    const [field] = await db()
      .insert(schema.CustomField)
      .values({
        organizationId,
        entityDefinitionId: definition!.id,
        name: attribute,
        type:
          attribute.includes('subtotal') ||
          attribute.includes('tax_total') ||
          attribute.includes('shipping_total') ||
          attribute.includes('order_total') ||
          attribute.includes('net_total') ||
          attribute.includes('tax_line_price')
            ? 'NUMBER'
            : attribute.includes('contact') ||
                attribute.includes('line_item_order') ||
                attribute.includes('tax_line_order')
              ? 'RELATIONSHIP'
              : attribute.includes('channel_liable')
                ? 'CHECKBOX'
                : attribute === 'gl_account_type'
                  ? 'SINGLE_SELECT'
                  : 'TEXT',
        systemAttribute: attribute,
        updatedAt: new Date(),
      })
      .returning()
    fields[attribute] = { id: field!.id, definitionId: definition!.id }
  }
  return definition!.id
}

async function createInstance(definitionId: string) {
  const [instance] = await db()
    .insert(schema.EntityInstance)
    .values({ organizationId, entityDefinitionId: definitionId, updatedAt: new Date() })
    .returning()
  return instance!.id
}

async function value(
  entityId: string,
  attribute: string,
  data: Partial<typeof schema.FieldValue.$inferInsert>
) {
  const field = fields[attribute]!
  await db()
    .insert(schema.FieldValue)
    .values({
      organizationId,
      entityId,
      fieldId: field.id,
      entityDefinitionId: field.definitionId,
      sortKey: 'a0',
      ...data,
    })
}

async function seedChart() {
  const definitionId = await createDefinition('gl_account', [
    'gl_account_code',
    'gl_account_name',
    'gl_account_type',
  ])
  const accounts = await Promise.all(
    [
      ['clearing', 'asset', '1100'],
      ['deposits', 'liability', '2200'],
      ['tax', 'liability', '2300'],
      ['receivable', 'asset', '1200'],
      ['product', 'revenue', '4000'],
      ['shipping', 'revenue', '4100'],
    ].map(async ([name, type, code]) => {
      const id = await createInstance(definitionId)
      await value(id, 'gl_account_code', { valueText: code })
      await value(id, 'gl_account_name', { valueText: name })
      await value(id, 'gl_account_type', { optionId: type })
      return { id, name }
    })
  )
  clearingGlAccountId = accounts[0]!.id
  await db()
    .insert(schema.GlRoleAssignment)
    .values([
      {
        organizationId,
        role: 'customer_deposits',
        glAccountId: accounts[1]!.id,
        source: 'seed',
      },
      {
        organizationId,
        role: 'sales_tax_payable',
        glAccountId: accounts[2]!.id,
        source: 'seed',
      },
      ...(['accounts_receivable', 'revenue_product', 'revenue_shipping'] as const).map(
        (role, i) => ({
          organizationId,
          role,
          glAccountId: accounts[i + 3]!.id,
          source: 'seed' as const,
        })
      ),
    ])
}

// 58 §5.6: the rail is the store feed's own `paymentGatewayId` link (D3), and
// its clearing account resolves through the rail-scoped `GlRoleAssignment`
// (§5.1) - there is no `PaymentRoute` in the receipt lane any more.
async function seedGateway() {
  const sourceDefinitionId = await createDefinition('payment_gateway', [
    'payment_gateway_name',
    'payment_gateway_handles',
    'payment_gateway_status',
  ])
  gatewayId = await createInstance(sourceDefinitionId)
  await value(gatewayId, 'payment_gateway_name', { valueText: 'Shopify Payments' })
  await value(gatewayId, 'payment_gateway_handles', { optionId: 'shopify_payments' })
  await value(gatewayId, 'payment_gateway_status', { optionId: 'active' })

  await db()
    .update(schema.FinancialSourceAccount)
    .set({ paymentGatewayId: gatewayId })
    .where(eq(schema.FinancialSourceAccount.id, sourceStoreId))
  await db().insert(schema.GlRoleAssignment).values({
    organizationId,
    role: 'clearing',
    paymentGatewayId: gatewayId,
    glAccountId: clearingGlAccountId,
    source: 'seed',
  })
}

async function seedConnectorAndCoverage() {
  const [developer] = await db()
    .insert(schema.DeveloperAccount)
    .values({ slug: 'shopify-fixture', title: 'Shopify fixture' })
    .returning()
  const [app] = await db()
    .insert(schema.App)
    .values({ developerAccountId: developer!.id, slug: 'shopify', title: 'Shopify' })
    .returning()
  const [installation] = await db()
    .insert(schema.AppInstallation)
    .values({ organizationId, appId: app!.id, installationType: 'production' })
    .returning()
  const [credential] = await db()
    .insert(schema.Credential)
    .values({
      organizationId,
      kind: 'app',
      appId: app!.id,
      appInstallationId: installation!.id,
      name: 'Shopify fixture',
      encryptedSecrets: 'fixture',
      metadata: { connectionVariables: { shop: 'fixture.myshopify.com' } },
      updatedAt: new Date(),
    })
    .returning()
  const [connector] = await db()
    .insert(schema.DataConnector)
    .values({
      organizationId,
      type: 'app:shopify',
      definitionKind: 'builtin',
      name: 'Shopify fixture',
      credentialId: credential!.id,
      appInstallationId: installation!.id,
      status: 'live',
      config: {},
      state: {},
    })
    .returning()
  const [stream] = await db()
    .insert(schema.DataConnectorStream)
    .values({
      organizationId,
      dataConnectorId: connector!.id,
      streamKey: 'order',
      sourceSchema: { type: 'object' },
      schemaSource: 'catalog',
    })
    .returning()
  const [mapping] = await db()
    .insert(schema.DataConnectorMapping)
    .values({
      organizationId,
      dataConnectorStreamId: stream!.id,
      rootPath: '',
      linkMode: 'upsert',
      targetMode: 'contributing',
      entityDefinitionId: fields.order_currency!.definitionId,
      fieldMappings: [],
    })
    .returning()
  await db().insert(schema.DataConnectorItem).values({
    organizationId,
    dataConnectorId: connector!.id,
    mappingId: mapping!.id,
    externalId: 'order-fixture',
    entityDefinitionId: fields.order_currency!.definitionId,
    entityInstanceId: orderId,
  })
  const [coverage] = await db()
    .insert(schema.FinancialSourceCoverage)
    .values({
      organizationId,
      sourceAccountId: sourceStoreId,
      streamKey: 'order_transactions',
      windowKey: orderId,
      requestedBoundary: { complete: true },
      fetchedBoundary: { complete: true },
      fetchedCount: 0,
      acceptedCount: 0,
      rejectedCount: 0,
      pendingCount: 0,
      complete: true,
    })
    .returning()
  coverageId = coverage!.id
}

async function setCoverage(count: number) {
  await db()
    .update(schema.FinancialSourceCoverage)
    .set({ fetchedCount: count, acceptedCount: count, updatedAt: new Date() })
    .where(eq(schema.FinancialSourceCoverage.id, coverageId))
}

async function createReceipt(amountMinor: bigint, externalId: string, occurredAt = processedAt) {
  const [command] = await db()
    .insert(schema.MoneyCommand)
    .values({
      organizationId,
      commandKey: `receipt-${externalId}`,
      kind: 'shopify_receipt_fixture',
      payloadHash: SOURCE_HASH,
      actorSnapshot: { kind: 'test' },
    })
    .returning()
  const [money] = await db()
    .insert(schema.MoneyTransaction)
    .values({
      organizationId,
      purpose: 'customer_receipt',
      amountMinor,
      currency: 'USD',
      currencyExponent: 2,
      datePrecision: 'instant',
      occurredAt: new Date(occurredAt),
      partyInstanceId: await getContactId(),
      recordedByCommandId: command!.id,
    })
    .returning()
  await db()
    .insert(schema.MoneyApplication)
    .values({
      organizationId,
      moneyTransactionId: money!.id,
      operation: 'apply',
      amountMinor,
      orderInstanceId: orderId,
      appliedAt: new Date(occurredAt),
      effectiveDate: occurredAt.slice(0, 10),
      commandId: command!.id,
      commandItemKey: 'order-application',
    })
  const payload = {
    version: 2,
    id: externalId,
    kind: 'receipt',
    status: 'confirmed',
    amount: (Number(amountMinor) / 100).toFixed(2),
    currency: 'USD',
    processedAt: occurredAt,
    gateway: 'shopify_payments',
    settlementCurrency: 'USD',
    parentTransactionId: null,
    creditMemoExternalId: null,
    paymentId: null,
    test: false,
  }
  const [object] = await db()
    .insert(schema.FinancialSourceObject)
    .values({
      organizationId,
      sourceAccountId: sourceStoreId,
      objectType: 'order_transaction',
      externalId,
      componentKey: '',
    })
    .returning()
  const [observation] = await db()
    .insert(schema.FinancialSourceObservation)
    .values({
      organizationId,
      sourceObjectId: object!.id,
      contentHash: accountingBasisHash(payload),
      observedAt: new Date(),
      payload,
      reportingInstallationSnapshot: { connectorId: 'fixture' },
    })
    .returning()
  await db().insert(schema.FinancialSourceAcceptance).values({
    organizationId,
    sourceObjectId: object!.id,
    observationId: observation!.id,
    state: 'accepted',
    orderExternalId: 'order-fixture',
    orderInstanceId: orderId,
    moneyTransactionId: money!.id,
  })
  await db().insert(schema.MoneySourceLink).values({
    organizationId,
    sourceObjectId: object!.id,
    moneyTransactionId: money!.id,
    verifiedByCommandId: command!.id,
  })
  receiptCount += 1
  await setCoverage(receiptCount)
  return money!.id
}

let contactId: string
async function getContactId() {
  return contactId
}

beforeEach(async () => {
  organizationId = (await createTestOrganization()).id
  fields = {}
  receiptCount = 0
  const orderDefinitionId = await createDefinition('order', [
    'order_number',
    'order_channel',
    'order_subtotal',
    'order_tax_total',
    'order_shipping_total',
    'order_total',
    'order_currency',
    'order_contact',
  ])
  const contactDefinitionId = await createDefinition('contact', [])
  const lineDefinitionId = await createDefinition('line_item', [
    'line_item_order',
    'line_item_net_total',
    'line_item_qty',
    'line_item_unit_price',
  ])
  const taxDefinitionId = await createDefinition('tax_line', [
    'tax_line_order',
    'tax_line_price',
    'tax_line_title',
    'tax_line_channel_liable',
  ])
  await createDefinition('fulfillment', [
    'fulfillment_order',
    'fulfillment_shipped_at',
    'fulfillment_sequence',
    'fulfillment_status',
    'fulfillment_shipping_recognised',
  ])
  await createDefinition('fulfillment_line', [
    'fulfillment_line_fulfillment',
    'fulfillment_line_line_item',
    'fulfillment_line_quantity',
  ])
  orderId = await createInstance(orderDefinitionId)
  contactId = await createInstance(contactDefinitionId)
  lineItemId = await createInstance(lineDefinitionId)
  taxLineId = await createInstance(taxDefinitionId)
  await value(orderId, 'order_number', { valueText: '42D-fixture' })
  await value(orderId, 'order_channel', { optionId: 'dtc' })
  await value(lineItemId, 'line_item_qty', { valueNumber: 2 })
  await value(lineItemId, 'line_item_unit_price', { valueNumber: 5000 })
  await value(orderId, 'order_subtotal', { valueNumber: 10000 })
  await value(orderId, 'order_tax_total', { valueNumber: 1000 })
  await value(orderId, 'order_shipping_total', { valueNumber: 1000 })
  await value(orderId, 'order_total', { valueNumber: 12000 })
  await value(orderId, 'order_currency', { valueText: 'USD' })
  await value(orderId, 'order_contact', { relatedEntityId: contactId })
  await value(lineItemId, 'line_item_order', { relatedEntityId: orderId })
  await value(lineItemId, 'line_item_net_total', { valueNumber: 10000 })
  await value(taxLineId, 'tax_line_order', { relatedEntityId: orderId })
  await value(taxLineId, 'tax_line_price', { valueNumber: 1000 })
  await value(taxLineId, 'tax_line_title', { valueText: 'US-CA' })
  await value(taxLineId, 'tax_line_channel_liable', { valueBoolean: false })
  const [sourceStore] = await db()
    .insert(schema.FinancialSourceAccount)
    .values({
      organizationId,
      providerKey: 'shopify',
      externalAccountId: 'fixture.myshopify.com',
      environment: 'live',
    })
    .returning()
  sourceStoreId = sourceStore!.id
  await seedChart()
  await seedGateway()
  await seedConnectorAndCoverage()
  await db()
    .insert(schema.OrganizationSetting)
    .values([
      { organizationId, key: 'accounting.setupState', value: 'finalized', updatedAt: new Date() },
      { organizationId, key: 'accounting.bookTimeZone', value: 'UTC', updatedAt: new Date() },
    ])
})

describe('customer receipt accounting against PostgreSQL', () => {
  it('converges concurrent retries to one receipt journal', async () => {
    const moneyTransactionId = await createReceipt(12000n, 'capture-concurrent')
    const results = await Promise.all([
      postCustomerReceiptAccounting(db(), { organizationId, moneyTransactionId }),
      postCustomerReceiptAccounting(db(), { organizationId, moneyTransactionId }),
    ])
    expect(results.every((result) => result.status === 'accepted')).toBe(true)
    expect(await db().select().from(schema.GlPosting)).toHaveLength(1)
    expect(await db().select().from(schema.AccountingEffect)).toHaveLength(1)
  })

  it('posts two partial captures independently while preserving one order timeline', async () => {
    const first = await createReceipt(6000n, 'capture-first')
    const second = await createReceipt(6000n, 'capture-second', '2026-09-15T11:00:00.000Z')
    expect(
      await postCustomerReceiptAccounting(db(), { organizationId, moneyTransactionId: first })
    ).toMatchObject({ status: 'accepted' })
    expect(
      await postCustomerReceiptAccounting(db(), { organizationId, moneyTransactionId: second })
    ).toMatchObject({ status: 'accepted' })
    expect(await db().select().from(schema.GlPosting)).toHaveLength(2)
    expect(await db().select().from(schema.AccountingEffect)).toHaveLength(2)
  })

  it('blocks when the order line net is missing and writes no journal', async () => {
    const moneyTransactionId = await createReceipt(12000n, 'capture-missing-net')
    await db()
      .delete(schema.FieldValue)
      .where(
        and(
          eq(schema.FieldValue.entityId, lineItemId),
          eq(schema.FieldValue.fieldId, fields.line_item_net_total!.id)
        )
      )
    const result = await postCustomerReceiptAccounting(db(), {
      organizationId,
      moneyTransactionId,
    })
    expect(result.status).toBe('blocked')
    expect(result.reason).toMatch(/net totals|net total|line_item_net_total/i)
    expect(await db().select().from(schema.GlPosting)).toHaveLength(0)
    expect((await db().select().from(schema.AccountingWork))[0]?.state).toBe('blocked')
  })
})

async function createShipment(sequence: number, occurredAt: string) {
  const id = await createInstance(fields.fulfillment_order!.definitionId)
  const line = await createInstance(fields.fulfillment_line_fulfillment!.definitionId)
  await value(id, 'fulfillment_order', { relatedEntityId: orderId })
  await value(id, 'fulfillment_shipped_at', { valueDate: occurredAt })
  await value(id, 'fulfillment_sequence', { valueNumber: sequence })
  await value(id, 'fulfillment_status', { optionId: 'success' })
  await value(id, 'fulfillment_shipping_recognised', { valueBoolean: sequence === 1 })
  await value(line, 'fulfillment_line_fulfillment', { relatedEntityId: id })
  await value(line, 'fulfillment_line_line_item', { relatedEntityId: lineItemId })
  await value(line, 'fulfillment_line_quantity', { valueNumber: 1 })
  return id
}

it('posts partial funding and split shipments across months without repeating tax or losing AR', async () => {
  const actorUserId = (await createTestUser()).id
  const receipt1 = await createReceipt(6000n, 'advance', '2026-08-31T20:00:00.000Z')
  const ship1 = await createShipment(1, '2026-09-01T20:00:00.000Z')
  const receipt2 = await createReceipt(6000n, 'remainder', '2026-09-02T20:00:00.000Z')
  const ship2 = await createShipment(2, '2026-09-03T20:00:00.000Z')
  expect(
    await postCustomerReceiptAccounting(db(), { organizationId, moneyTransactionId: receipt1 })
  ).toMatchObject({ status: 'accepted' })
  await acceptFulfillmentWorkGroup(db(), {
    organizationId,
    actorUserId,
    fulfillmentIds: [ship1],
    groupKey: '2026-09-01',
  })
  expect(
    await postCustomerReceiptAccounting(db(), { organizationId, moneyTransactionId: receipt2 })
  ).toMatchObject({ status: 'accepted' })
  await acceptFulfillmentWorkGroup(db(), {
    organizationId,
    actorUserId,
    fulfillmentIds: [ship2],
    groupKey: '2026-09-03',
  })
  const effects = await db().query.AccountingEffect.findMany({
    orderBy: (t, { asc }) => asc(t.effectiveDate),
  })
  expect(effects.map((e) => e.effectiveDate)).toEqual([
    '2026-08-31',
    '2026-09-01',
    '2026-09-02',
    '2026-09-03',
  ])
  const roles = await db().select().from(schema.GlRoleAssignment)
  const lines = await db().select().from(schema.GlPostingLine)
  const net = (role: string) =>
    lines
      .filter((line) => line.glAccountId === roles.find((r) => r.role === role)!.glAccountId)
      .reduce(
        (sum, line) => sum + (line.direction === 'debit' ? line.amountMinor : -line.amountMinor),
        0
      )
  expect(net('customer_deposits')).toBe(0)
  expect(net('accounts_receivable')).toBe(0)
  expect(net('sales_tax_payable')).toBe(-1000)
  expect(net('revenue_product')).toBe(-10000)
  expect(net('revenue_shipping')).toBe(-1000)
  expect(
    lines
      .filter((line) => line.glAccountId === clearingGlAccountId)
      .reduce((sum, line) => sum + line.amountMinor, 0)
  ).toBe(12000)
  expect(
    await postCustomerReceiptAccounting(db(), { organizationId, moneyTransactionId: receipt1 })
  ).toMatchObject({ status: 'accepted' })
  expect(await db().select().from(schema.GlPosting)).toHaveLength(4)
})

it('requires an earlier unpaid shipment to post before accepting its later receipt', async () => {
  const actorUserId = (await createTestUser()).id
  const shipment = await createShipment(1, '2026-09-01T20:00:00.000Z')
  const receipt = await createReceipt(6000n, 'later-receipt', '2026-09-02T20:00:00.000Z')
  expect(
    await postCustomerReceiptAccounting(db(), { organizationId, moneyTransactionId: receipt })
  ).toMatchObject({ status: 'blocked', reason: expect.stringContaining('earlier shipment') })
  await acceptFulfillmentWorkGroup(db(), {
    organizationId,
    actorUserId,
    fulfillmentIds: [shipment],
    groupKey: '2026-09-01',
  })
  expect(
    await postCustomerReceiptAccounting(db(), { organizationId, moneyTransactionId: receipt })
  ).toMatchObject({ status: 'accepted' })
  const work = await db().query.AccountingWork.findFirst({
    where: (t, { eq }) => eq(t.moneyTransactionId, receipt),
  })
  const effect = await db().query.AccountingEffect.findFirst({
    where: (t, { eq }) => eq(t.workId, work!.id),
  })
  expect(
    (effect!.acceptedBasis as { calculation: { allocation: unknown } }).calculation.allocation
  ).toMatchObject({ receivableMinor: '6000', depositMinor: '0', taxMinor: '0' })
})

it('uses the book-zone day for shipment selection and acceptance across midnight', async () => {
  const actorUserId = (await createTestUser()).id
  await db()
    .update(schema.OrganizationSetting)
    .set({ value: 'America/Los_Angeles' })
    .where(
      and(
        eq(schema.OrganizationSetting.organizationId, organizationId),
        eq(schema.OrganizationSetting.key, 'accounting.bookTimeZone')
      )
    )
  const shipment = await createShipment(1, '2026-09-01T01:30:00.000Z')
  await setCoverage(0)
  const result = await acceptFulfillmentWorkGroup(db(), {
    organizationId,
    actorUserId,
    fulfillmentIds: [shipment],
    groupKey: '2026-08-31',
  })
  expect(result.status).toBe('accepted')
  const [effect] = await db().select().from(schema.AccountingEffect)
  expect(effect!.effectiveDate).toBe('2026-08-31')
  const [journal] = await db().select().from(schema.GlPosting)
  expect(journal!.txnDate).toBe('2026-08-31')
})
