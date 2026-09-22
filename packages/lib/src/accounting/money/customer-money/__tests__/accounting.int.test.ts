// packages/lib/src/accounting/money/customer-money/__tests__/accounting.int.test.ts
//
// 91 §2's three orders through the real receipt poster: the receipt's entry is the
// same whatever else on its order has arrived first (91 D1, §4.0).
// TODO(91 S1b/S2): add the shipment, memo and refund entries of the same orders.

import { type Database, schema } from '@auxx/database'
import { createTestOrganization, createTestUser, getTestDb } from '@auxx/test-utils'
import { and, eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createEntityDefinitions } from '../../../../seed/entity-seeder/create-entity-defs'
import { createAllFields } from '../../../../seed/entity-seeder/create-fields'
import { linkRelationships } from '../../../../seed/entity-seeder/link-relationships'
import type { EntityDefMap } from '../../../../seed/entity-seeder/types'
import { seedChartPacks } from '../../../../seed/gl-account-chart'
import { postCustomerReceiptAccounting } from '../accounting'

vi.mock('@auxx/redis', async (original) => ({
  ...(await original<typeof import('@auxx/redis')>()),
  getRedisClient: async () => {
    throw new Error('No Redis in receipt poster database tests')
  },
}))
// The plan gate reads billing, and the chart seed wants a system user; every
// accounting gate here is real.
vi.mock('../../../ledger/setup/accounting-enabled', () => ({
  isAccountingEnabled: async () => true,
}))
vi.mock('../../../../users/system-user-service', () => ({
  SystemUserService: { getSystemUserForActions: async () => userId },
}))

const db = () => getTestDb() as unknown as Database

let organizationId: string
let userId: string
let defs: EntityDefMap
let commandId: string
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

/** A confirmed Shopify transaction, accepted, linked to its movement: what ingest leaves. */
async function movement(input: {
  purpose: 'customer_receipt' | 'customer_refund'
  amountMinor: bigint
  occurredAt: string
  partyInstanceId: string | null
  orderId?: string
}): Promise<string> {
  const occurredAt = new Date(input.occurredAt)
  const [money] = await db()
    .insert(schema.MoneyTransaction)
    .values({
      organizationId,
      purpose: input.purpose,
      amountMinor: input.amountMinor,
      currency: 'USD',
      currencyExponent: 2,
      datePrecision: 'instant',
      occurredAt,
      partyInstanceId: input.partyInstanceId,
      recordedByCommandId: commandId,
    })
    .returning({ id: schema.MoneyTransaction.id })
  const moneyId = money!.id
  const [object] = await db()
    .insert(schema.FinancialSourceObject)
    .values({
      organizationId,
      sourceAccountId,
      objectType: 'order_transaction',
      externalId: `txn_${moneyId}`,
    })
    .returning({ id: schema.FinancialSourceObject.id })
  const [observation] = await db()
    .insert(schema.FinancialSourceObservation)
    .values({
      organizationId,
      sourceObjectId: object!.id,
      contentHash: `hash_${moneyId}`,
      observedAt: occurredAt,
      payload: {
        version: 2,
        id: `txn_${moneyId}`,
        kind: input.purpose === 'customer_receipt' ? 'receipt' : 'refund',
        status: 'confirmed',
        amount: (Number(input.amountMinor) / 100).toFixed(2),
        currency: 'USD',
        processedAt: occurredAt.toISOString(),
        // A reserved handle: no rail, so the debit is undeposited funds.
        gateway: 'manual',
        settlementCurrency: null,
        parentTransactionId: null,
        creditMemoExternalId: null,
        paymentId: null,
        test: false,
      },
      reportingInstallationSnapshot: {},
    })
    .returning({ id: schema.FinancialSourceObservation.id })
  await db()
    .insert(schema.FinancialSourceAcceptance)
    .values({
      organizationId,
      sourceObjectId: object!.id,
      observationId: observation!.id,
      state: 'accepted',
      orderExternalId: input.orderId ?? 'unknown_order',
      orderInstanceId: input.orderId ?? null,
      moneyTransactionId: moneyId,
    })
  await db().insert(schema.MoneySourceLink).values({
    organizationId,
    sourceObjectId: object!.id,
    moneyTransactionId: moneyId,
    verifiedByCommandId: commandId,
  })
  if (input.orderId) await apply(moneyId, input.orderId, input.amountMinor, input.occurredAt)
  return moneyId
}

/** The link step: written whenever both sides exist, never an input to the lines. */
async function apply(moneyId: string, orderId: string, amountMinor: bigint, at: string) {
  await db()
    .insert(schema.MoneyApplication)
    .values({
      organizationId,
      moneyTransactionId: moneyId,
      operation: 'apply',
      amountMinor,
      orderInstanceId: orderId,
      appliedAt: new Date(at),
      effectiveDate: at.slice(0, 10),
      commandId,
      commandItemKey: `apply:${moneyId}:${orderId}`,
    })
}

/** The siblings §2 names, as bare records: the receipt poster must not read them. */
async function sibling(kind: 'shipment' | 'memo' | 'refund', orderId: string, amount: bigint) {
  if (kind === 'refund')
    await movement({
      purpose: 'customer_refund',
      amountMinor: amount,
      occurredAt: '2026-09-10T17:00:00.000Z',
      partyInstanceId: customerId,
      orderId,
    })
  else await record(kind === 'shipment' ? 'fulfillment' : 'credit_memo')
}

