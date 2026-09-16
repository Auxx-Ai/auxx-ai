// packages/lib/src/money/customer-money/refund-command.int.test.ts

import { type Database, schema } from '@auxx/database'
import { createTestOrganization, createTestUser, getTestDb } from '@auxx/test-utils'
import { and, asc, eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getOrgCache } from '../../cache'
import { createEntityDefinitions } from '../../seed/entity-seeder/create-entity-defs'
import { createAllFields } from '../../seed/entity-seeder/create-fields'
import { linkRelationships } from '../../seed/entity-seeder/link-relationships'
import type { EntityDefMap } from '../../seed/entity-seeder/types'
import { issueCreditMemoAccounting } from '../credit-memos/accounting'
import { postCustomerRefundAccounting } from './refund-accounting'

vi.mock('../../postings/accounting-enabled', () => ({
  isAccountingEnabled: vi.fn(async () => true),
}))
vi.mock('../../postings/delivery', async (original) => ({
  ...(await original<typeof import('../../postings/delivery')>()),
  deliverAccountingPosting: vi.fn(async () => undefined),
}))
vi.mock('../../resources/crud/tx-write-flush', () => ({ flushTxWriteScope: vi.fn() }))
vi.mock('../../events', () => ({ publisher: { publish: vi.fn(), publishLater: vi.fn() } }))
vi.mock('@auxx/redis', async (original) => ({
  ...(await original<typeof import('@auxx/redis')>()),
  getRedisClient: async () => {
    throw new Error('No Redis in refund accounting database tests')
  },
}))

const db = () => getTestDb() as unknown as Database

type Fixture = {
  organizationId: string
  userId: string
  contactId: string
  contactDefinitionId: string
  memoId: string
  memoDefinitionId: string
  lineDefinitionId: string
  paymentGatewayDefinitionId: string
  fields: Map<string, typeof schema.CustomField.$inferSelect>
  accounts: Map<string, string>
}

let fixture: Fixture

