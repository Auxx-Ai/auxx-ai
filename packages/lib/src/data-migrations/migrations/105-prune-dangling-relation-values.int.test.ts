// packages/lib/src/data-migrations/migrations/105-prune-dangling-relation-values.int.test.ts
//
// DB-backed test (vitest.integration.config.ts → auxx_test) for the backfill's
// two ways of destroying live data:
//
//   1. Resolving every target against `EntityInstance` alone. `relatedEntityId`
//      addresses several backing tables — a join against one of them classifies
//      1,256 healthy `Thread` / `Article` / `DispatchWorker` references as
//      dangling and deletes them. `Tag` stands in for that whole family here.
//   2. Treating `archivedAt` as deleted. Archived is not deleted, and zero
//      dangling references point at an archived row.
//
// Runs against the ephemeral `auxx_test` database only — the migration is NOT
// registered as applied anywhere and has never been run against dev or prod.

import { type Database, schema } from '@auxx/database'
import { createTestOrganization, getTestDb } from '@auxx/test-utils'
import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import { migration105PruneDanglingRelationValues } from './105-prune-dangling-relation-values'

const db = () => getTestDb() as never as Database

interface Fixture {
  orgId: string
  contactDefId: string
  workOrderDefId: string
  relationFieldId: string
  textFieldId: string
  workOrderId: string
  liveContactId: string
  archivedContactId: string
  tagId: string
}

/** An id shaped like a real one that resolves in no table at all. */
const GHOST_CONTACT = 'ghost0000000000000000000'
const GHOST_OWNER = 'ghost1111111111111111111'

async function seed(): Promise<Fixture> {
  const org = await createTestOrganization()

  const definition = async (entityType: string, apiSlug: string) => {
    const [def] = await db()
      .insert(schema.EntityDefinition)
      .values({
        organizationId: org.id,
        entityType,
        apiSlug,
        singular: entityType,
        plural: apiSlug,
        updatedAt: new Date(),
      })
      .returning()
    return def!.id
  }

  const contactDefId = await definition('contact', 'contacts')
  const workOrderDefId = await definition('work_order', 'work-orders')

  const field = async (defId: string, modelType: string, name: string, type: string) => {
    const [row] = await db()
      .insert(schema.CustomField)
      .values({
        organizationId: org.id,
        entityDefinitionId: defId,
        modelType,
        name,
        type: type as never,
        sortOrder: 'a1',
        isCustom: false,
        updatedAt: new Date(),
      })
      .returning()
    return row!.id
  }

  const relationFieldId = await field(workOrderDefId, 'work_order', 'Contact', 'RELATIONSHIP')
  const textFieldId = await field(workOrderDefId, 'work_order', 'Notes', 'TEXT')

  const instance = async (defId: string, displayName: string, archived = false) => {
    const [row] = await db()
      .insert(schema.EntityInstance)
      .values({
        organizationId: org.id,
        entityDefinitionId: defId,
        displayName,
        archivedAt: archived ? new Date() : null,
        updatedAt: new Date(),
      })
      .returning()
    return row!.id
  }

  const workOrderId = await instance(workOrderDefId, 'WO-1')
  const liveContactId = await instance(contactDefId, 'Live Contact')
  const archivedContactId = await instance(contactDefId, 'Archived Contact', true)

  // `Tag` is a system table, not `EntityInstance` — the family the naive
  // single-join query would wrongly classify as dangling.
  const [tag] = await db()
    .insert(schema.Tag)
    .values({ organizationId: org.id, title: 'Urgent', updatedAt: new Date() })
    .returning()

  return {
    orgId: org.id,
    contactDefId,
    workOrderDefId,
    relationFieldId,
    textFieldId,
    workOrderId,
    liveContactId,
    archivedContactId,
    tagId: tag!.id,
  }
}

let f: Fixture

async function relationValue(
  entityId: string,
  relatedEntityId: string,
  sortKey: string,
  relatedDefId?: string
): Promise<string> {
  const [row] = await db()
    .insert(schema.FieldValue)
    .values({
      organizationId: f.orgId,
      entityId,
      entityDefinitionId: f.workOrderDefId,
      fieldId: f.relationFieldId,
      relatedEntityId,
      relatedEntityDefinitionId: relatedDefId ?? f.contactDefId,
      sortKey,
      updatedAt: new Date(),
    })
    .returning()
  return row!.id
}

async function exists(fieldValueId: string): Promise<boolean> {
  const rows = await db()
    .select({ id: schema.FieldValue.id })
    .from(schema.FieldValue)
    .where(eq(schema.FieldValue.id, fieldValueId))
  return rows.length > 0
}

beforeEach(async () => {
  f = await seed()
})

describe('migration 105 — prune dangling relation values', () => {
  it('deletes the mirror row pointing at a record that no longer exists', async () => {
    const dangling = await relationValue(f.workOrderId, GHOST_CONTACT, 'a')

    await migration105PruneDanglingRelationValues.run(db())

    expect(await exists(dangling)).toBe(false)
  })

  it('keeps a reference to a target in a NON-EntityInstance table', async () => {
    // The single most damaging mistake available here: resolving only against
    // `EntityInstance` would read this healthy row as dangling.
    const healthy = await relationValue(f.workOrderId, f.tagId, 'a', 'tag')

    await migration105PruneDanglingRelationValues.run(db())

    expect(await exists(healthy)).toBe(true)
  })

  it('keeps a reference whose target is merely ARCHIVED', async () => {
    const archivedRef = await relationValue(f.workOrderId, f.archivedContactId, 'a')

    await migration105PruneDanglingRelationValues.run(db())

    expect(await exists(archivedRef)).toBe(true)
  })

  it('keeps an ordinary live relation', async () => {
    const live = await relationValue(f.workOrderId, f.liveContactId, 'a')

    await migration105PruneDanglingRelationValues.run(db())

    expect(await exists(live)).toBe(true)
  })

  it('deletes a value whose OWNING record is gone, whatever its type', async () => {
    const [orphan] = await db()
      .insert(schema.FieldValue)
      .values({
        organizationId: f.orgId,
        entityId: GHOST_OWNER,
        entityDefinitionId: f.workOrderDefId,
        fieldId: f.textFieldId,
        valueText: 'stranded',
        updatedAt: new Date(),
      })
      .returning()

    await migration105PruneDanglingRelationValues.run(db())

    expect(await exists(orphan!.id)).toBe(false)
  })

  it('keeps a plain value on a live record', async () => {
    const [kept] = await db()
      .insert(schema.FieldValue)
      .values({
        organizationId: f.orgId,
        entityId: f.workOrderId,
        entityDefinitionId: f.workOrderDefId,
        fieldId: f.textFieldId,
        valueText: 'still here',
        updatedAt: new Date(),
      })
      .returning()

    await migration105PruneDanglingRelationValues.run(db())

    expect(await exists(kept!.id)).toBe(true)
  })

  it('is idempotent — a second pass finds nothing left to delete', async () => {
    const dangling = await relationValue(f.workOrderId, GHOST_CONTACT, 'a')
    const live = await relationValue(f.workOrderId, f.liveContactId, 'b')

    await migration105PruneDanglingRelationValues.run(db())
    await migration105PruneDanglingRelationValues.run(db())

    expect(await exists(dangling)).toBe(false)
    expect(await exists(live)).toBe(true)
  })
})
