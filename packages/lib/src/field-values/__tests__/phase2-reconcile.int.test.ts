// packages/lib/src/field-values/__tests__/phase2-reconcile.int.test.ts
//
// DB-backed behavior of the Phase-2 reconciles (plans/field-values/
// delete-insert-replace.md §6 Phase 2): the `setValue` multi-value arm
// (`setMultiValue`) and the single-value inverse-sync branch of
// `batchAddToInverse` now reconcile stored rows in place instead of
// DELETE-all+INSERT-all — an unchanged row survives byte-identical (same id,
// same sortKey, same updatedAt), a changed row is re-pointed by id, and only
// count changes insert or delete rows. Mock recipe copied from
// set-reconcile.int.test.ts next door.

import { type Database, schema } from '@auxx/database'
import { createTestOrganization, getTestDb } from '@auxx/test-utils'
import type { RecordId } from '@auxx/types/resource'
import { and, asc, eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFieldValueContext, type FieldValueContext } from '../field-value-helpers'
import { setValue } from '../field-value-mutations'
import { type InverseFieldInfo, syncInverseRelationships } from '../relationship-sync'

const db = () => getTestDb() as never as Database

// ── Mocks: Redis-backed cache + the cross-module externals ─────────────────────

vi.mock('../../realtime/publish-helpers', () => ({
  publishFieldValueUpdates: vi.fn(async () => {}),
}))

vi.mock('../../field-hooks/registry', () => ({
  hasEntityFieldChangeHooks: vi.fn(() => false),
  hasFieldTypeChangeHooks: vi.fn(() => false),
  hasFieldPreHooks: vi.fn(() => false),
  getEntityFieldChangeHooks: vi.fn(() => []),
  getFieldTypeChangeHooks: vi.fn(() => []),
  getFieldPreHooks: vi.fn(() => []),
}))

vi.mock('../../field-hooks/collect-triggers', () => ({
  collectTriggeredFields: vi.fn(async () => []),
  deduplicateBySystemAttribute: vi.fn((fields: unknown[]) => fields),
}))

vi.mock('../../cache', () => {
  const tdb = () => getTestDb() as never as Database
  const { eq: eqOp, and: andOp } = require('drizzle-orm')

  const fieldsForOrg = async (orgId: string) =>
    await tdb()
      .select()
      .from(schema.CustomField)
      .where(eqOp(schema.CustomField.organizationId, orgId))

  const resourceFor = async (orgId: string, defId: string) => {
    const [def] = await tdb()
      .select()
      .from(schema.EntityDefinition)
      .where(
        andOp(
          eqOp(schema.EntityDefinition.id, defId),
          eqOp(schema.EntityDefinition.organizationId, orgId)
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
      from: (orgId: string) => ({
        all: async () => {
          const grouped: Record<string, unknown[]> = {}
          for (const f of await fieldsForOrg(orgId)) {
            const key = f.entityDefinitionId ?? '_'
            grouped[key] = grouped[key] ?? []
            grouped[key]!.push(f)
          }
          return grouped
        },
        byId: async (fieldId: string) =>
          (await fieldsForOrg(orgId)).find((f) => f.id === fieldId) ?? null,
        bySystemAttribute: async (attr: string) =>
          (await fieldsForOrg(orgId)).find((f) => f.systemAttribute === attr) ?? null,
      }),
    }),
    getCachedResource: resourceFor,
    findCachedResource: resourceFor,
    getCachedResources: async () => [],
    getCachedFieldMap: async (orgId: string) =>
      new Map((await fieldsForOrg(orgId)).map((f) => [f.id, f])),
    getCachedEntityDefId: async (_orgId: string, slugOrId: string) => slugOrId,
    requireCachedEntityDefId: async (_orgId: string, slugOrId: string) => slugOrId,
    getAllCachedCustomFields: fieldsForOrg,
    getCachedRecordRules: async () => [],
    getCachedResourceFields: async () => [],
    getCachedUserInstanceGrants: async () => [],
    getCachedMembersByUserIds: async () => [],
    getCachedAgentsByUserIds: async () => [],
  }
})

