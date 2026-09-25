// packages/lib/src/accounting/ledger/periods/__tests__/read-close-blockers.int.test.ts
//
// 88 D8: the close counts the shipments the month recognised nothing for.
// Real rows, because the count is one SQL over `FieldValue` and the claim.

import { type Database, schema } from '@auxx/database'
import { createTestOrganization, createTestUser, getTestDb } from '@auxx/test-utils'
import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createEntityDefinitions } from '../../../../seed/entity-seeder/create-entity-defs'
import { createAllFields } from '../../../../seed/entity-seeder/create-fields'
import { linkRelationships } from '../../../../seed/entity-seeder/link-relationships'
import type { EntityDefMap } from '../../../../seed/entity-seeder/types'
import { readCloseBlockers } from '../read-close-blockers'

vi.mock('@auxx/redis', async (original) => ({
  ...(await original<typeof import('@auxx/redis')>()),
  getRedisClient: async () => {
    throw new Error('No Redis in close-blocker database tests')
  },
}))

const db = () => getTestDb() as unknown as Database
const MONTH = '2026-03'

let organizationId: string
let userId: string
let defs: EntityDefMap
let fields: Map<string, typeof schema.CustomField.$inferSelect>

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

/** A fulfillment as the stamp leaves it, unless a test says otherwise. */
async function fulfillment(
  overrides: {
    shippedAt?: string | null
    status?: string
    subtotal?: number | null
    total?: number | null
  } = {}
) {
  const [row] = await db()
    .insert(schema.EntityInstance)
    .values({
      organizationId,
      entityDefinitionId: defs.get('fulfillment')!.id,
      createdById: userId,
      updatedAt: new Date(),
    })
    .returning()
  const id = row!.id
  const {
    shippedAt = '2026-03-15T12:00:00.000Z',
    status = 'success',
    subtotal = 10000,
    total = 10800,
  } = overrides
  if (shippedAt) await value(id, 'fulfillment_shipped_at', { valueDate: shippedAt })
  await value(id, 'fulfillment_status', { optionId: status })
  if (subtotal !== null) await value(id, 'fulfillment_subtotal', { valueNumber: subtotal })
  if (total !== null) await value(id, 'fulfillment_total', { valueNumber: total })
  return id
}

/** The claim a posting holds over a shipment. `reversed` deletes the row, so it takes none. */
async function claim(
  fulfillmentInstanceId: string,
  status: 'posted' | 'reversed',
  occurrence = 'original'
) {
  const [posting] = await db()
    .insert(schema.GlPosting)
    .values({
      organizationId,
      postingType: 'fulfillment',
      periodKey: MONTH,
      status,
      txnDate: '2026-03-15',
      totalMinor: 10800,
      built: {},
      postedAt: new Date(),
    })
    .returning()
  if (status === 'reversed') return
  await db().insert(schema.GlPostingSource).values({
    organizationId,
    glPostingId: posting!.id,
    sourceKind: 'fulfillment',
    sourceId: fulfillmentInstanceId,
    linkRole: 'subject',
    occurrence,
  })
}

async function unpostedShipments(): Promise<number | undefined> {
  const result = await readCloseBlockers(db(), { organizationId, periodKey: MONTH })
  return result.items.find((item) => item.key === 'unposted_shipments')?.count
}