async function instance(definitionId: string) {
  const [row] = await db()
    .insert(schema.EntityInstance)
    .values({
      organizationId: fixture.organizationId,
      entityDefinitionId: definitionId,
      createdById: fixture.userId,
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
  const definitionId = fixture.accounts.get('__definition__')
  if (!definitionId) throw new Error('fixture GL definition missing')
  const roleTypes = {
    accounts_receivable: 'asset',
    revenue_returns_allowances: 'revenue',
    sales_tax_payable: 'liability',
    cash: 'asset',
  } as const
  const accounts = new Map<string, string>()
  for (const [index, [role, type]] of Object.entries(roleTypes).entries()) {
    const accountId = await instance(definitionId)
    await fieldValue(accountId, 'gl_account_code', { valueText: `${1200 + index * 100}` })
    await fieldValue(accountId, 'gl_account_name', { valueText: role })
    await fieldValue(accountId, 'gl_account_type', { optionId: type })
    accounts.set(role, accountId)
    if (role !== 'cash')
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
  if (!contactDefinitionId) throw new Error('fixture contact definition missing')
  fixture.contactId = await instance(contactDefinitionId)
  fixture.memoId = await instance(fixture.memoDefinitionId)
  const lineId = await instance(fixture.lineDefinitionId)

  await fieldValue(fixture.memoId, 'credit_memo_number', { valueText: 'CM-REFUND-1' })
  await fieldValue(fixture.memoId, 'credit_memo_status', { optionId: 'draft' })
  await fieldValue(fixture.memoId, 'credit_memo_source', { optionId: 'native' })
  await fieldValue(fixture.memoId, 'credit_memo_contact', {
    relatedEntityId: fixture.contactId,
    relatedEntityDefinitionId: contactDefinitionId,
  })
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

async function createCommand(commandKey: string) {
  const [command] = await db()
    .insert(schema.MoneyCommand)
    .values({
      organizationId: fixture.organizationId,
      commandKey,
      kind: 'refund-fixture',
      payloadHash: commandKey,
      actorSnapshot: { kind: 'test' },
    })
    .returning({ id: schema.MoneyCommand.id })
  return command!.id
}

async function createManualRoute() {
  const [route] = await db()
    .insert(schema.PaymentRoute)
    .values({
      organizationId: fixture.organizationId,
      kind: 'manual',
      method: 'cash',
      settlementCurrency: 'USD',
      cashGlAccountInstanceId: fixture.accounts.get('cash')!,
    })
    .returning()
  return route!.id
}

async function createProcessorRoute(providerKey: string) {
  const gatewayId = await instance(fixture.paymentGatewayDefinitionId)
  const [processor] = await db()
    .insert(schema.FinancialSourceAccount)
    .values({
      organizationId: fixture.organizationId,
      providerKey,
      externalAccountId: `${providerKey}-fixture`,
      environment: 'live',
    })
    .returning()
  await fieldValue(gatewayId, 'payment_gateway_name', { valueText: `${providerKey} gateway` })
  await fieldValue(gatewayId, 'payment_gateway_handles', { valueText: providerKey })
  await fieldValue(gatewayId, 'payment_gateway_clearing_account', {
    valueText: fixture.accounts.get('cash')!,
  })
  await fieldValue(gatewayId, 'payment_gateway_settlement_source', { optionId: 'manual' })
  await fieldValue(gatewayId, 'payment_gateway_status', { optionId: 'active' })
  await fieldValue(gatewayId, 'payment_gateway_settlement_account', {
    valueText: processor!.id,
  })
  await fieldValue(gatewayId, 'payment_gateway_settlement_currency', { valueText: 'USD' })
  const [route] = await db()
    .insert(schema.PaymentRoute)
    .values({
      organizationId: fixture.organizationId,
      kind: 'processor',
      method: 'card',
      settlementCurrency: 'USD',
      processorAccountId: processor!.id,
      paymentGatewayInstanceId: gatewayId,
    })
    .returning()
  return { routeId: route!.id, gatewayId, processorId: processor!.id }
}

async function createRefund(
  amountMinor: bigint,
  commandKey: string,
  paymentRouteId: string | null
) {
  const commandId = await createCommand(commandKey)
  const [refund] = await db()
    .insert(schema.MoneyTransaction)
    .values({
      organizationId: fixture.organizationId,
      purpose: 'customer_refund',
      amountMinor,
      currency: 'USD',
      currencyExponent: 2,
      datePrecision: 'date',
      occurredOn: '2026-09-15',
      partyInstanceId: fixture.contactId,
      paymentRouteId,
      recordedByCommandId: commandId,
    })
    .returning()
  await db().insert(schema.MoneyRefundSettlement).values({
    organizationId: fixture.organizationId,
    refundTransactionId: refund!.id,
    amountMinor,
    disposition: 'customer_credit',
    customerCreditMemoInstanceId: fixture.memoId,
    commandId,
    commandItemKey: 'refund',
  })
  return refund!.id
}

beforeEach(async () => {
  const organization = await createTestOrganization()
  const user = await createTestUser({ name: 'Refund accountant' })
  await db()
    .update(schema.Organization)
    .set({ systemUserId: user.id })
    .where(eq(schema.Organization.id, organization.id))

  const all = await createEntityDefinitions(db(), organization.id)
  const kinds = [
    'contact',
    'credit_memo',
    'credit_memo_line',
    'credit_memo_application',
    'gl_account',
    'payment_gateway',
  ]
  const defs: EntityDefMap = new Map([...all].filter(([kind]) => kinds.includes(kind)))
  const seededFields = await createAllFields(db(), organization.id, defs)
  const fields = (
    await db()
      .select()
      .from(schema.CustomField)
      .where(eq(schema.CustomField.organizationId, organization.id))
  ).reduce((map, field) => {
    if (field.systemAttribute) map.set(field.systemAttribute, field)
    return map
  }, new Map<string, typeof schema.CustomField.$inferSelect>())
  await linkRelationships(db(), defs, seededFields)
  await getOrgCache().invalidateAndRecompute(organization.id, ['customFields', 'resources'])

  fixture = {
    organizationId: organization.id,
    userId: user.id,
    contactId: '',
    contactDefinitionId: defs.get('contact')!.id,
    memoId: '',
    memoDefinitionId: defs.get('credit_memo')!.id,
    lineDefinitionId: defs.get('credit_memo_line')!.id,
    paymentGatewayDefinitionId: defs.get('payment_gateway')!.id,
    fields,
    accounts: new Map([['__definition__', defs.get('gl_account')!.id]]),
  }
  await db()
    .insert(schema.OrganizationSetting)
    .values([
      {
        organizationId: organization.id,
        key: 'accounting.setupState',
        value: 'finalized',
        updatedAt: new Date(),
      },
      {
        organizationId: organization.id,
        key: 'accounting.bookTimeZone',
        value: 'UTC',
        updatedAt: new Date(),
      },
      {
        organizationId: organization.id,
        key: 'organization.currency',
        value: 'USD',
        updatedAt: new Date(),
      },
    ])
  await seedChart()
  await seedMemo()
  await getOrgCache().invalidateAndRecompute(organization.id, ['customFields', 'resources'])
  await issueCreditMemoAccounting(db(), {
    organizationId: fixture.organizationId,
    userId: fixture.userId,
    commandKey: 'issue-native-credit',
    creditMemoInstanceId: fixture.memoId,
    issuedAt: '2026-09-15',
  })
})

describe('postCustomerRefundAccounting against PostgreSQL', () => {
  it.each(['paypal', 'adyen'])('accepts the opaque %s processor route', async (providerKey) => {
    const processor = await createProcessorRoute(providerKey)
    const refundId = await createRefund(100n, `refund-${providerKey}`, processor.routeId)
    const result = await postCustomerRefundAccounting(db(), {
      organizationId: fixture.organizationId,
      moneyTransactionId: refundId,
      actorUserId: fixture.userId,
    })

    expect(result.status).toBe('accepted')
    if (result.status !== 'accepted') return
    const [effect] = await db().query.AccountingEffect.findMany({
      where: eq(schema.AccountingEffect.glPostingId, result.glPostingId),
    })
    expect(effect?.acceptedBasis).toMatchObject({
      calculation: { route: { processorAccountId: processor.processorId } },
    })
  })

  it('blocks a processor route when the gateway identity does not match the route', async () => {
    const processor = await createProcessorRoute('paypal')
    const [otherProcessor] = await db()
      .insert(schema.FinancialSourceAccount)
      .values({
        organizationId: fixture.organizationId,
        providerKey: 'adyen',
        externalAccountId: 'adyen-mismatch-fixture',
        environment: 'live',
      })
      .returning()
    const settlementAccountField = fixture.fields.get('payment_gateway_settlement_account')!
    await db()
      .update(schema.FieldValue)
      .set({ valueText: otherProcessor!.id })
      .where(
        and(
          eq(schema.FieldValue.organizationId, fixture.organizationId),
          eq(schema.FieldValue.entityId, processor.gatewayId),
          eq(schema.FieldValue.fieldId, settlementAccountField.id)
        )
      )
    const refundId = await createRefund(100n, 'refund-processor-mismatch', processor.routeId)
    const result = await postCustomerRefundAccounting(db(), {
      organizationId: fixture.organizationId,
      moneyTransactionId: refundId,
      actorUserId: fixture.userId,
    })

    expect(result.status).toBe('blocked')
    expect(result.status === 'blocked' ? result.reason : '').toMatch(/gateway|processor/i)
    expect(
      await db().query.AccountingWork.findMany({
        where: eq(schema.AccountingWork.effectKind, 'customer_refund'),
      })
    ).toMatchObject([{ state: 'blocked' }])
  })

  it('posts a balanced debit to frozen credit control and credit to manual cash', async () => {
    const routeId = await createManualRoute()
    const refundId = await createRefund(1100n, 'refund-success', routeId)
    const result = await postCustomerRefundAccounting(db(), {
      organizationId: fixture.organizationId,
      moneyTransactionId: refundId,
      actorUserId: fixture.userId,
    })

    expect(result.status).toBe('accepted')
    if (result.status !== 'accepted') return
    const lines = await db().query.GlPostingLine.findMany({
      where: eq(schema.GlPostingLine.glPostingId, result.glPostingId),
      orderBy: asc(schema.GlPostingLine.lineNumber),
    })
    expect(lines).toHaveLength(2)
    expect(lines.map((line) => [line.direction, line.amountMinor])).toEqual([
      ['debit', 1100],
      ['credit', 1100],
    ])
    expect(lines[0]!.glAccountId).toBe(fixture.accounts.get('accounts_receivable'))
    expect(lines[1]!.glAccountId).toBe(fixture.accounts.get('cash'))
  })

  it('replays the refund without creating another effect or journal', async () => {
    const routeId = await createManualRoute()
    const refundId = await createRefund(1100n, 'refund-replay', routeId)
    const input = {
      organizationId: fixture.organizationId,
      moneyTransactionId: refundId,
      actorUserId: fixture.userId,
    }
    const first = await postCustomerRefundAccounting(db(), input)
    const second = await postCustomerRefundAccounting(db(), input)

    expect(first).toEqual(second)
    expect(
      await db().query.AccountingEffect.findMany({
        where: eq(
          schema.AccountingEffect.glPostingId,
          first.status === 'accepted' ? first.glPostingId : ''
        ),
      })
    ).toHaveLength(1)
  })

  it('stores blocked work for a missing route and accepts after the route is repaired', async () => {
    const refundId = await createRefund(1100n, 'refund-repair', null)
    const input = {
      organizationId: fixture.organizationId,
      moneyTransactionId: refundId,
      actorUserId: fixture.userId,
    }
    const blocked = await postCustomerRefundAccounting(db(), input)
    expect(blocked.status).toBe('blocked')
    const routeId = await createManualRoute()
    await db()
      .update(schema.MoneyTransaction)
      .set({ paymentRouteId: routeId })
      .where(
        and(
          eq(schema.MoneyTransaction.organizationId, fixture.organizationId),
          eq(schema.MoneyTransaction.id, refundId)
        )
      )

    const repaired = await postCustomerRefundAccounting(db(), input)
    expect(repaired.status).toBe('accepted')
    expect(await db().query.AccountingEffect.findMany()).toHaveLength(2)
  })

  it('blocks a refund that exceeds the remaining credit entitlement', async () => {
    const routeId = await createManualRoute()
    const firstId = await createRefund(1100n, 'refund-capacity-first', routeId)
    expect(
      (
        await postCustomerRefundAccounting(db(), {
          organizationId: fixture.organizationId,
          moneyTransactionId: firstId,
          actorUserId: fixture.userId,
        })
      ).status
    ).toBe('accepted')
    const secondId = await createRefund(1n, 'refund-capacity-second', routeId)
    const blocked = await postCustomerRefundAccounting(db(), {
      organizationId: fixture.organizationId,
      moneyTransactionId: secondId,
      actorUserId: fixture.userId,
    })

    expect(blocked.status).toBe('blocked')
    expect(blocked.status === 'blocked' ? blocked.reason : '').toMatch(
      /remaining credit memo entitlement/
    )
  })
})