// ── Fixture ────────────────────────────────────────────────────────────────────

interface Fixture {
  orgId: string
  defId: string
  labelsFieldId: string
  instanceId: string
  ctx: FieldValueContext
}

async function seed(): Promise<Fixture> {
  const org = await createTestOrganization()

  const [def] = await db()
    .insert(schema.EntityDefinition)
    .values({
      organizationId: org.id,
      entityType: 'contact',
      apiSlug: 'contacts',
      singular: 'contact',
      plural: 'contacts',
      updatedAt: new Date(),
    })
    .returning()

  const [field] = await db()
    .insert(schema.CustomField)
    .values({
      organizationId: org.id,
      entityDefinitionId: def!.id,
      modelType: 'contact',
      name: 'Labels',
      type: 'TEXT',
      options: { multi: true },
      sortOrder: 'a1',
      isCustom: true,
      updatedAt: new Date(),
    })
    .returning()

  const [inst] = await db()
    .insert(schema.EntityInstance)
    .values({
      organizationId: org.id,
      entityDefinitionId: def!.id,
      displayName: 'Ada',
      updatedAt: new Date(Date.now() - 60 * 60 * 1000),
    })
    .returning()

  return {
    orgId: org.id,
    defId: def!.id,
    labelsFieldId: field!.id,
    instanceId: inst!.id,
    ctx: createFieldValueContext(org.id, undefined, db()),
  }
}

const recordIdOf = (f: Fixture) => `${f.defId}:${f.instanceId}` as RecordId

async function storedRows(f: Fixture, fieldId: string, entityId?: string) {
  return await db()
    .select()
    .from(schema.FieldValue)
    .where(
      and(
        eq(schema.FieldValue.organizationId, f.orgId),
        eq(schema.FieldValue.entityId, entityId ?? f.instanceId),
        eq(schema.FieldValue.fieldId, fieldId)
      )
    )
    .orderBy(asc(schema.FieldValue.sortKey))
}

const setLabels = (f: Fixture, vals: string[]) =>
  setValue(f.ctx, {
    recordId: recordIdOf(f),
    fieldId: f.labelsFieldId,
    value: vals,
  })

let f: Fixture
beforeEach(async () => {
  vi.clearAllMocks()
  f = await seed()
})

// ═══════════════════════════════════════════════════════════════════════════════
// setValue multi-value arm (setMultiValue) reconciles in place
// ═══════════════════════════════════════════════════════════════════════════════

