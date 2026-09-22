// packages/lib/src/accounting/sales/fulfillments/__tests__/accounting.int.test.ts
//
// 88 D5, Trigger 2: the sweep's queue in real SQL. The candidate query is the
// half of the poster a unit test cannot reach - it is one statement over
// `FieldValue` and `GlPostingSource`, and every predicate in it is a rule
// (stamped, non-zero, live, after the cutoff, unclaimed, past its back-off).

import { type Database, schema } from '@auxx/database'
import { createTestOrganization, createTestUser, getTestDb } from '@auxx/test-utils'
import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createEntityDefinitions } from '../../../../seed/entity-seeder/create-entity-defs'
import { createAllFields } from '../../../../seed/entity-seeder/create-fields'
import { linkRelationships } from '../../../../seed/entity-seeder/link-relationships'
import type { EntityDefMap } from '../../../../seed/entity-seeder/types'
import {
  countBlockedFulfillments,
  type FulfillmentCandidateWindow,
  listBlockedFulfillments,
  listFulfillmentAccountingCandidates,
  readBlockedFulfillment,
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
  retryBefore: new Date('2026-03-20T12:00:00.000Z'),
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
    blockedAt?: string | null
    reason?: string | null
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
    blockedAt = null,
    reason = null,
  } = overrides
  if (shippedAt) await value(id, 'fulfillment_shipped_at', { valueDate: shippedAt })
  await value(id, 'fulfillment_status', { optionId: status })
  if (subtotal !== null) await value(id, 'fulfillment_subtotal', { valueNumber: subtotal })
  if (total !== null) await value(id, 'fulfillment_total', { valueNumber: total })
  if (blockedAt) await value(id, 'fulfillment_posting_blocked_at', { valueDate: blockedAt })
  if (reason) await value(id, 'fulfillment_posting_blocked_reason', { valueText: reason })
  return id
}

/** The link a posting holds over a shipment: `subject` when live, `pending` on a draft. */
async function claim(fulfillmentInstanceId: string, kind: 'posted' | 'draft') {
  const [posting] = await db()
    .insert(schema.GlPosting)
    .values({
      organizationId,
      postingType: 'fulfillment',
      periodKey: `k-${fulfillmentInstanceId}`,
      status: kind,
      txnDate: '2026-03-15',
      totalMinor: 10800,
      built: {},
      postedAt: kind === 'posted' ? new Date() : null,
    })
    .returning()
  await db()
    .insert(schema.GlPostingSource)
    .values({
      organizationId,
      glPostingId: posting!.id,
      sourceKind: 'fulfillment',
      sourceId: fulfillmentInstanceId,
      linkRole: kind === 'posted' ? 'subject' : 'pending',
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
  it('offers the earliest shipment first - the timeline wants it posted first', async () => {
    const late = await fulfillment({ shippedAt: '2026-03-20T12:00:00.000Z' })
    const early = await fulfillment({ shippedAt: '2026-03-02T12:00:00.000Z' })
    const middle = await fulfillment({ shippedAt: '2026-03-10T12:00:00.000Z' })

    expect(await candidates()).toEqual([early, middle, late])
  })

  it('leaves out the cancelled, the unstamped, the $0, the claimed and the drafted', async () => {
    await fulfillment({ status: 'cancelled' })
    await fulfillment({ subtotal: null })
    await fulfillment({ total: 0 })
    await claim(await fulfillment(), 'posted')
    await claim(await fulfillment(), 'draft')

    expect(await candidates()).toEqual([])
  })

  it('refuses anything in or before the opening cutoff forever, in SQL', async () => {
    await fulfillment({ shippedAt: '2026-02-28T12:00:00.000Z' })
    await fulfillment({ shippedAt: '2026-01-15T12:00:00.000Z' })
    const after = await fulfillment({ shippedAt: '2026-03-01T12:00:00.000Z' })

    expect(await candidates()).toEqual([after])
  })

  it('holds a shipment refused inside the back-off, and offers one refused before it', async () => {
    await fulfillment({ blockedAt: '2026-03-20T13:00:00.000Z' })
    const stale = await fulfillment({ blockedAt: '2026-03-20T11:00:00.000Z' })

    expect(await candidates()).toEqual([stale])
  })
})

describe('listBlockedFulfillments', () => {
  it('lists refused shipments newest refusal first, with the reason verbatim', async () => {
    const older = await fulfillment({
      reason: 'Cannot post: revenue_product is not mapped',
      blockedAt: '2026-03-18T10:00:00.000Z',
    })
    const newer = await fulfillment({
      reason: 'Shipment totals are not stamped yet',
      blockedAt: '2026-03-19T10:00:00.000Z',
    })
    await fulfillment()
    const claimed = await fulfillment({ reason: 'stale', blockedAt: '2026-03-20T10:00:00.000Z' })
    await claim(claimed, 'posted')

    const rows = await listBlockedFulfillments(db(), organizationId)
    expect(rows.map((row) => row.id)).toEqual([newer, older])
    expect(rows[0]).toMatchObject({
      reason: 'Shipment totals are not stamped yet',
      reasonKind: 'other',
      amountMinor: 10800,
      shippedAt: '2026-03-15T12:00:00.000Z',
      entityDefinitionId: defs.get('fulfillment')!.id,
    })
    expect(rows[1]?.reasonKind).toBe('account_unmapped')
    expect(await countBlockedFulfillments(db(), organizationId)).toBe(2)
  })

  it('reads one refused shipment by id, and null once it is not refused', async () => {
    const refused = await fulfillment({ reason: 'Period locked' })
    const clean = await fulfillment()
    expect((await readBlockedFulfillment(db(), organizationId, refused))?.id).toBe(refused)
    expect(await readBlockedFulfillment(db(), organizationId, clean)).toBeNull()
  })

  it('searches the reason and cuts on the shipped day', async () => {
    const hit = await fulfillment({
      reason: 'Period locked',
      shippedAt: '2026-03-15T12:00:00.000Z',
    })
    await fulfillment({ reason: 'Cannot post: x', shippedAt: '2026-03-15T12:00:00.000Z' })
    await fulfillment({ reason: 'Period locked', shippedAt: '2026-04-01T12:00:00.000Z' })

    const rows = await listBlockedFulfillments(db(), organizationId, {
      search: 'locked',
      from: '2026-03-01',
      to: '2026-03-31',
    })
    expect(rows.map((row) => row.id)).toEqual([hit])
  })
})
