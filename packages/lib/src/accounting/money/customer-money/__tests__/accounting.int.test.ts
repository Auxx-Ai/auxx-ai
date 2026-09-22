// packages/lib/src/accounting/money/customer-money/__tests__/accounting.int.test.ts
//
// 91 §2's three orders through the real receipt poster: the receipt's entry is the
// same whatever else on its order has arrived first (91 D1, §4.0); the shipment, memo
// and refund of the same orders follow below.

import { type Database, schema } from '@auxx/database'
import { createTestOrganization, createTestUser, getTestDb } from '@auxx/test-utils'
import { and, eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createEntityDefinitions } from '../../../../seed/entity-seeder/create-entity-defs'
import { createAllFields } from '../../../../seed/entity-seeder/create-fields'
import { linkRelationships } from '../../../../seed/entity-seeder/link-relationships'
import type { EntityDefMap } from '../../../../seed/entity-seeder/types'
import { seedChartPacks } from '../../../../seed/gl-account-chart'
import { createChartAccount } from '../../../ledger/chart/chart-write'
import { setRoleAssignment } from '../../../ledger/roles/role-map'
import { postFulfillmentAccounting } from '../../../sales/fulfillments/accounting'
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

// 91 S1b: the shipment of the same orders (91 D2) and A/R on the store axis (91 §4.3).
describe('the shipment of 91 §2, in any arrival order', () => {
  type Value = Partial<typeof schema.FieldValue.$inferInsert>

  async function write(entityType: string, values: Record<string, Value>): Promise<string> {
    const id = await record(entityType)
    const rows = await db()
      .select({ id: schema.CustomField.id, attribute: schema.CustomField.systemAttribute })
      .from(schema.CustomField)
      .where(eq(schema.CustomField.organizationId, organizationId))
    const fields = new Map(rows.map((row) => [row.attribute, row.id]))
    await db()
      .insert(schema.FieldValue)
      .values(
        Object.entries(values).map(([attribute, value]) => ({
          organizationId,
          entityId: id,
          entityDefinitionId: defs.get(entityType)!.id,
          fieldId: fields.get(attribute)!,
          updatedAt: new Date(),
          ...value,
        }))
      )
    return id
  }

  const related = (entityType: string, id: string): Value => ({
    relatedEntityId: id,
    relatedEntityDefinitionId: defs.get(entityType)!.id,
  })

  /** #13001 as the connector leaves it: $100 + $8 tax, one line, sold through the store. */
  async function order(number: string): Promise<{ orderId: string; lineId: string }> {
    const orderId = await write('order', {
      order_number: { valueText: number },
      order_currency: { valueText: 'USD' },
      order_subtotal: { valueNumber: 10_000 },
      order_tax_total: { valueNumber: 800 },
      order_shipping_total: { valueNumber: 0 },
      order_total: { valueNumber: 10_800 },
      order_contact: related('contact', customerId),
    })
    const lineId = await write('line_item', {
      line_item_order: related('order', orderId),
      line_item_name: { valueText: 'Hoodie' },
      line_item_qty: { valueNumber: 1 },
      line_item_unit_price: { valueNumber: 10_000 },
      line_item_line_total: { valueNumber: 10_000 },
    })
    await db().insert(schema.FinancialSourceCoverage).values({
      organizationId,
      sourceAccountId,
      streamKey: 'order_transactions',
      windowKey: orderId,
      requestedBoundary: {},
      fetchedBoundary: {},
      fetchedCount: 1,
      acceptedCount: 1,
      rejectedCount: 0,
      pendingCount: 0,
      complete: true,
    })
    return { orderId, lineId }
  }

  /** The shipment of 09-02, stamped. */
  async function shipment(orderId: string, lineId: string): Promise<string> {
    const fulfillmentId = await write('fulfillment', {
      fulfillment_order: related('order', orderId),
      fulfillment_sequence: { valueNumber: 1 },
      fulfillment_shipped_at: { valueDate: '2026-09-02T17:00:00.000Z' },
      fulfillment_status: { optionId: 'success' },
      fulfillment_subtotal: { valueNumber: 10_000 },
      fulfillment_total: { valueNumber: 10_800 },
    })
    await write('fulfillment_line', {
      fulfillment_line_fulfillment: related('fulfillment', fulfillmentId),
      fulfillment_line_line_item: related('line_item', lineId),
      fulfillment_line_quantity: { valueNumber: 1 },
    })
    return fulfillmentId
  }

  async function postShipment(fulfillmentId: string) {
    const result = await postFulfillmentAccounting(db(), { organizationId, fulfillmentId })
    expect(result).toMatchObject({ status: 'accepted' })
    const glPostingId = (result as { glPostingId: string }).glPostingId
    const lines = await db()
      .select()
      .from(schema.GlPostingLine)
      .where(eq(schema.GlPostingLine.glPostingId, glPostingId))
    return lines
      .sort((a, b) => a.lineNumber - b.lineNumber)
      .map((line) => ({
        role: line.accountRole,
        account: line.glAccountId,
        direction: line.direction,
        amount: line.amountMinor,
        counterparty: line.counterpartyId,
      }))
  }

  /** The posted balance of one account, debit positive. */
  async function balance(glAccountId: string): Promise<number> {
    const lines = await db()
      .select({
        direction: schema.GlPostingLine.direction,
        amount: schema.GlPostingLine.amountMinor,
      })
      .from(schema.GlPostingLine)
      .innerJoin(schema.GlPosting, eq(schema.GlPosting.id, schema.GlPostingLine.glPostingId))
      .where(
        and(
          eq(schema.GlPostingLine.organizationId, organizationId),
          eq(schema.GlPostingLine.glAccountId, glAccountId),
          eq(schema.GlPosting.status, 'posted')
        )
      )
    return lines.reduce((sum, l) => sum + (l.direction === 'debit' ? l.amount : -l.amount), 0)
  }

  beforeEach(async () => {
    await setting('accounting.autoPost.fulfillment', true)
  })

  it('posts Dr A/R 108 / Cr revenue 100, Cr tax 8 whether or not the receipt came first', async () => {
    const shipped: Array<Awaited<ReturnType<typeof postShipment>>> = []
    for (const receiptFirst of [false, true]) {
      const { orderId, lineId } = await order(receiptFirst ? '#13002' : '#13001')
      if (receiptFirst) {
        const receipt = await movement({
          purpose: 'customer_receipt',
          amountMinor: 10_800n,
          occurredAt: '2026-09-01T17:00:00.000Z',
          partyInstanceId: customerId,
          orderId,
        })
        await postReceipt(receipt)
      }
      shipped.push(await postShipment(await shipment(orderId, lineId)))
    }
    for (const lines of shipped) {
      expect(lines.map(({ account: _account, ...line }) => line)).toEqual([
        {
          role: 'accounts_receivable',
          direction: 'debit',
          amount: 10_800,
          counterparty: customerId,
        },
        { role: 'revenue_product', direction: 'credit', amount: 10_000, counterparty: null },
        { role: 'sales_tax_payable', direction: 'credit', amount: 800, counterparty: null },
      ])
    }
    expect(shipped[0]).toEqual(shipped[1])
  })

  it("lands the store's receipt and shipment on the store's own A/R, which nets to zero", async () => {
    const { orderId, lineId } = await order('#13003')
    const receipt = await movement({
      purpose: 'customer_receipt',
      amountMinor: 10_800n,
      occurredAt: '2026-09-01T17:00:00.000Z',
      partyInstanceId: customerId,
      orderId,
    })
    // The per-store account the Mapping tab creates, pinned to the A/R subtype.
    const storeAr = (
      await createChartAccount(db(), {
        organizationId,
        actorUserId: userId,
        code: '1110',
        name: 'Shopify receivable',
        accountType: 'asset',
        subtype: 'accounts_receivable',
      })
    )._unsafeUnwrap()
    const unpinned = (
      await createChartAccount(db(), {
        organizationId,
        actorUserId: userId,
        code: '1190',
        name: 'Other receivable',
        accountType: 'asset',
      })
    )._unsafeUnwrap()
    const refused = await setRoleAssignment(db(), {
      organizationId,
      role: 'accounts_receivable',
      glAccountId: unpinned.id,
      sourceAccountId,
    })
    expect(refused.isErr()).toBe(true)
    const mapped = await setRoleAssignment(db(), {
      organizationId,
      role: 'accounts_receivable',
      glAccountId: storeAr.id,
      sourceAccountId,
    })
    expect(mapped.isOk()).toBe(true)

    const receiptLines = (await postReceipt(receipt)).lines
    expect(receiptLines[1]).toMatchObject({ account: 'Shopify receivable', direction: 'credit' })
    const shipmentLines = await postShipment(await shipment(orderId, lineId))
    expect(shipmentLines[0]).toMatchObject({ role: 'accounts_receivable', account: storeAr.id })
    expect(await balance(storeAr.id)).toBe(0)
  })
})

