// packages/lib/src/accounting/money/customer-money/__tests__/link-later.int.test.ts
//
// 91 §8.6 end to end: an orderless receipt is accepted and posts on the guest; the
// order's arrival wakes its `ORDER_NOT_FOUND` row and the link step writes the
// application and the `parent` link on the existing posting, never touching its lines.

import { type Database, schema } from '@auxx/database'
import { createTestOrganization, createTestUser, getTestDb } from '@auxx/test-utils'
import { and, eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createEntityDefinitions } from '../../../../seed/entity-seeder/create-entity-defs'
import { createAllFields } from '../../../../seed/entity-seeder/create-fields'
import { linkRelationships } from '../../../../seed/entity-seeder/link-relationships'
import type { EntityDefMap } from '../../../../seed/entity-seeder/types'
import { seedChartPacks } from '../../../../seed/gl-account-chart'
import { accountingBasisHash } from '../../../ledger/builders/basis-hash'
import { wakeArrivedOrders } from '../../../work-items/wake'
import { sweepMovementAccounting } from '../../blocked-movements'
import { materializeImportedMoneyInTx, sweepImportedCustomerMoney } from '../ingest'

vi.mock('@auxx/redis', async (original) => ({
  ...(await original<typeof import('@auxx/redis')>()),
  getRedisClient: async () => {
    throw new Error('No Redis in link-later database tests')
  },
}))
vi.mock('../../../ledger/setup/accounting-enabled', () => ({
  isAccountingActive: async () => true,
}))
vi.mock('../../../../users/system-user-service', () => ({
  SystemUserService: { getSystemUserForActions: async () => userId },
}))

const db = () => getTestDb() as unknown as Database

const ORDER_EXTERNAL_ID = 'shopify_order_5001'

let organizationId: string
let userId: string
let defs: EntityDefMap
let sourceAccountId: string
let customerId: string
let guestId: string

async function setting(key: string, value: unknown) {
  await db().insert(schema.OrganizationSetting).values({
    organizationId,
    key,
    value,
    updatedAt: new Date(),
  })
}

async function record(entityType: string): Promise<string> {
  const [row] = await db()
    .insert(schema.EntityInstance)
    .values({
      organizationId,
      entityDefinitionId: defs.get(entityType)!.id,
      createdById: userId,
      updatedAt: new Date(),
    })
    .returning({ id: schema.EntityInstance.id })
  return row!.id
}