beforeEach(async () => {
  const org = await createTestOrganization()
  const user = await createTestUser()
  organizationId = org.id
  userId = user.id
  defs = await createEntityDefinitions(db(), organizationId)
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

describe('unposted_shipments', () => {
  it('counts the month, and only the month', async () => {
    await fulfillment()
    await fulfillment({ shippedAt: '2026-03-01T12:00:00.000Z' })
    await fulfillment({ shippedAt: '2026-02-28T12:00:00.000Z' })
    await fulfillment({ shippedAt: '2026-04-01T12:00:00.000Z' })

    expect(await unpostedShipments()).toBe(2)
  })

  it('leaves out the cancelled, the unstamped, the $0 and the claimed', async () => {
    await fulfillment({ status: 'cancelled' })
    await fulfillment({ subtotal: null })
    await fulfillment({ total: 0 })
    await claim(await fulfillment(), 'posted')

    expect(await unpostedShipments()).toBeUndefined()
  })

  it('counts a shipment again once its posting is reversed', async () => {
    // A reversal deletes the subject row, so the claim is free (TARGET §1).
    await claim(await fulfillment(), 'reversed')

    expect(await unpostedShipments()).toBe(1)
  })

  it('counts a shipment whose only claim is a legacy relief entry', async () => {
    await claim(await fulfillment(), 'posted', 'inventory')

    expect(await unpostedShipments()).toBe(1)
  })

  it('says nothing when every shipment of the month is posted', async () => {
    await claim(await fulfillment(), 'posted')

    const result = await readCloseBlockers(db(), { organizationId, periodKey: MONTH })

    expect(result.items.map((item) => item.key)).not.toContain('unposted_shipments')
  })
})

/** A movement dated in the month: valued at standard, or written pending (111 Q18). */
async function movement(overrides: { occurredAt?: string; pending?: boolean } = {}) {
  const [row] = await db()
    .insert(schema.EntityInstance)
    .values({
      organizationId,
      entityDefinitionId: defs.get('stock_movement')!.id,
      createdById: userId,
      updatedAt: new Date(),
    })
    .returning()
  const id = row!.id
  const { occurredAt = '2026-03-15T12:00:00.000Z', pending = false } = overrides
  await value(id, 'stock_movement_occurred_at', { valueDate: occurredAt })
  await value(id, 'stock_movement_cost_basis', { optionId: pending ? 'pending' : 'standard' })
  if (!pending) await value(id, 'stock_movement_extended_cost', { valueNumber: 1200 })
  return id
}

/** The member link a posted inventory entry holds over a movement. */
async function member(movementId: string, status: 'posted' | 'reversed' = 'posted') {
  const [posting] = await db()
    .insert(schema.GlPosting)
    .values({
      organizationId,
      postingType: 'inventory_movement',
      periodKey: MONTH,
      status,
      txnDate: '2026-03-15',
      totalMinor: 1200,
      built: {},
      postedAt: new Date(),
    })
    .returning()
  await db().insert(schema.GlPostingSource).values({
    organizationId,
    glPostingId: posting!.id,
    sourceKind: 'stock_movement',
    sourceId: movementId,
    linkRole: 'member',
    occurrence: 'original',
  })
}

async function inventoryCounts(): Promise<{ pending?: number; unposted?: number }> {
  const result = await readCloseBlockers(db(), { organizationId, periodKey: MONTH })
  return {
    pending: result.items.find((item) => item.key === 'inventory_pending_cost')?.count,
    unposted: result.items.find((item) => item.key === 'inventory_unposted')?.count,
  }
}

describe('inventory_pending_cost and inventory_unposted', () => {
  it('counts a pending row under pending only, never as unposted', async () => {
    await movement({ pending: true })
    await movement({ pending: true, occurredAt: '2026-04-01T12:00:00.000Z' })

    expect(await inventoryCounts()).toEqual({ pending: 1, unposted: undefined })
  })

  it('counts a valued row with no member link as unposted, and a linked one as nothing', async () => {
    await movement()
    await member(await movement())

    expect(await inventoryCounts()).toEqual({ pending: undefined, unposted: 1 })
  })

  it('counts a valued row again once its entry is reversed', async () => {
    await member(await movement(), 'reversed')

    expect((await inventoryCounts()).unposted).toBe(1)
  })

  it('keeps the two apart in one month', async () => {
    await movement({ pending: true })
    await movement()
    await member(await movement())

    expect(await inventoryCounts()).toEqual({ pending: 1, unposted: 1 })
  })
})
