// packages/lib/src/inventory/relief/__tests__/relief-sweep.int.test.ts
//
// plans/accounting/tasks/100 §1.3 in real SQL: a shipment of an unpriced part parks one
// `relieve` row, a first standard wakes it, the sweep relieves it and clears the row, and
// the shipment revenue lane (`fulfillment` at `post`) never sees it.

import { type Database, schema } from '@auxx/database'
import { createTestOrganization, createTestUser, getTestDb } from '@auxx/test-utils'
import { and, eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { listDueWorkItems } from '../../../accounting/work-items/sweep'
import { createEntityDefinitions } from '../../../seed/entity-seeder/create-entity-defs'
import { createAllFields } from '../../../seed/entity-seeder/create-fields'
import { linkRelationships } from '../../../seed/entity-seeder/link-relationships'
import type { EntityDefMap } from '../../../seed/entity-seeder/types'
import { ensureStandardCost } from '../../costing/ensure-standard-cost'
import { pricePendingMovements } from '../../costing/price-pending-movements'
import { backfillFulfillmentRelief } from '../backfill'
import { sweepPendingPricing } from '../relief-sweep'

vi.mock('@auxx/redis', async (original) => ({
  ...(await original<typeof import('@auxx/redis')>()),
  getRedisClient: async () => {
    throw new Error('No Redis in relief sweep database tests')
  },
}))
vi.mock('../../../resources/crud/tx-write-flush', () => ({ flushTxWriteScope: vi.fn() }))
// The doors enqueue on BullMQ; this test prices by calling the job's pricer directly.
vi.mock('../../../accounting/work-items/recovery', () => ({
  requestAccountingRecovery: vi.fn(),
  requestPartPricing: vi.fn(),
}))
vi.mock('../../../events/publisher', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>()
  return { ...actual, publisher: { publish: async () => {}, publishLater: async () => {} } }
})
vi.mock('../../../dedup/enqueue-scan', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../dedup/enqueue-scan')>()
  return { ...actual, enqueueDuplicateScan: async () => {} }
})

const db = () => getTestDb() as unknown as Database

const ENTITY_TYPES = [
  'part',
  'subpart',
  'build',
  'stock_movement',
  'order',
  'line_item',
  'fulfillment',
  'fulfillment_line',
]

let organizationId: string
let userId: string
let defs: EntityDefMap
let fields: Map<string, typeof schema.CustomField.$inferSelect>

async function entity(kind: string, displayName?: string) {
  const [row] = await db()
    .insert(schema.EntityInstance)
    .values({
      organizationId,
      entityDefinitionId: defs.get(kind)!.id,
      createdById: userId,
      updatedAt: new Date(),
      ...(displayName ? { displayName } : {}),
    })
    .returning()
  return row!.id
}

async function value(
  entityId: string,
  attribute: string,
  data: Partial<typeof schema.FieldValue.$inferInsert>
) {
  const field = fields.get(attribute)!
  await db()
    .insert(schema.FieldValue)
    .values({
      organizationId,
      entityId,
      fieldId: field.id,
      entityDefinitionId: field.entityDefinitionId!,
      ...data,
    })
}

const related = (kind: string, id: string) => ({
  relatedEntityId: id,
  relatedEntityDefinitionId: defs.get(kind)!.id,
})

async function relieveRow(fulfillmentId: string) {
  const [row] = await db()
    .select()
    .from(schema.AccountingWorkItem)
    .where(
      and(
        eq(schema.AccountingWorkItem.organizationId, organizationId),
        eq(schema.AccountingWorkItem.sourceId, fulfillmentId),
        eq(schema.AccountingWorkItem.stage, 'price')
      )
    )
  return row ?? null
}

beforeEach(async () => {
  const org = await createTestOrganization()
  const user = await createTestUser()
  organizationId = org.id
  userId = user.id
  await db()
    .update(schema.Organization)
    .set({ systemUserId: userId })
    .where(eq(schema.Organization.id, organizationId))
  const all = await createEntityDefinitions(db(), organizationId)
  defs = new Map([...all].filter(([kind]) => ENTITY_TYPES.includes(kind)))
  const made = await createAllFields(db(), organizationId, defs)
  await linkRelationships(db(), defs, made)
  fields = new Map(
    (
      await db()
        .select()
        .from(schema.CustomField)
        .where(eq(schema.CustomField.organizationId, organizationId))
    ).map((field) => [field.systemAttribute!, field])
  )
})

describe('the relieve lane', () => {
  it('parks an unpriced shipment, wakes on its first standard, relieves and clears it', async () => {
    const partId = await entity('part', 'Widget X')
    const orderId = await entity('order')
    const lineItemId = await entity('line_item')
    await value(lineItemId, 'line_item_part', related('part', partId))
    const fulfillmentId = await entity('fulfillment')
    await value(fulfillmentId, 'fulfillment_order', related('order', orderId))
    await value(fulfillmentId, 'fulfillment_shipped_at', { valueDate: '2026-03-15T12:00:00.000Z' })
    await value(fulfillmentId, 'fulfillment_status', { optionId: 'success' })
    const lineId = await entity('fulfillment_line')
    await value(lineId, 'fulfillment_line_fulfillment', related('fulfillment', fulfillmentId))
    await value(lineId, 'fulfillment_line_line_item', related('line_item', lineItemId))
    await value(lineId, 'fulfillment_line_quantity', { valueNumber: 2 })

    const backfill = await backfillFulfillmentRelief(db(), {
      organizationId,
      userId,
      orderIds: [orderId],
    })
    expect(backfill._unsafeUnwrap().skippedNoCost).toBe(1)

    const parked = await relieveRow(fulfillmentId)
    expect(parked).toMatchObject({
      sourceKind: 'fulfillment',
      reasonCode: 'STANDARD_COST_MISSING',
      externalRef: partId,
      detail: { partIds: [partId], partName: 'Widget X' },
    })
    expect(parked!.nextAttemptAt!.getTime()).toBeGreaterThan(Date.now())

    // The revenue lane sweeps `fulfillment` at `post`; a relieve row is never due there.
    const farFuture = new Date(Date.now() + 365 * 24 * 3600 * 1000)
    expect(
      await listDueWorkItems(db(), organizationId, {
        stage: 'post',
        sourceKind: 'fulfillment',
        limit: 10,
        now: farFuture,
      })
    ).toEqual([])

    const ensured = await ensureStandardCost(db(), organizationId, [partId], {
      kind: 'receipt',
      unitCost: 4_000,
    })
    expect(ensured._unsafeUnwrap().writtenPartIds).toEqual([partId])
    // 111 Q22: the first standard wakes the park and queues `pricePartsJob`, which prices off
    // the request; the recovery lane then finds nothing left to do.
    const woken = await relieveRow(fulfillmentId)
    expect(woken!.nextAttemptAt!.getTime()).toBeLessThanOrEqual(Date.now())
    const priced = await pricePendingMovements(db(), organizationId, [partId])
    expect(priced._unsafeUnwrap().pricedMovementIds).toHaveLength(1)
    expect(await relieveRow(fulfillmentId)).toBeNull()
    const counts = await sweepPendingPricing(db(), { organizationId, limit: 10 })
    expect(counts).toMatchObject({ scanned: 0 })

    const movements = await db()
      .select({ id: schema.EntityInstance.id })
      .from(schema.EntityInstance)
      .where(
        and(
          eq(schema.EntityInstance.organizationId, organizationId),
          eq(schema.EntityInstance.entityDefinitionId, defs.get('stock_movement')!.id)
        )
      )
    expect(movements).toHaveLength(1)
  })
})