async function postReceipt(moneyId: string) {
  const result = await postCustomerReceiptAccounting(db(), {
    organizationId,
    moneyTransactionId: moneyId,
  })
  expect(result).toMatchObject({ status: 'accepted' })
  const glPostingId = (result as { glPostingId: string }).glPostingId
  const lines = await db()
    .select()
    .from(schema.GlPostingLine)
    .where(
      and(
        eq(schema.GlPostingLine.organizationId, organizationId),
        eq(schema.GlPostingLine.glPostingId, glPostingId)
      )
    )
  const links = await db()
    .select({ kind: schema.GlPostingSource.sourceKind, role: schema.GlPostingSource.linkRole })
    .from(schema.GlPostingSource)
    .where(eq(schema.GlPostingSource.glPostingId, glPostingId))
  return {
    lines: lines
      .sort((a, b) => a.lineNumber - b.lineNumber)
      .map((line) => ({
        account: line.accountName,
        direction: line.direction,
        amount: line.amountMinor,
        counterparty: line.counterpartyId,
        sourceType: line.sourceType,
        sourceIsMovement: line.sourceId === moneyId,
      })),
    links: links.map((l) => `${l.role}:${l.kind}`).sort(),
  }
}

const RECEIPT_108 = (counterparty: string) => [
  {
    account: 'Undeposited Funds',
    direction: 'debit',
    amount: 10_800,
    counterparty: null,
    sourceType: 'money_transaction',
    sourceIsMovement: true,
  },
  {
    account: 'Accounts Receivable',
    direction: 'credit',
    amount: 10_800,
    counterparty,
    sourceType: 'money_transaction',
    sourceIsMovement: true,
  },
]

beforeEach(async () => {
  const org = await createTestOrganization()
  organizationId = org.id
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
  await setting('accounting.autoPost.receipt', true)
  await setting('accounting.guestContactId', guestId)
  const [command] = await db()
    .insert(schema.MoneyCommand)
    .values({
      organizationId,
      commandKey: `receipt-fixture-${organizationId}`,
      kind: 'test',
      payloadHash: 'h',
      actorSnapshot: {},
    })
    .returning({ id: schema.MoneyCommand.id })
  commandId = command!.id
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

describe('the receipt of 91 §2, in any arrival order', () => {
  // #13001: paid 09-01, shipped 09-02, refunded $54 on 09-10.
  const orderings: Array<Array<'shipment' | 'memo' | 'refund'>> = [
    [],
    ['shipment'],
    ['shipment', 'memo', 'refund'],
    ['refund', 'memo'],
  ]

  it('posts Dr endpoint 108 / Cr A/R 108 whatever arrived before it', async () => {
    const entries = []
    for (const before of orderings) {
      const orderId = await record('order')
      for (const kind of before) await sibling(kind, orderId, 5_400n)
      const receipt = await movement({
        purpose: 'customer_receipt',
        amountMinor: 10_800n,
        occurredAt: '2026-09-01T17:00:00.000Z',
        partyInstanceId: customerId,
        orderId,
      })
      entries.push(await postReceipt(receipt))
    }
    for (const entry of entries) {
      expect(entry.lines).toEqual(RECEIPT_108(customerId))
      expect(entry.links).toEqual([
        'counterparty:contact',
        'parent:order',
        'subject:money_transaction',
      ])
    }
  })

  it('refunded in full before it ships: the receipt is the same entry', async () => {
    const orderId = await record('order')
    await sibling('memo', orderId, 10_800n)
    await sibling('refund', orderId, 10_800n)
    const receipt = await movement({
      purpose: 'customer_receipt',
      amountMinor: 10_800n,
      occurredAt: '2026-09-01T17:00:00.000Z',
      partyInstanceId: customerId,
      orderId,
    })
    expect((await postReceipt(receipt)).lines).toEqual(RECEIPT_108(customerId))
  })

  it('paid after shipment: the same entry as paid before it', async () => {
    const orderId = await record('order')
    await sibling('shipment', orderId, 0n)
    const receipt = await movement({
      purpose: 'customer_receipt',
      amountMinor: 10_800n,
      occurredAt: '2026-09-03T17:00:00.000Z',
      partyInstanceId: customerId,
      orderId,
    })
    expect((await postReceipt(receipt)).lines).toEqual(RECEIPT_108(customerId))
  })

  it('posts before its order arrives, on the guest, and the link is later', async () => {
    const receipt = await movement({
      purpose: 'customer_receipt',
      amountMinor: 10_800n,
      occurredAt: '2026-09-01T17:00:00.000Z',
      partyInstanceId: null,
    })
    const entry = await postReceipt(receipt)
    expect(entry.lines).toEqual(RECEIPT_108(guestId))
    expect(entry.links).toEqual(['counterparty:contact', 'subject:money_transaction'])

    // The order arrives: the application is written and the posting stands as it was.
    const orderId = await record('order')
    await apply(receipt, orderId, 10_800n, '2026-09-05T17:00:00.000Z')
    const again = await postReceipt(receipt)
    expect(again.lines).toEqual(entry.lines)
  })
})
