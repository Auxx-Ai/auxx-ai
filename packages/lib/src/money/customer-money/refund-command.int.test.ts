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
  bankAccountDefinitionId: string
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
    undeposited_funds: 'asset',
    // Named by a `bank_account` record's pointer, never by a role (64 A1).
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

/** A `bank_account` record pointing at the chart's cash account. */
async function createBankAccount() {
  const bankId = await instance(fixture.bankAccountDefinitionId)
  await fieldValue(bankId, 'bank_account_gl_account', {
    valueText: fixture.accounts.get('cash')!,
  })
  return bankId
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

/**
 * A confirmed refund movement. `method` plus `cashAccountInstanceId` ARE the
 * two-way endpoint (64 A1) - a named bank account resolves through its pointer,
 * none takes the `undeposited_funds` role.
 */
async function createRefund(
  amountMinor: bigint,
  commandKey: string,
  endpoint: {
    method?: 'cash' | 'check' | 'card' | 'bank' | 'other' | null
    bankAccountInstanceId?: string | null
  } = {}
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
      method: endpoint.method === undefined ? 'check' : endpoint.method,
      cashAccountInstanceId: endpoint.bankAccountInstanceId ?? null,
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
    'bank_account',
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
    bankAccountDefinitionId: defs.get('bank_account')!.id,
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
  // 64 A1: `PaymentRoute` is retired. A card refund resolves through its
  // original receipt's frozen rail (`readFrozenReceiptRoute`); a refund with no
  // original receipt takes the two-way manual endpoint tested below.
  it('credits the named bank accounts GL account and debits frozen credit control', async () => {
    const bankId = await createBankAccount()
    const refundId = await createRefund(1100n, 'refund-success', {
      method: 'bank',
      bankAccountInstanceId: bankId,
    })
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
    const bankId = await createBankAccount()
    const refundId = await createRefund(1100n, 'refund-replay', {
      method: 'bank',
      bankAccountInstanceId: bankId,
    })
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

  // The shipped route for `check` is undeposited funds, so naming no bank
  // account is the complete answer rather than a missing one.
  it('credits undeposited funds when the method routes there and no bank is named', async () => {
    const refundId = await createRefund(1100n, 'refund-undeposited')
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
    expect(lines[1]!.glAccountId).toBe(fixture.accounts.get('undeposited_funds'))
  })

  it('stores blocked work for an unrouteable refund and accepts once the method is set', async () => {
    const refundId = await createRefund(1100n, 'refund-repair', { method: null })
    const input = {
      organizationId: fixture.organizationId,
      moneyTransactionId: refundId,
      actorUserId: fixture.userId,
    }
    const blocked = await postCustomerRefundAccounting(db(), input)
    expect(blocked.status).toBe('blocked')
    await db()
      .update(schema.MoneyTransaction)
      .set({ method: 'check' })
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

  // A `bank` refund routes to `cash`, and a cash route with no bank account is
  // an incomplete record rather than an undeposited one.
  it('blocks a cash-routed refund that names no bank account', async () => {
    const refundId = await createRefund(1100n, 'refund-no-bank', { method: 'bank' })
    const blocked = await postCustomerRefundAccounting(db(), {
      organizationId: fixture.organizationId,
      moneyTransactionId: refundId,
      actorUserId: fixture.userId,
    })

    expect(blocked.status).toBe('blocked')
    expect(blocked.status === 'blocked' ? blocked.reason : '').toMatch(/bank account/)
  })

  it('blocks a refund that exceeds the remaining credit entitlement', async () => {
    const bankId = await createBankAccount()
    const endpoint = { method: 'bank' as const, bankAccountInstanceId: bankId }
    const firstId = await createRefund(1100n, 'refund-capacity-first', endpoint)
    expect(
      (
        await postCustomerRefundAccounting(db(), {
          organizationId: fixture.organizationId,
          moneyTransactionId: firstId,
          actorUserId: fixture.userId,
        })
      ).status
    ).toBe('accepted')
    const secondId = await createRefund(1n, 'refund-capacity-second', endpoint)
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
