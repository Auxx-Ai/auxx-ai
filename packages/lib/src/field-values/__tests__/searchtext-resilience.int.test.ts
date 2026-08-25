// packages/lib/src/field-values/__tests__/searchtext-resilience.int.test.ts
//
// DB-backed tests for the code-review fix on the coalesced searchText flush:
// a write whose rows COMMIT but whose post-commit derived work (inverse
// sync) throws is recorded `state: 'failed'` — the flush must still run, or
// the record is unfindable by its new value until an unrelated future write.
// Bulk: the batched refresh runs BEFORE the inverse-sync loop and each
// field's sync is isolated, so one throwing sync cannot leave every
// committed record's corpus stale.
//
// The fixture wires a REAL inverse field pair (so the write path reaches
// inverse sync on its own), and `../relationship-sync`'s two sync entry
// points are mocked to throw.

import { type Database, schema } from '@auxx/database'
import { createTestOrganization, getTestDb } from '@auxx/test-utils'
import type { RecordId } from '@auxx/types/resource'
import { eq } from 'drizzle-orm'
import { describe, expect, it, vi } from 'vitest'
import { createFieldValueContext } from '../field-value-helpers'
import { setBulkValues, setValuesForEntity } from '../field-value-mutations'
import { syncInverseRelationships, syncInverseRelationshipsBulk } from '../relationship-sync'

const db = () => getTestDb() as never as Database

// ── Mocks ──────────────────────────────────────────────────────────────────────

vi.mock('../relationship-sync', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../relationship-sync')>()
  return {
    ...mod,
    syncInverseRelationships: vi.fn(async () => {
      throw new Error('inverse sync boom')
    }),
    syncInverseRelationshipsBulk: vi.fn(async () => {
      throw new Error('bulk inverse sync boom')
    }),
  }
})

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

async function seed() {
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
  // Real inverse pair: the forward field names its inverse, so the write
  // path reaches inverse sync exactly as production does.
  const [inverse] = await db()
    .insert(schema.CustomField)
    .values({
      organizationId: org.id,
      entityDefinitionId: def!.id,
      modelType: 'contact',
      name: 'Related (inverse)',
      type: 'RELATIONSHIP',
      options: { relationship: { relationshipType: 'has_many' } },
      sortOrder: 'a2',
      isCustom: true,
      updatedAt: new Date(),
    })
    .returning()
  const [rel] = await db()
    .insert(schema.CustomField)
    .values({
      organizationId: org.id,
      entityDefinitionId: def!.id,
      modelType: 'contact',
      name: 'Related',
      type: 'RELATIONSHIP',
      options: {
        relationship: {
          relationshipType: 'belongs_to',
          inverseResourceFieldId: `${def!.id}:${inverse!.id}`,
        },
      },
      sortOrder: 'a1',
      isCustom: true,
      updatedAt: new Date(),
    })
    .returning()

  const instance = async (displayName: string) => {
    const [inst] = await db()
      .insert(schema.EntityInstance)
      .values({
        organizationId: org.id,
        entityDefinitionId: def!.id,
        displayName,
        updatedAt: new Date(),
      })
      .returning()
    return inst!
  }

  return {
    orgId: org.id,
    defId: def!.id,
    relFieldId: rel!.id,
    instance,
    ctx: createFieldValueContext(org.id, undefined, db()),
  }
}

async function searchTextOf(instanceId: string): Promise<string | null> {
  const [row] = await db()
    .select({ searchText: schema.EntityInstance.searchText })
    .from(schema.EntityInstance)
    .where(eq(schema.EntityInstance.id, instanceId))
  return row!.searchText
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('searchText flush survives post-commit derived-work failures', () => {
  it('a record write whose inverse sync throws still refreshes the corpus', async () => {
    const f = await seed()
    const source = await f.instance('Ada')
    const target = await f.instance('Bob')

    const results = await setValuesForEntity(f.ctx, {
      recordId: `${f.defId}:${source.id}` as RecordId,
      values: [
        { fieldId: f.relFieldId, value: [{ recordId: `${f.defId}:${target.id}` as RecordId }] },
      ],
    })

    // The rows committed before the sync threw: the per-field result is
    // 'failed', but the value IS stored and the corpus must contain it.
    expect(syncInverseRelationships).toHaveBeenCalledTimes(1)
    expect(results[0]!.state).toBe('failed')
    const stored = await db()
      .select()
      .from(schema.FieldValue)
      .where(eq(schema.FieldValue.entityId, source.id))
    expect(stored).toHaveLength(1)
    expect(await searchTextOf(source.id)).toContain('Bob')
  })

  it('a bulk write whose bulk inverse sync throws still refreshes every record', async () => {
    const f = await seed()
    const a = await f.instance('Ada')
    const b = await f.instance('Cleo')
    const target = await f.instance('Bob')

    const { count } = await setBulkValues(f.ctx, {
      recordIds: [a, b].map((i) => `${f.defId}:${i.id}` as RecordId),
      values: [
        { fieldId: f.relFieldId, value: [{ recordId: `${f.defId}:${target.id}` as RecordId }] },
      ],
    })

    // The throwing bulk sync is isolated (it runs AFTER the batched flush)
    // and must not reject the op or leave the committed records stale.
    expect(syncInverseRelationshipsBulk).toHaveBeenCalledTimes(1)
    expect(count).toBe(2)
    expect(await searchTextOf(a.id)).toContain('Bob')
    expect(await searchTextOf(b.id)).toContain('Bob')
  })
})
