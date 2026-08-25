// packages/lib/src/field-values/__tests__/search-text-coalescing.int.test.ts
//
// DB-backed tests for plans/field-values/query-reduction.md Phase 0 (Option A):
// the searchText recompute is coalesced to ONE per record write
// (`setValuesForEntity`) and ONE batched statement per bulk op
// (`setBulkValues`), instead of one full-corpus recompute per indexed field.
//
//   1. A multi-field record write issues exactly one `updateSearchText` and
//      the stored corpus equals what per-field refreshes produced before.
//   2. An all-no-op record write (D-6 idempotent re-assert) refreshes nothing.
//   3. A bulk write issues zero per-record refreshes and exactly one
//      `updateSearchTextForInstances` covering every changed record.
//   4. A direct `setValueWithType` call keeps today's per-field refresh —
//      the six direct callers in delete-insert-replace.md §4 are unaffected.
//   5. A NAME-source (first/last name) write still updates `displayName`
//      per-field and the record-level flush leaves the corpus correct.
//
// The `../search-text` mock is a counting passthrough — real implementations,
// wrapped in vi.fn — so content assertions run against genuinely recomputed
// corpora. Cache/realtime/hook mocks mirror write-idempotency-stamps next door.

import { type Database, schema } from '@auxx/database'
import { createTestOrganization, getTestDb } from '@auxx/test-utils'
import type { RecordId } from '@auxx/types/resource'
import { and, eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFieldValueContext, type FieldValueContext } from '../field-value-helpers'
import { setBulkValues, setValuesForEntity, setValueWithType } from '../field-value-mutations'
import { updateSearchText, updateSearchTextForInstances } from '../search-text'

const db = () => getTestDb() as never as Database

// ── Mocks ──────────────────────────────────────────────────────────────────────

