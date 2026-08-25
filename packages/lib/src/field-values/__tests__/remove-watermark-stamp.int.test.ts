// packages/lib/src/field-values/__tests__/remove-watermark-stamp.int.test.ts
//
// DB-backed tests for the dedup-watermark stamp on TARGETED removes
// (delete-insert-replace plan §4 "Pre-existing bug, file separately"): a
// targeted remove deletes FieldValue rows without touching any
// FieldValue.updatedAt, so the record's dedup watermark
// GREATEST(ei.updatedAt, max(fv.updatedAt)) never moved — and max(fv) can
// even DECREASE when the newest row is the one removed. The remove paths now
// stamp EntityInstance.updatedAt after a real deletion; a remove that
// matches nothing must NOT stamp (no-ops don't dirty the watermark).
//
// The org cache barrel is mocked wholesale (deterministic, no Redis) — same
// DB-backed mock as email-uniqueness-doors.int.test.ts.

import { type Database, schema } from '@auxx/database'
import { createTestOrganization, getTestDb } from '@auxx/test-utils'
import type { RecordId } from '@auxx/types/resource'
import { and, eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFieldValueContext, type FieldValueContext } from '../field-value-helpers'
import { deleteValue, removeValue, removeValues } from '../field-value-mutations'

const db = () => getTestDb() as unknown as Database

vi.mock('../../cache', () => {
  const tdb = () => getTestDb() as never as Database

  const fieldsForOrg = async (orgId: string) => {
    return await tdb()
      .select()
      .from(schema.CustomField)
      .where(eq(schema.CustomField.organizationId, orgId))
  }

  const resourceFor = async (orgId: string, defId: string) => {
    const [def] = await tdb()
      .select()
      .from(schema.EntityDefinition)
      .where(
        and(
          eq(schema.EntityDefinition.id, defId),
          eq(schema.EntityDefinition.organizationId, orgId)
        )
      )
    if (!def) return null
    return {
      id: def.id,
      entityDefinitionId: def.id,
      apiSlug: def.apiSlug,
      entityType: def.entityType,
      display: { primaryDisplayField: null, secondaryDisplayField: null, avatarField: null },
    }
  }

  return {
    getOrgCache: () => ({
      from: (orgId: string, _key: string) => ({
        all: async () => {
          const fields = await fieldsForOrg(orgId)
          const grouped: Record<string, unknown[]> = {}
          for (const f of fields) {
            const defId = f.entityDefinitionId ?? '_'
            grouped[defId] = grouped[defId] ?? []
            grouped[defId]!.push(f)
          }
          return grouped
        },
        byId: async (fieldId: string) => {
          const fields = await fieldsForOrg(orgId)
          return fields.find((f) => f.id === fieldId) ?? null
        },
        bySystemAttribute: async (attr: string) => {
          const fields = await fieldsForOrg(orgId)
          return fields.find((f) => f.systemAttribute === attr) ?? null
        },
      }),
    }),
    getCachedResource: async (orgId: string, defId: string) => resourceFor(orgId, defId),
    findCachedResource: async (orgId: string, defId: string) => resourceFor(orgId, defId),
    getCachedResources: async () => [],
    getCachedFieldMap: async (orgId: string, _defId: string) => {
      const fields = await fieldsForOrg(orgId)
      return new Map(fields.map((f) => [f.id, f]))
    },
    getCachedEntityDefId: async (_orgId: string, slugOrId: string) => slugOrId,
    requireCachedEntityDefId: async (_orgId: string, slugOrId: string) => slugOrId,
    getAllCachedCustomFields: async (orgId: string) => fieldsForOrg(orgId),
    getCachedResourceFields: async () => [],
    getCachedUserInstanceGrants: async () => [],
    getCachedMembersByUserIds: async () => [],
    getCachedAgentsByUserIds: async () => [],
  }
})

// ── Fixtures ────────────────────────────────────────────────────────────────

const STALE = new Date('2020-01-01T00:00:00Z')

interface Fixture {
  orgId: string
  defId: string
  tagFieldId: string
  ctx: FieldValueContext
}