// 91 S2: the memo and the refund of the same orders (91 D4) - neither waits for the other.
describe('the memo and the refund of 91 §2, in any arrival order', () => {
  type Value = Partial<typeof schema.FieldValue.$inferInsert>

  async function write(entityType: string, values: Record<string, Value>): Promise<string> {
    const id = await record(entityType)
    const rows = await db()
      .select({ id: schema.CustomField.id, attribute: schema.CustomField.systemAttribute })
      .from(schema.CustomField)
      .where(eq(schema.CustomField.organizationId, organizationId))
    const fields = new Map(rows.map((row) => [row.attribute, row.id]))
    await db()
      .insert(schema.FieldValue)
      .values(
        Object.entries(values).map(([attribute, value]) => ({
          organizationId,
          entityId: id,
          entityDefinitionId: defs.get(entityType)!.id,
          fieldId: fields.get(attribute)!,
          updatedAt: new Date(),
          ...value,
        }))
      )
    return id
  }

  const related = (entityType: string, id: string): Value => ({
    relatedEntityId: id,
    relatedEntityDefinitionId: defs.get(entityType)!.id,
  })

  /** A line item as the channel stamps it; `fulfilledQty` undefined leaves it unstamped. */
  async function lineItem(orderId: string, fulfilledQty?: number): Promise<string> {
    return write('line_item', {
      line_item_order: related('order', orderId),
      line_item_name: { valueText: 'Hoodie' },
      line_item_qty: { valueNumber: 1 },
      ...(fulfilledQty === undefined
        ? {}
        : {
            line_item_fulfilled_qty: { valueNumber: fulfilledQty },
            ...(fulfilledQty > 0
              ? { line_item_fulfilled_at: { valueDate: '2026-09-02T17:00:00.000Z' } }
              : {}),
          }),
    })
  }

  /** A channel memo record, as the refund's link step and the entitlement check read it. */
  async function memoRecord(orderId: string, totalMinor: number): Promise<string> {
    return write('credit_memo', {
      credit_memo_number: { valueText: `CM-${orderId.slice(-6)}` },
      credit_memo_status: { optionId: 'issued' },
      credit_memo_source: { optionId: 'channel' },
      credit_memo_issued_at: { valueDate: '2026-09-10T12:00:00.000Z' },
      credit_memo_contact: related('contact', customerId),
      credit_memo_order: related('order', orderId),
      credit_memo_total: { valueNumber: totalMinor },
    })
  }

  /** Issue a memo's entry from in-memory lines: the per-line read is the real one. */
  async function issueMemo(
    orderId: string,
    lines: Array<{ lineItemId: string | null; subtotal: number; tax: number }>
  ) {
    const { readShippedMemoLineIds } = await import('../../../sales/credit-memos/reads')
    const { buildEntryForCreditMemo, postCreditMemoEntry } = await import(
      '../../../sales/credit-memos/accounting'
    )
    const memoId = await record('credit_memo')
    const memo = {
      id: memoId,
      number: `CM-${memoId.slice(-6)}`,
      source: 'channel',
      contactInstanceId: customerId,
      orderInstanceId: orderId,
    } as Parameters<typeof buildEntryForCreditMemo>[0]['memo']
    const memoLines = lines.map((line, index) => ({
      id: `line_${index}`,
      lineItemInstanceId: line.lineItemId,
      subtotalMinor: line.subtotal,
      taxTotalMinor: line.tax,
    })) as unknown as Parameters<typeof buildEntryForCreditMemo>[0]['lines']
    const built = buildEntryForCreditMemo({
      memo,
      lines: memoLines,
      issuedAt: '2026-09-10',
      currency: 'USD',
      shippedLineIds: await readShippedMemoLineIds(
        db(),
        organizationId,
        memo,
        memoLines,
        '2026-09-10'
      ),
    })
    if (!built) return null
    const post = await postCreditMemoEntry(db(), {
      organizationId,
      creditMemoInstanceId: memoId,
      contactInstanceId: customerId,
      orderInstanceId: orderId,
      entry: built.entry,
    })
    expect(post).toMatchObject({ status: 'posted' })
    return linesOf(post.glPostingId!)
  }

  async function linesOf(glPostingId: string) {
    const lines = await db()
      .select()
      .from(schema.GlPostingLine)
      .where(eq(schema.GlPostingLine.glPostingId, glPostingId))
    return lines
      .sort((a, b) => a.lineNumber - b.lineNumber)
      .map((line) => ({
        // A role line names its role; the endpoint is resolved to an account, so its name.
        role: line.accountRole ?? line.accountName,
        direction: line.direction,
        amount: line.amountMinor,
        counterparty: line.counterpartyId,
        sourceType: line.sourceType,
      }))
  }

  async function postRefund(moneyId: string) {
    const { postCustomerRefundAccounting } = await import('../refund-accounting')
    const result = await postCustomerRefundAccounting(db(), {
      organizationId,
      moneyTransactionId: moneyId,
    })
    expect(result).toMatchObject({ status: 'accepted' })
    const glPostingId = (result as { glPostingId: string }).glPostingId
    const links = await db()
      .select({
        kind: schema.GlPostingSource.sourceKind,
        role: schema.GlPostingSource.linkRole,
      })
      .from(schema.GlPostingSource)
      .where(eq(schema.GlPostingSource.glPostingId, glPostingId))
    return {
      glPostingId,
      lines: await linesOf(glPostingId),
      links: links.map((l) => `${l.role}:${l.kind}`).sort(),
    }
  }

  const refund54 = (orderId: string) =>
    movement({
      purpose: 'customer_refund',
      amountMinor: 5_400n,
      occurredAt: '2026-09-10T17:00:00.000Z',
      partyInstanceId: customerId,
      orderId,
    })

  // A function: `customerId` is set per test.
  const REFUND_54 = () => [
    {
      role: 'accounts_receivable',
      direction: 'debit',
      amount: 5_400,
      counterparty: customerId,
      sourceType: 'money_transaction',
    },
    {
      role: 'Undeposited Funds',
      direction: 'credit',
      amount: 5_400,
      counterparty: null,
      sourceType: 'money_transaction',
    },
  ]

  beforeEach(async () => {
    await setting('accounting.autoPost.refund', true)
    await setting('accounting.autoPost.creditMemo', true)
  })

  it('posts the refund Dr A/R 54 / Cr endpoint 54 with no memo, memo posting or receipt posting', async () => {
    const orderId = await record('order')
    const entry = await postRefund(await refund54(orderId))
    expect(entry.lines).toEqual(REFUND_54())
    expect(entry.links).toEqual([
      'counterparty:contact',
      'parent:order',
      'subject:money_transaction',
    ])
  })

  it('the memo reverses the shipped line only: Dr returns 50 · Dr tax 4 / Cr A/R 54', async () => {
    const orderId = await record('order')
    const shipped = await lineItem(orderId, 1)
    const unshipped = await lineItem(orderId, 0)
    const lines = await issueMemo(orderId, [
      { lineItemId: shipped, subtotal: 5_000, tax: 400 },
      { lineItemId: unshipped, subtotal: 3_000, tax: 240 },
    ])
    expect(lines).toEqual([
      {
        role: 'revenue_returns_allowances',
        direction: 'debit',
        amount: 5_000,
        counterparty: null,
        sourceType: 'credit_memo',
      },
      {
        role: 'sales_tax_payable',
        direction: 'debit',
        amount: 400,
        counterparty: null,
        sourceType: 'credit_memo',
      },
      {
        role: 'accounts_receivable',
        direction: 'credit',
        amount: 5_400,
        counterparty: customerId,
        sourceType: 'credit_memo',
      },
    ])
  })

  it('refunded in full before it ships: the memo posts nothing, the refund the same entry', async () => {
    const orderId = await record('order')
    const unshipped = await lineItem(orderId, 0)
    expect(await issueMemo(orderId, [{ lineItemId: unshipped, subtotal: 5_000, tax: 400 }])).toBe(
      null
    )
    expect((await postRefund(await refund54(orderId))).lines).toEqual(REFUND_54())
  })

  it('reads an unstamped line as the channel saying nothing, and reverses it', async () => {
    const orderId = await record('order')
    const unstamped = await lineItem(orderId)
    const lines = await issueMemo(orderId, [{ lineItemId: unstamped, subtotal: 5_000, tax: 400 }])
    expect(lines?.map((line) => line.role)).toEqual([
      'revenue_returns_allowances',
      'sales_tax_payable',
      'accounts_receivable',
    ])
  })

  it('a memo arriving after the refund posted is linked, and an exceeded one warns', async () => {
    const { linkRefundPostingToMemos } = await import('../refund-accounting')
    for (const [memoTotal, warns] of [
      [5_400, false],
      [5_000, true],
    ] as const) {
      const orderId = await record('order')
      const refundId = await refund54(orderId)
      const posted = await postRefund(refundId)

      const memoId = await memoRecord(orderId, memoTotal)
      await db()
        .insert(schema.MoneyRefundSettlement)
        .values({
          organizationId,
          refundTransactionId: refundId,
          amountMinor: 5_400n,
          disposition: 'customer_credit',
          customerCreditMemoInstanceId: memoId,
          commandId,
          commandItemKey: `link:${refundId}`,
        })
      await linkRefundPostingToMemos(db(), organizationId, refundId)

      const again = await postRefund(refundId)
      expect(again.glPostingId).toBe(posted.glPostingId)
      expect(again.lines).toEqual(REFUND_54())
      expect(again.links).toContain('parent:credit_memo')
      const warning = await db().query.AccountingWorkItem.findFirst({
        where: and(
          eq(schema.AccountingWorkItem.organizationId, organizationId),
          eq(schema.AccountingWorkItem.sourceId, refundId)
        ),
      })
      if (warns) expect(warning).toMatchObject({ reasonCode: 'REFUND_EXCEEDS_MEMO', stage: 'post' })
      else expect(warning).toBeUndefined()
    }
  })
})
