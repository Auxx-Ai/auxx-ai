// packages/lib/src/accounting/sales/fulfillments/__tests__/accounting.int.test.ts
//
// 88 D5, Trigger 2: the sweep's queue in real SQL. The candidate query is the
// half of the poster a unit test cannot reach - it is one statement over
// `FieldValue` and `GlPostingSource`, and every predicate in it is a rule
// (stamped, non-zero, live, after the cutoff, unclaimed, never tried).

import { type Database, schema } from '@auxx/database'
import { createTestOrganization, createTestUser, getTestDb } from '@auxx/test-utils'
import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createEntityDefinitions } from '../../../../seed/entity-seeder/create-entity-defs'
import { createAllFields } from '../../../../seed/entity-seeder/create-fields'
import { linkRelationships } from '../../../../seed/entity-seeder/link-relationships'
import type { EntityDefMap } from '../../../../seed/entity-seeder/types'
import { upsertWorkItem } from '../../../work-items/write'
import {
  type FulfillmentCandidateWindow,
  listFulfillmentAccountingCandidates,
  readShipmentDetail,
} from '../posting-reads'

vi.mock('@auxx/redis', async (original) => ({
  ...(await original<typeof import('@auxx/redis')>()),
  getRedisClient: async () => {
    throw new Error('No Redis in shipment-sweep database tests')
  },
}))

const db = () => getTestDb() as unknown as Database

const WINDOW: FulfillmentCandidateWindow = {
  cutoffPeriod: '2026-02',
  bookTimeZone: 'UTC',
}

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

/** A shipment as the stamp leaves it, unless a test says otherwise. */
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

/** A refusal parked on the shipment, as the poster writes it. */
async function park(
  fulfillmentInstanceId: string,
  reasonCode: 'TOTALS_NOT_STAMPED' | 'PERIOD_LOCKED'
) {
  const written = await upsertWorkItem(db(), organizationId, {
    sourceKind: 'fulfillment',
    sourceId: fulfillmentInstanceId,
    stage: 'post',
    reasonCode,
    ...(reasonCode === 'PERIOD_LOCKED' ? { periodKey: '2026-03' } : {}),
  })
  expect(written.isOk()).toBe(true)
}

/** The `subject` link a posting holds over a shipment. */
async function claim(fulfillmentInstanceId: string, occurrence = 'original') {
  const [posting] = await db()
    .insert(schema.GlPosting)
    .values({
      organizationId,
      postingType: 'fulfillment',
      periodKey: `k-${fulfillmentInstanceId}`,
      status: 'posted',
      txnDate: '2026-03-15',
      totalMinor: 10800,
      built: {},
      postedAt: new Date(),
    })
    .returning()
  await db().insert(schema.GlPostingSource).values({
    organizationId,
    glPostingId: posting!.id,
    sourceKind: 'fulfillment',
    sourceId: fulfillmentInstanceId,
    linkRole: 'subject',
    occurrence,
  })
}

const candidates = () => listFulfillmentAccountingCandidates(db(), organizationId, 100, WINDOW)

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

describe('listFulfillmentAccountingCandidates', () => {
  it('offers the earliest shipment first', async () => {
    const late = await fulfillment({ shippedAt: '2026-03-20T12:00:00.000Z' })
    const early = await fulfillment({ shippedAt: '2026-03-02T12:00:00.000Z' })
    const middle = await fulfillment({ shippedAt: '2026-03-10T12:00:00.000Z' })

    expect(await candidates()).toEqual([early, middle, late])
  })

  it('leaves out the cancelled, the unstamped, the $0 and the claimed', async () => {
    await fulfillment({ status: 'cancelled' })
    await fulfillment({ subtotal: null })
    await fulfillment({ total: 0 })
    await claim(await fulfillment())

    expect(await candidates()).toEqual([])
  })

  it('still offers a shipment whose only claim is a legacy relief entry', async () => {
    const shipped = await fulfillment()
    await claim(shipped, 'inventory')

    expect(await candidates()).toEqual([shipped])
  })

  it('refuses anything in or before the opening cutoff forever, in SQL', async () => {
    await fulfillment({ shippedAt: '2026-02-28T12:00:00.000Z' })
    await fulfillment({ shippedAt: '2026-01-15T12:00:00.000Z' })
    const after = await fulfillment({ shippedAt: '2026-03-01T12:00:00.000Z' })

    expect(await candidates()).toEqual([after])
  })

  it('offers only the never-tried: a parked shipment comes back through its work item', async () => {
    await park(await fulfillment(), 'TOTALS_NOT_STAMPED')
    const fresh = await fulfillment()

    expect(await candidates()).toEqual([fresh])
  })
})

describe('readShipmentDetail', () => {
  it('reads a shipment with its order facts and its work items, parked or not', async () => {
    const parked = await fulfillment()
    await park(parked, 'PERIOD_LOCKED')
    const clean = await fulfillment()

    const detail = await readShipmentDetail(db(), organizationId, parked)
    expect(detail).toMatchObject({
      id: parked,
      entityDefinitionId: defs.get('fulfillment')!.id,
      amountMinor: 10800,
      shippedAt: '2026-03-15T12:00:00.000Z',
    })
    expect(detail?.workItems.map((item) => [item.reasonCode, item.periodKey])).toEqual([
      ['PERIOD_LOCKED', '2026-03'],
    ])
    expect((await readShipmentDetail(db(), organizationId, clean))?.workItems).toEqual([])
    expect(await readShipmentDetail(db(), organizationId, 'missing')).toBeNull()
  })
})