/** A confirmed $108 receipt observed on a store whose order has not synced yet. */
async function stageReceipt(): Promise<string> {
  const payload = {
    version: 2,
    raw: {},
    id: 'capture_5001',
    kind: 'receipt',
    status: 'confirmed',
    amount: '108.00',
    currency: 'USD',
    processedAt: '2026-09-01T17:00:00.000Z',
    // A reserved handle: no rail, so the debit is undeposited funds.
    gateway: 'manual',
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
      sourceAccountId,
      objectType: 'order_transaction',
      externalId: payload.id,
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
  const [acceptance] = await db()
    .insert(schema.FinancialSourceAcceptance)
    .values({
      organizationId,
      sourceObjectId: object!.id,
      observationId: observation!.id,
      state: 'pending',
      orderExternalId: ORDER_EXTERNAL_ID,
      orderInstanceId: null,
    })
    .returning()
  await db().transaction((tx) => materializeImportedMoneyInTx(tx, organizationId, acceptance!.id))
  return acceptance!.id
}

/** The order syncs: its record, its totals and customer, and its channel identity. */
async function orderArrives(): Promise<string> {
  const orderId = await record('order')
  const orderDefId = defs.get('order')!.id
  const fields = await db()
    .select({ id: schema.CustomField.id, attribute: schema.CustomField.systemAttribute })
    .from(schema.CustomField)
    .where(
      and(
        eq(schema.CustomField.organizationId, organizationId),
        eq(schema.CustomField.entityDefinitionId, orderDefId)
      )
    )
  const fieldId = (attribute: string) => fields.find((f) => f.attribute === attribute)!.id
  await db()
    .insert(schema.FieldValue)
    .values([
      {
        organizationId,
        entityDefinitionId: orderDefId,
        entityId: orderId,
        fieldId: fieldId('order_total'),
        valueNumber: 10_800,
      },
      {
        organizationId,
        entityDefinitionId: orderDefId,
        entityId: orderId,
        fieldId: fieldId('order_currency'),
        valueText: 'USD',
      },
      {
        organizationId,
        entityDefinitionId: orderDefId,
        entityId: orderId,
        fieldId: fieldId('order_contact'),
        relatedEntityId: customerId,
      },
    ])
  await db().insert(schema.RecordIdentity).values({
    organizationId,
    entityInstanceId: orderId,
    entityDefinitionId: orderDefId,
    source: 'shopify',
    externalId: ORDER_EXTERNAL_ID,
  })
  return orderId
}

const readWorkItem = (acceptanceId: string) =>
  db().query.AccountingWorkItem.findFirst({
    where: and(
      eq(schema.AccountingWorkItem.organizationId, organizationId),
      eq(schema.AccountingWorkItem.sourceKind, 'financial_source_acceptance'),
      eq(schema.AccountingWorkItem.sourceId, acceptanceId)
    ),
  })

async function thePosting() {
  const [posting] = await db()
    .select({ id: schema.GlPosting.id, status: schema.GlPosting.status })
    .from(schema.GlPosting)
    .where(eq(schema.GlPosting.organizationId, organizationId))
  const lines = await db()
    .select()
    .from(schema.GlPostingLine)
    .where(eq(schema.GlPostingLine.glPostingId, posting!.id))
  const links = await db()
    .select()
    .from(schema.GlPostingSource)
    .where(eq(schema.GlPostingSource.glPostingId, posting!.id))
  return {
    id: posting!.id,
    lines: lines
      .sort((a, b) => a.lineNumber - b.lineNumber)
      .map((line) => ({
        id: line.id,
        account: line.accountName,
        direction: line.direction,
        amount: line.amountMinor,
        counterparty: line.counterpartyId,
      })),
    links: links.map((l) => `${l.linkRole}:${l.sourceKind}:${l.sourceId}`).sort(),
  }
}

beforeEach(async () => {
  organizationId = (await createTestOrganization()).id
  userId = (await createTestUser()).id
  defs = await createEntityDefinitions(db(), organizationId)
  const made = await createAllFields(db(), organizationId, defs)
  await linkRelationships(db(), defs, made)
  await seedChartPacks(db(), organizationId, defs.get('gl_account')!.id, ['core'])
  customerId = await record('contact')
  guestId = await record('contact')
  await setting('accounting.setupState', 'finalized')
  await setting('accounting.bookTimeZone', 'America/Los_Angeles')
  await setting('accounting.cutoffPeriod', '2026-07')
  await setting('accounting.guestContactId', guestId)
  const [account] = await db()
    .insert(schema.FinancialSourceAccount)
    .values({
      organizationId,
      providerKey: 'shopify',
      externalAccountId: 'demo.myshopify.com',
      environment: 'live',
    })
    .returning({ id: schema.FinancialSourceAccount.id })
  sourceAccountId = account!.id
})

describe('a receipt whose order has not arrived (91 §8.6)', () => {
  it('posts now on the guest, and links its order when the order arrives', async () => {
    const acceptanceId = await stageReceipt()
    const [money] = await db().select().from(schema.MoneyTransaction)
    expect(await readWorkItem(acceptanceId)).toMatchObject({
      stage: 'evidence',
      reasonCode: 'ORDER_NOT_FOUND',
      externalRef: ORDER_EXTERNAL_ID,
    })

    // Post now: the sweep routes the unapplied receipt to the receipt poster.
    await sweepMovementAccounting(db(), { organizationId })
    const before = await thePosting()
    expect(before.lines.map(({ id: _id, ...line }) => line)).toEqual([
      {
        account: 'Undeposited Funds',
        direction: 'debit',
        amount: 10_800,
        counterparty: null,
      },
      {
        account: 'Accounts Receivable',
        direction: 'credit',
        amount: 10_800,
        counterparty: guestId,
      },
    ])
    expect(before.links).toEqual([
      `counterparty:contact:${guestId}`,
      `subject:money_transaction:${money!.id}`,
    ])

    // The order's `created` record event wakes the row by its external id.
    const orderId = await orderArrives()
    const woken = await wakeArrivedOrders(db(), organizationId, { orderInstanceIds: [orderId] })
    expect(woken._unsafeUnwrap()).toBe(1)
    expect(await sweepImportedCustomerMoney(db(), organizationId)).toEqual({
      examined: 1,
      failed: 0,
    })

    // Link later: the application and the parent link, on the same posting.
    const applications = await db().select().from(schema.MoneyApplication)
    expect(applications).toMatchObject([
      {
        moneyTransactionId: money!.id,
        orderInstanceId: orderId,
        operation: 'apply',
        amountMinor: 10_800n,
      },
    ])
    const after = await thePosting()
    expect(after.id).toBe(before.id)
    expect(after.lines).toEqual(before.lines)
    expect(after.links).toEqual([
      `counterparty:contact:${guestId}`,
      `parent:order:${orderId}`,
      `subject:money_transaction:${money!.id}`,
    ])
    expect(await db().select().from(schema.GlPosting)).toHaveLength(1)
    expect(await readWorkItem(acceptanceId)).toBeUndefined()
    const acceptance = await db().query.FinancialSourceAcceptance.findFirst({
      where: eq(schema.FinancialSourceAcceptance.id, acceptanceId),
    })
    expect(acceptance).toMatchObject({ state: 'accepted', orderInstanceId: orderId })
    // The money model learns the customer; the ledger line keeps the guest it froze.
    const [linked] = await db().select().from(schema.MoneyTransaction)
    expect(linked!.partyInstanceId).toBe(customerId)

    // A second pass is a no-op: one application, one parent link.
    await db().transaction((tx) => materializeImportedMoneyInTx(tx, organizationId, acceptanceId))
    expect(await db().select().from(schema.MoneyApplication)).toHaveLength(1)
    expect((await thePosting()).links).toEqual(after.links)
  })

  it('stays an INFO row, still posted, while no order ever arrives', async () => {
    const acceptanceId = await stageReceipt()
    await sweepMovementAccounting(db(), { organizationId })
    const before = await thePosting()

    // The safety-net pass comes round with nothing arrived.
    await db()
      .update(schema.AccountingWorkItem)
      .set({ nextAttemptAt: new Date(Date.now() - 1000) })
      .where(eq(schema.AccountingWorkItem.sourceId, acceptanceId))
    await sweepImportedCustomerMoney(db(), organizationId)

    expect(await readWorkItem(acceptanceId)).toMatchObject({
      reasonCode: 'ORDER_NOT_FOUND',
      attempts: 2,
    })
    expect(await db().select().from(schema.MoneyApplication)).toHaveLength(0)
    expect(await thePosting()).toEqual(before)
  })
})