vi.mock('../search-text', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../search-text')>()
  return {
    ...mod,
    updateSearchText: vi.fn(mod.updateSearchText),
    updateSearchTextForInstances: vi.fn(mod.updateSearchTextForInstances),
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

  // Unlike the sibling harnesses this resource mock surfaces a primary
  // display field: the org's NAME-type CustomField when one is seeded. Tests
  // that seed no NAME field get the null display shape as before.
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
    const nameField = (await fieldsForOrg(orgId)).find(
      (f) => f.type === 'NAME' && f.entityDefinitionId === defId
    )
    return {
      id: def.id,
      entityDefinitionId: def.id,
      apiSlug: def.apiSlug,
      entityType: def.entityType,
      display: {
        primaryDisplayField: nameField ? { id: nameField.id } : null,
        secondaryDisplayField: null,
        avatarField: null,
      },
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
  cityFieldId: string
  statusFieldId: string
  ctx: FieldValueContext
}

async function seedDef(orgId: string) {
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
  return def!
}

async function seedTextField(orgId: string, defId: string, name: string, sortOrder: string) {
  const [field] = await db()
    .insert(schema.CustomField)
    .values({
      organizationId: orgId,
      entityDefinitionId: defId,
      modelType: 'contact',
      name,
      type: 'TEXT',
      sortOrder,
      isCustom: true,
      updatedAt: new Date(),
    })
    .returning()
  return field!
}

async function seedInstance(orgId: string, defId: string, displayName: string) {
  const [inst] = await db()
    .insert(schema.EntityInstance)
    .values({
      organizationId: orgId,
      entityDefinitionId: defId,
      displayName,
      updatedAt: new Date(),
    })
    .returning()
  return inst!
}

async function seed(): Promise<Fixture> {
  const org = await createTestOrganization()
  const def = await seedDef(org.id)
  const city = await seedTextField(org.id, def.id, 'City', 'a1')
  const status = await seedTextField(org.id, def.id, 'Status', 'a2')
  return {
    orgId: org.id,
    defId: def.id,
    cityFieldId: city.id,
    statusFieldId: status.id,
    ctx: createFieldValueContext(org.id, undefined, db()),
  }
}

const recordIdFor = (f: Fixture, instanceId: string) => `${f.defId}:${instanceId}` as RecordId

async function storedSearchText(orgId: string, instanceId: string): Promise<string | null> {
  const [row] = await db()
    .select({ searchText: schema.EntityInstance.searchText })
    .from(schema.EntityInstance)
    .where(
      and(eq(schema.EntityInstance.id, instanceId), eq(schema.EntityInstance.organizationId, orgId))
    )
  return row?.searchText ?? null
}

const refreshCount = () => vi.mocked(updateSearchText).mock.calls.length
const batchRefreshCount = () => vi.mocked(updateSearchTextForInstances).mock.calls.length

beforeEach(() => {
  vi.mocked(updateSearchText).mockClear()
  vi.mocked(updateSearchTextForInstances).mockClear()
})

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('searchText coalescing (query-reduction Phase 0)', () => {
  it('multi-field record write refreshes once, with the full corpus', async () => {
    const f = await seed()
    const inst = await seedInstance(f.orgId, f.defId, 'Ada')

    await setValuesForEntity(f.ctx, {
      recordId: recordIdFor(f, inst.id),
      values: [
        { fieldId: f.cityFieldId, value: 'Lisbon' },
        { fieldId: f.statusFieldId, value: 'active' },
      ],
    })

    expect(refreshCount()).toBe(1)
    expect(batchRefreshCount()).toBe(0)
    const corpus = await storedSearchText(f.orgId, inst.id)
    expect(corpus).toContain('Lisbon')
    expect(corpus).toContain('active')
    expect(corpus).toContain('Ada')
  })

  it('an all-no-op record write refreshes nothing', async () => {
    const f = await seed()
    const inst = await seedInstance(f.orgId, f.defId, 'Ada')
    const recordId = recordIdFor(f, inst.id)
    const values = [
      { fieldId: f.cityFieldId, value: 'Lisbon' },
      { fieldId: f.statusFieldId, value: 'active' },
    ]

    await setValuesForEntity(f.ctx, { recordId, values })
    const before = await storedSearchText(f.orgId, inst.id)
    vi.mocked(updateSearchText).mockClear()

    const results = await setValuesForEntity(f.ctx, { recordId, values })

    expect(results.every((r) => r.changed === false)).toBe(true)
    expect(refreshCount()).toBe(0)
    expect(await storedSearchText(f.orgId, inst.id)).toBe(before)
  })

  it('bulk write refreshes all changed records in one batched statement', async () => {
    const f = await seed()
    const a = await seedInstance(f.orgId, f.defId, 'Ada')
    const b = await seedInstance(f.orgId, f.defId, 'Bob')
    const c = await seedInstance(f.orgId, f.defId, 'Cyd')

    const { count } = await setBulkValues(f.ctx, {
      recordIds: [a, b, c].map((i) => recordIdFor(f, i.id)),
      values: [
        { fieldId: f.cityFieldId, value: 'Porto' },
        { fieldId: f.statusFieldId, value: 'lead' },
      ],
    })

    expect(count).toBe(3)
    expect(refreshCount()).toBe(0)
    expect(batchRefreshCount()).toBe(1)
    const [, , ids] = vi.mocked(updateSearchTextForInstances).mock.calls[0]!
    expect([...ids].sort()).toEqual([a.id, b.id, c.id].sort())
    for (const inst of [a, b, c]) {
      const corpus = await storedSearchText(f.orgId, inst.id)
      expect(corpus).toContain('Porto')
      expect(corpus).toContain('lead')
    }
  })

  it('idempotent bulk re-assert skips the batched refresh entirely', async () => {
    const f = await seed()
    const a = await seedInstance(f.orgId, f.defId, 'Ada')
    const input = {
      recordIds: [recordIdFor(f, a.id)],
      values: [{ fieldId: f.cityFieldId, value: 'Porto' }],
    }

    await setBulkValues(f.ctx, input)
    vi.mocked(updateSearchTextForInstances).mockClear()

    await setBulkValues(f.ctx, input)

    expect(batchRefreshCount()).toBe(0)
  })

  it('direct setValueWithType keeps the per-field refresh', async () => {
    const f = await seed()
    const inst = await seedInstance(f.orgId, f.defId, 'Ada')

    await setValueWithType(f.ctx, {
      recordId: recordIdFor(f, inst.id),
      fieldId: f.cityFieldId,
      fieldType: 'TEXT',
      value: { type: 'text', value: 'Braga' },
    })

    expect(refreshCount()).toBe(1)
    expect(await storedSearchText(f.orgId, inst.id)).toContain('Braga')
  })

  it('NAME-source write updates displayName per-field and the corpus once', async () => {
    const org = await createTestOrganization()
    const def = await seedDef(org.id)
    const first = await seedTextField(org.id, def.id, 'First name', 'a1')
    const last = await seedTextField(org.id, def.id, 'Last name', 'a2')
    await db()
      .insert(schema.CustomField)
      .values({
        organizationId: org.id,
        entityDefinitionId: def.id,
        modelType: 'contact',
        name: 'Name',
        type: 'NAME',
        options: { name: { firstNameFieldId: first.id, lastNameFieldId: last.id } },
        sortOrder: 'a0',
        isCustom: true,
        updatedAt: new Date(),
      })
    const inst = await seedInstance(org.id, def.id, '')
    const ctx = createFieldValueContext(org.id, undefined, db())
    const recordId = `${def.id}:${inst.id}` as RecordId

    await setValuesForEntity(ctx, {
      recordId,
      values: [
        { fieldId: first.id, value: 'Grace' },
        { fieldId: last.id, value: 'Hopper' },
      ],
    })

    expect(refreshCount()).toBe(1)
    const [row] = await db()
      .select({ displayName: schema.EntityInstance.displayName })
      .from(schema.EntityInstance)
      .where(eq(schema.EntityInstance.id, inst.id))
    expect(row?.displayName).toBe('Grace Hopper')
    const corpus = await storedSearchText(org.id, inst.id)
    expect(corpus).toContain('Grace')
    expect(corpus).toContain('Hopper')
  })
})