describe('setValue multi arm', () => {
  it('an edit keeps untouched row ids and stamps', async () => {
    await setLabels(f, ['alpha', 'beta', 'gamma'])
    const before = await storedRows(f, f.labelsFieldId)
    expect(before).toHaveLength(3)

    await setLabels(f, ['alpha', 'CHANGED', 'gamma'])

    const after = await storedRows(f, f.labelsFieldId)
    expect(after.map((r) => r.valueText)).toEqual(['alpha', 'CHANGED', 'gamma'])
    // Same rows, same positions — only position 1 was UPDATEd.
    expect(after.map((r) => r.id)).toEqual(before.map((r) => r.id))
    expect(after[0]!.updatedAt.getTime()).toBe(before[0]!.updatedAt.getTime())
    expect(after[2]!.updatedAt.getTime()).toBe(before[2]!.updatedAt.getTime())
    expect(after[1]!.updatedAt.getTime()).toBeGreaterThan(before[1]!.updatedAt.getTime())
  })

  it('a shrink deletes only the tail and keeps the surviving prefix byte-identical', async () => {
    await setLabels(f, ['alpha', 'beta', 'gamma'])
    const before = await storedRows(f, f.labelsFieldId)

    await setLabels(f, ['alpha', 'beta'])

    const after = await storedRows(f, f.labelsFieldId)
    expect(after.map((r) => r.id)).toEqual(before.slice(0, 2).map((r) => r.id))
    expect(after.map((r) => r.updatedAt.getTime())).toEqual(
      before.slice(0, 2).map((r) => r.updatedAt.getTime())
    )
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// Single-value inverse sync reconciles in place
// ═══════════════════════════════════════════════════════════════════════════════

describe('single-value inverse sync', () => {
  /** Seed a belongs_to inverse field on the target def plus two source instances. */
  async function seedInverse() {
    const [sourceDef] = await db()
      .insert(schema.EntityDefinition)
      .values({
        organizationId: f.orgId,
        entityType: 'company',
        apiSlug: 'companies',
        singular: 'company',
        plural: 'companies',
        updatedAt: new Date(),
      })
      .returning()

    const [inverseField] = await db()
      .insert(schema.CustomField)
      .values({
        organizationId: f.orgId,
        entityDefinitionId: f.defId,
        modelType: 'contact',
        name: 'Company',
        type: 'RELATIONSHIP',
        options: { relationshipType: 'belongs_to' },
        sortOrder: 'a2',
        isCustom: true,
        updatedAt: new Date(),
      })
      .returning()

    const sources = await db()
      .insert(schema.EntityInstance)
      .values(
        ['S1', 'S2'].map((name) => ({
          organizationId: f.orgId,
          entityDefinitionId: sourceDef!.id,
          displayName: name,
          updatedAt: new Date(),
        }))
      )
      .returning()

    const inverseInfo: InverseFieldInfo = {
      inverseFieldId: inverseField!.id,
      inverseRelationshipType: 'belongs_to',
      sourceEntityDefinitionId: sourceDef!.id,
      targetEntityDefinitionId: f.defId,
      // No forward field is exercised by these cases (no cascade candidates),
      // but the id must be real enough for the cascade DELETE's where clause.
      sourceFieldId: inverseField!.id,
    }

    return { inverseInfo, s1: sources[0]!.id, s2: sources[1]!.id }
  }

  it('re-asserting the same owner leaves the inverse row byte-identical', async () => {
    const { inverseInfo, s1 } = await seedInverse()

    await syncInverseRelationships(
      { db: db(), organizationId: f.orgId },
      { entityId: s1, oldRelatedIds: [], newRelatedIds: [f.instanceId], inverseInfo }
    )
    const [before] = await storedRows(f, inverseInfo.inverseFieldId)
    expect(before).toBeDefined()
    expect(before!.relatedEntityId).toBe(s1)

    await syncInverseRelationships(
      { db: db(), organizationId: f.orgId },
      { entityId: s1, oldRelatedIds: [], newRelatedIds: [f.instanceId], inverseInfo }
    )

    const [after] = await storedRows(f, inverseInfo.inverseFieldId)
    expect(after!.id).toBe(before!.id)
    expect(after!.updatedAt.getTime()).toBe(before!.updatedAt.getTime())
    expect(after!.sortKey).toBe(before!.sortKey)
  })

  it('re-pointing to a new owner updates the same row in place', async () => {
    const { inverseInfo, s1, s2 } = await seedInverse()

    await syncInverseRelationships(
      { db: db(), organizationId: f.orgId },
      { entityId: s1, oldRelatedIds: [], newRelatedIds: [f.instanceId], inverseInfo }
    )
    const [before] = await storedRows(f, inverseInfo.inverseFieldId)

    await syncInverseRelationships(
      { db: db(), organizationId: f.orgId },
      { entityId: s2, oldRelatedIds: [], newRelatedIds: [f.instanceId], inverseInfo }
    )

    const rows = await storedRows(f, inverseInfo.inverseFieldId)
    expect(rows).toHaveLength(1)
    expect(rows[0]!.id).toBe(before!.id)
    expect(rows[0]!.relatedEntityId).toBe(s2)
    expect(rows[0]!.updatedAt.getTime()).toBeGreaterThan(before!.updatedAt.getTime())
  })
})