async function seedOrg(): Promise<Fixture> {
  const org = await createTestOrganization()
  const orgId = org.id

  const [def] = await db()
    .insert(schema.EntityDefinition)
    .values({
      organizationId: orgId,
      entityType: 'contact',
      apiSlug: 'contacts',
      singular: 'contact',
      plural: 'contacts',
      updatedAt: new Date(),
    })
    .returning()

  const [tagField] = await db()
    .insert(schema.CustomField)
    .values({
      organizationId: orgId,
      entityDefinitionId: def!.id,
      modelType: 'contact',
      name: 'Emails',
      type: 'EMAIL',
      sortOrder: 'a2',
      options: { multi: true },
      isCustom: true,
      updatedAt: new Date(),
    })
    .returning()

  const ctx = createFieldValueContext(orgId, undefined, db())
  return { orgId, defId: def!.id, tagFieldId: tagField!.id, ctx }
}

/** Seed an instance with a STALE updatedAt so a stamp is observable. */
async function seedInstance(f: Fixture, values: string[]): Promise<{ id: string }> {
  const [inst] = await db()
    .insert(schema.EntityInstance)
    .values({
      organizationId: f.orgId,
      entityDefinitionId: f.defId,
      displayName: 'Stampee',
      updatedAt: STALE,
    })
    .returning()

  let sortKey = 'a0'
  for (const v of values) {
    await db().insert(schema.FieldValue).values({
      organizationId: f.orgId,
      entityId: inst!.id,
      entityDefinitionId: f.defId,
      fieldId: f.tagFieldId,
      valueText: v,
      sortKey,
    })
    sortKey = `${sortKey}V`
  }
  return { id: inst!.id }
}

const recordIdOf = (f: Fixture, instId: string) => `${f.defId}:${instId}` as RecordId

async function instanceUpdatedAt(f: Fixture, instId: string): Promise<Date> {
  const [row] = await db()
    .select({ updatedAt: schema.EntityInstance.updatedAt })
    .from(schema.EntityInstance)
    .where(eq(schema.EntityInstance.id, instId))
  return row!.updatedAt
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe('targeted removes stamp the dedup watermark', () => {
  let f: Fixture

  beforeEach(async () => {
    f = await seedOrg()
  })

  it('removeValues that deletes rows bumps EntityInstance.updatedAt', async () => {
    const inst = await seedInstance(f, ['a@x.io', 'b@x.io'])

    await removeValues(f.ctx, {
      recordId: recordIdOf(f, inst.id),
      fieldId: f.tagFieldId,
      values: ['a@x.io'],
    })

    expect((await instanceUpdatedAt(f, inst.id)).getTime()).toBeGreaterThan(STALE.getTime())
  })

  it('removeValues matching nothing leaves the watermark untouched', async () => {
    const inst = await seedInstance(f, ['a@x.io'])

    await removeValues(f.ctx, {
      recordId: recordIdOf(f, inst.id),
      fieldId: f.tagFieldId,
      values: ['absent@x.io'],
    })

    expect((await instanceUpdatedAt(f, inst.id)).getTime()).toBe(STALE.getTime())
  })

  it('removeValue (by row id) bumps the watermark', async () => {
    const inst = await seedInstance(f, ['a@x.io'])
    const [row] = await db()
      .select({ id: schema.FieldValue.id })
      .from(schema.FieldValue)
      .where(eq(schema.FieldValue.entityId, inst.id))

    await removeValue(f.ctx, row!.id)

    expect((await instanceUpdatedAt(f, inst.id)).getTime()).toBeGreaterThan(STALE.getTime())
  })

  it('deleteValue bumps only when rows existed', async () => {
    const withRows = await seedInstance(f, ['a@x.io'])
    const empty = await seedInstance(f, [])

    await deleteValue(f.ctx, { recordId: recordIdOf(f, withRows.id), fieldId: f.tagFieldId })
    await deleteValue(f.ctx, { recordId: recordIdOf(f, empty.id), fieldId: f.tagFieldId })

    expect((await instanceUpdatedAt(f, withRows.id)).getTime()).toBeGreaterThan(STALE.getTime())
    expect((await instanceUpdatedAt(f, empty.id)).getTime()).toBe(STALE.getTime())
  })
})
