// packages/lib/src/entity-instances/__tests__/timeline-sweep.int.test.ts
//
// DB-backed regression test (vitest.integration.config.ts → auxx_test) for a
// deleted record leaving its whole timeline behind.
//
// `TimelineEvent.entityId` is a bare `text()` column with no foreign key, nothing
// in `deleteEntity` ever touched the table, and `deleteEntityDefinitionDeep`
// doesn't either — the `deleteTimelineEvents` service written for exactly this had
// zero callers. 83% of the dev table (189,797 of 229,078 rows) pointed at an
// `entityId` that no longer resolved.
//
// WHY INTEGRATION. The load-bearing claim is about which stored rows survive a
// delete, and specifically about a column written in TWO keyspaces for the same
// record. A mocked db would only prove the delete builder was handed a predicate.
//
// The org cache is mocked wholesale (same approach as
// `dangling-relation-sweep.int.test.ts`) because the sweep's display cascade reads
// Redis-backed `getCachedResources`.

import { type Database, schema } from '@auxx/database'
import { createTestOrganization, getTestDb } from '@auxx/test-utils'
import { and, eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { deleteEntityInstance } from '../delete-entity-instance'

const db = () => getTestDb() as never as Database

vi.mock('../../cache', () => ({
  getCachedResources: async () => [],
}))

interface Fixture {
  orgId: string
  otherOrgId: string
  orderDefId: string
  orderId: string
  contactId: string
}

async function timelineEvent(
  orgId: string,
  entityType: string,
  entityId: string,
  relatedEntityId?: string
): Promise<string> {
  const [row] = await db()
    .insert(schema.TimelineEvent)
    .values({
      organizationId: orgId,
      eventType: 'entity:field:updated',
      startedAt: new Date(),
      entityType,
      entityId,
      relatedEntityId: relatedEntityId ?? null,
      updatedAt: new Date(),
    })
    .returning()
  return row!.id
}

async function seed(): Promise<Fixture> {
  const org = await createTestOrganization()
  const otherOrg = await createTestOrganization()

  const [def] = await db()
    .insert(schema.EntityDefinition)
    .values({
      organizationId: org.id,
      entityType: 'order',
      apiSlug: 'orders',
      singular: 'Order',
      plural: 'Orders',
      updatedAt: new Date(),
    })
    .returning()

  const [order] = await db()
    .insert(schema.EntityInstance)
    .values({
      organizationId: org.id,
      entityDefinitionId: def!.id,
      displayName: 'ORD-0002',
      updatedAt: new Date(),
    })
    .returning()

  const [contact] = await db()
    .insert(schema.EntityInstance)
    .values({
      organizationId: org.id,
      entityDefinitionId: def!.id,
      displayName: 'Mario Dunkel',
      updatedAt: new Date(),
    })
    .returning()

  return {
    orgId: org.id,
    otherOrgId: otherOrg.id,
    orderDefId: def!.id,
    orderId: order!.id,
    contactId: contact!.id,
  }
}

async function eventsFor(id: string) {
  return await db().select().from(schema.TimelineEvent).where(eq(schema.TimelineEvent.entityId, id))
}

let f: Fixture
beforeEach(async () => {
  vi.clearAllMocks()
  f = await seed()
})

describe('deleteEntityInstance — timeline sweep', () => {
  it('takes the deleted record’s own timeline with it', async () => {
    await timelineEvent(f.orgId, f.orderDefId, f.orderId)
    await timelineEvent(f.orgId, f.orderDefId, f.orderId)
    expect(await eventsFor(f.orderId)).toHaveLength(2)

    const result = await deleteEntityInstance({ id: f.orderId, organizationId: f.orgId })
    expect(result.isOk()).toBe(true)

    expect(await eventsFor(f.orderId)).toHaveLength(0)
  })

  it('⚠️ matches on entityId ALONE — entityType carries two keyspaces for one record', async () => {
    // `createTimelineEvent` stamps `EntityDefinition.id`, parsed out of the canonical
    // recordId. Money's own writers build theirs from the type slug
    // (`toRecordId('order', …)`, `money/totals-hooks.ts`), and the two strings never
    // compare equal. One dev order held 12 rows under its def id and 12 under 'order';
    // a delete keyed on entityType would clear exactly half of them.
    await timelineEvent(f.orgId, f.orderDefId, f.orderId)
    await timelineEvent(f.orgId, 'order', f.orderId)

    await deleteEntityInstance({ id: f.orderId, organizationId: f.orgId })

    expect(await eventsFor(f.orderId)).toHaveLength(0)
  })

  it('keeps another record’s history of the dead one — relatedEntityId is not swept', async () => {
    // "This contact once had an order" survives the order. The contact is alive and
    // this row is its timeline, not the order's.
    await timelineEvent(f.orgId, f.orderDefId, f.contactId, f.orderId)

    await deleteEntityInstance({ id: f.orderId, organizationId: f.orgId })

    const survivors = await eventsFor(f.contactId)
    expect(survivors).toHaveLength(1)
    expect(survivors[0]!.relatedEntityId).toBe(f.orderId)
  })

  it('is org-scoped — a mismatched org sweeps nothing', async () => {
    await timelineEvent(f.orgId, f.orderDefId, f.orderId)

    const result = await deleteEntityInstance({ id: f.orderId, organizationId: f.otherOrgId })
    expect(result.isOk()).toBe(true)

    expect(await eventsFor(f.orderId)).toHaveLength(1)
  })

  it('does not reach another record’s events in the same org', async () => {
    await timelineEvent(f.orgId, f.orderDefId, f.orderId)
    await timelineEvent(f.orgId, f.orderDefId, f.contactId)

    await deleteEntityInstance({ id: f.orderId, organizationId: f.orgId })

    expect(await eventsFor(f.contactId)).toHaveLength(1)
    expect(
      await db()
        .select()
        .from(schema.TimelineEvent)
        .where(
          and(
            eq(schema.TimelineEvent.organizationId, f.orgId),
            eq(schema.TimelineEvent.entityId, f.orderId)
          )
        )
    ).toHaveLength(0)
  })
})
