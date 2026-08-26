// packages/lib/src/entity-definitions/__tests__/definition-timeline-sweep.int.test.ts
//
// DB-backed regression test (vitest.integration.config.ts → auxx_test) for an
// entity-definition teardown stranding the timeline of every record it held.
//
// Deleting the definition cascades its instances, but `TimelineEvent.entityId` is
// a bare `text()` column with no FK, so the cascade never reached it. One such
// teardown left 95,085 rows behind in dev — all written inside a 40-minute window
// on 2026-06-24, 41% of the whole table — pointing at instances that were gone
// and carrying an `entityType` whose definition was gone too.
//
// WHY INTEGRATION. The sweep has to run BEFORE the definition delete, because it
// resolves its target set through the very instances that delete cascades away.
// Only real SQL, in the real order, proves the subquery still saw them. The
// existing `delete-entity-definition.test.ts` is pure-helper coverage by design
// ("the DB orchestration has no vitest harness") and is the wrong home for this.

import { type Database, schema } from '@auxx/database'
import { createTestOrganization, getTestDb } from '@auxx/test-utils'
import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import { deleteEntityDefinitionDeep } from '../delete-entity-definition'

const db = () => getTestDb() as never as Database

interface Fixture {
  orgId: string
  /** Custom def — `entityType` must be null, system entities refuse deletion. */
  defId: string
  instanceA: string
  instanceB: string
  /** Lives under a DIFFERENT def in the same org; must survive untouched. */
  bystander: string
  bystanderDefId: string
}

async function definition(orgId: string, apiSlug: string): Promise<string> {
  const [def] = await db()
    .insert(schema.EntityDefinition)
    .values({
      organizationId: orgId,
      entityType: null,
      apiSlug,
      singular: apiSlug,
      plural: apiSlug,
      updatedAt: new Date(),
    })
    .returning()
  return def!.id
}

async function instance(orgId: string, defId: string, displayName: string): Promise<string> {
  const [row] = await db()
    .insert(schema.EntityInstance)
    .values({
      organizationId: orgId,
      entityDefinitionId: defId,
      displayName,
      updatedAt: new Date(),
    })
    .returning()
  return row!.id
}

async function timelineEvent(orgId: string, entityType: string, entityId: string): Promise<void> {
  await db().insert(schema.TimelineEvent).values({
    organizationId: orgId,
    eventType: 'entity:field:updated',
    startedAt: new Date(),
    entityType,
    entityId,
    updatedAt: new Date(),
  })
}

async function eventsFor(id: string) {
  return await db().select().from(schema.TimelineEvent).where(eq(schema.TimelineEvent.entityId, id))
}

async function seed(): Promise<Fixture> {
  const org = await createTestOrganization()
  const defId = await definition(org.id, 'widgets')
  const bystanderDefId = await definition(org.id, 'gadgets')

  return {
    orgId: org.id,
    defId,
    bystanderDefId,
    instanceA: await instance(org.id, defId, 'Widget A'),
    instanceB: await instance(org.id, defId, 'Widget B'),
    bystander: await instance(org.id, bystanderDefId, 'Gadget'),
  }
}

let f: Fixture
beforeEach(async () => {
  f = await seed()
})

describe('deleteEntityDefinitionDeep — timeline sweep', () => {
  it('takes the timeline of every instance the definition held', async () => {
    await timelineEvent(f.orgId, f.defId, f.instanceA)
    await timelineEvent(f.orgId, f.defId, f.instanceA)
    await timelineEvent(f.orgId, f.defId, f.instanceB)

    await deleteEntityDefinitionDeep({ id: f.defId, organizationId: f.orgId, db: db() })

    expect(await eventsFor(f.instanceA)).toHaveLength(0)
    expect(await eventsFor(f.instanceB)).toHaveLength(0)
  })

  it('⚠️ sweeps BOTH entityType keyspaces, not just the def id', async () => {
    // `createTimelineEvent` stamps `EntityDefinition.id`; money's writers stamp the
    // type slug (`toRecordId('order', …)`). Keying the sweep on the def id — the
    // obvious thing, since a def is what is being deleted — would clear only the
    // first of these two.
    await timelineEvent(f.orgId, f.defId, f.instanceA)
    await timelineEvent(f.orgId, 'widget', f.instanceA)

    await deleteEntityDefinitionDeep({ id: f.defId, organizationId: f.orgId, db: db() })

    expect(await eventsFor(f.instanceA)).toHaveLength(0)
  })

  it('leaves another definition’s records alone', async () => {
    await timelineEvent(f.orgId, f.defId, f.instanceA)
    await timelineEvent(f.orgId, f.bystanderDefId, f.bystander)

    await deleteEntityDefinitionDeep({ id: f.defId, organizationId: f.orgId, db: db() })

    expect(await eventsFor(f.bystander)).toHaveLength(1)
  })

  it('is a no-op when the definition held no instances', async () => {
    const emptyDefId = await definition(f.orgId, 'empties')
    await timelineEvent(f.orgId, f.defId, f.instanceA)

    await deleteEntityDefinitionDeep({ id: emptyDefId, organizationId: f.orgId, db: db() })

    // Nothing to sweep, and the untouched def keeps its own record's history.
    expect(await eventsFor(f.instanceA)).toHaveLength(1)
  })
})
