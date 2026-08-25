// packages/lib/src/field-values/__tests__/guard-preload.int.test.ts
//
// DB-backed tests for plans/field-values/query-reduction.md Phase 1 (Option B):
// the D-6 idempotency guard's per-pair SELECT is replaced by ONE batched
// pre-read per orchestrated write, and the hooks' oldValue is derived from
// the guard rows instead of a second identical SELECT.
//
//   1. A multi-field `setValuesForEntity` performs exactly one
//      `batchLoadExistingSetRows` and zero individual `loadExistingRowsForSet`
//      calls.
//   2. An idempotent bulk re-assert performs one batch pre-read total, zero
//      individual loads, zero writes (rows byte-identical).
//   3. A changed bulk still lands every value, off one batch pre-read.
//   4. A single `setValueWithBuiltIn` without a preload keeps the individual
//      guard load — the fallback path is intact.
//   5. Hooks receive an `oldValue` deep-equal to what `getValue` returns, with
//      NO `getValue` call during the write (scalar TEXT and multi TEXT via the
//      full write path; RELATIONSHIP rows compared at the helper seam, where
//      shaping divergence would hide).
//
// The `../batch-existing-values` and `../field-value-queries` mocks are
// counting passthroughs — real implementations wrapped in vi.fn — so all
// assertions run against genuine reads. Cache/realtime/hook mocks mirror
// search-text-coalescing next door; the field-hooks registry mock is mutable
// so test 5 can register a capturing handler.

import { type Database, schema } from '@auxx/database'
import { createTestOrganization, getTestDb } from '@auxx/test-utils'
import type { RecordId } from '@auxx/types/resource'
import { and, asc, eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { batchLoadExistingSetRows, loadExistingRowsForSet } from '../batch-existing-values'
import { createFieldValueContext, type FieldValueContext } from '../field-value-helpers'
import { setBulkValues, setValuesForEntity, setValueWithBuiltIn } from '../field-value-mutations'
import { getValue, getValueFromStoredRows } from '../field-value-queries'
import type { CachedField, FieldValueRow } from '../types'

const db = () => getTestDb() as never as Database

// ── Mocks ──────────────────────────────────────────────────────────────────────

vi.mock('../batch-existing-values', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../batch-existing-values')>()
  return {
    ...mod,
    batchLoadExistingSetRows: vi.fn(mod.batchLoadExistingSetRows),
    loadExistingRowsForSet: vi.fn(mod.loadExistingRowsForSet),
  }
})

vi.mock('../field-value-queries', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../field-value-queries')>()
  return {
    ...mod,
    getValue: vi.fn(mod.getValue),
  }
})

vi.mock('../../realtime/publish-helpers', () => ({
  publishFieldValueUpdates: vi.fn(async () => {}),
}))

// Mutable registry mock: defaults to "no hooks"; test 5 flips the entity
// probe on and registers a capturing handler.
vi.mock('../../field-hooks/registry', () => ({
  hasEntityFieldChangeHooks: vi.fn(() => false),
  hasFieldTypeChangeHooks: vi.fn(() => false),
  hasFieldPreHooks: vi.fn(() => false),
  getEntityFieldChangeHooks: vi.fn((): unknown[] => []),
  getFieldTypeChangeHooks: vi.fn((): unknown[] => []),
  getFieldPreHooks: vi.fn((): unknown[] => []),
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

async function seedField(
  orgId: string,
  defId: string,
  name: string,
  sortOrder: string,
  type = 'TEXT',
  options?: unknown
) {
  const [field] = await db()
    .insert(schema.CustomField)
    .values({
      organizationId: orgId,
      entityDefinitionId: defId,
      modelType: 'contact',
      name,
      type: type as never,
      ...(options !== undefined ? { options: options as never } : {}),
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
  const city = await seedField(org.id, def.id, 'City', 'a1')
  const status = await seedField(org.id, def.id, 'Status', 'a2')
  return {
    orgId: org.id,
    defId: def.id,
    cityFieldId: city.id,
    statusFieldId: status.id,
    ctx: createFieldValueContext(org.id, undefined, db()),
  }
}

const recordIdFor = (defId: string, instanceId: string) => `${defId}:${instanceId}` as RecordId

async function storedRows(orgId: string, entityId: string, fieldId: string) {
  return await db()
    .select()
    .from(schema.FieldValue)
    .where(
      and(
        eq(schema.FieldValue.entityId, entityId),
        eq(schema.FieldValue.fieldId, fieldId),
        eq(schema.FieldValue.organizationId, orgId)
      )
    )
    .orderBy(asc(schema.FieldValue.sortKey))
}

const batchLoads = () => vi.mocked(batchLoadExistingSetRows).mock.calls.length
const individualLoads = () => vi.mocked(loadExistingRowsForSet).mock.calls.length
const getValueCalls = () => vi.mocked(getValue).mock.calls.length

beforeEach(() => {
  vi.mocked(batchLoadExistingSetRows).mockClear()
  vi.mocked(loadExistingRowsForSet).mockClear()
  vi.mocked(getValue).mockClear()
})

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('batched guard pre-read (query-reduction Phase 1)', () => {
  it('multi-field record write: one batch load, zero individual guard loads', async () => {
    const f = await seed()
    const inst = await seedInstance(f.orgId, f.defId, 'Ada')

    await setValuesForEntity(f.ctx, {
      recordId: recordIdFor(f.defId, inst.id),
      values: [
        { fieldId: f.cityFieldId, value: 'Lisbon' },
        { fieldId: f.statusFieldId, value: 'active' },
      ],
    })

    expect(batchLoads()).toBe(1)
    expect(individualLoads()).toBe(0)
    const city = await storedRows(f.orgId, inst.id, f.cityFieldId)
    expect(city).toHaveLength(1)
    expect(city[0]!.valueText).toBe('Lisbon')
  })

  it('idempotent bulk re-assert: one batch load total, zero writes', async () => {
    const f = await seed()
    const a = await seedInstance(f.orgId, f.defId, 'Ada')
    const b = await seedInstance(f.orgId, f.defId, 'Bob')
    const input = {
      recordIds: [a, b].map((i) => recordIdFor(f.defId, i.id)),
      values: [
        { fieldId: f.cityFieldId, value: 'Porto' },
        { fieldId: f.statusFieldId, value: 'lead' },
      ],
    }

    await setBulkValues(f.ctx, input)
    const before = await storedRows(f.orgId, a.id, f.cityFieldId)
    vi.mocked(batchLoadExistingSetRows).mockClear()
    vi.mocked(loadExistingRowsForSet).mockClear()

    await setBulkValues(f.ctx, input)

    expect(batchLoads()).toBe(1)
    expect(individualLoads()).toBe(0)
    const after = await storedRows(f.orgId, a.id, f.cityFieldId)
    expect(after).toEqual(before) // byte-identical: same id, same updatedAt
  })

  it('changed bulk lands every value off one batch pre-read', async () => {
    const f = await seed()
    const a = await seedInstance(f.orgId, f.defId, 'Ada')
    const b = await seedInstance(f.orgId, f.defId, 'Bob')

    const { count } = await setBulkValues(f.ctx, {
      recordIds: [a, b].map((i) => recordIdFor(f.defId, i.id)),
      values: [{ fieldId: f.cityFieldId, value: 'Braga' }],
    })

    expect(count).toBe(2)
    expect(batchLoads()).toBe(1)
    expect(individualLoads()).toBe(0)
    for (const inst of [a, b]) {
      const rows = await storedRows(f.orgId, inst.id, f.cityFieldId)
      expect(rows[0]!.valueText).toBe('Braga')
    }
  })

  it('single write without preload keeps the individual guard load', async () => {
    const f = await seed()
    const inst = await seedInstance(f.orgId, f.defId, 'Ada')

    await setValueWithBuiltIn(f.ctx, {
      recordId: recordIdFor(f.defId, inst.id),
      fieldId: f.cityFieldId,
      value: 'Faro',
    })

    expect(individualLoads()).toBe(1)
    expect(batchLoads()).toBe(0)
    const rows = await storedRows(f.orgId, inst.id, f.cityFieldId)
    expect(rows[0]!.valueText).toBe('Faro')
  })

  it('hooks get an oldValue deep-equal to getValue, without a getValue call', async () => {
    const registry = await import('../../field-hooks/registry')
    // Keyed by fieldId, not arrival order: the write loop runs in sorted
    // fieldId order (deterministic advisory-lock acquisition), so hook
    // firing order does not track input order.
    const captured = new Map<string, unknown>()
    vi.mocked(registry.hasEntityFieldChangeHooks).mockReturnValue(true)
    vi.mocked(registry.getEntityFieldChangeHooks).mockReturnValue([
      async (event: { field: { id: string }; oldValue: unknown }) => {
        captured.set(event.field.id, event.oldValue)
      },
    ] as never)
    try {
      const org = await createTestOrganization()
      const def = await seedDef(org.id)
      const city = await seedField(org.id, def.id, 'City', 'a1')
      const tags = await seedField(org.id, def.id, 'Tags', 'a2', 'TEXT', { multi: true })
      const ctx = createFieldValueContext(org.id, 'user-1', db())
      const inst = await seedInstance(org.id, def.id, 'Ada')
      const recordId = recordIdFor(def.id, inst.id)

      // Seed pre-write state through the normal path.
      await setValuesForEntity(ctx, {
        recordId,
        values: [
          { fieldId: city.id, value: 'Lisbon' },
          { fieldId: tags.id, value: ['vip', 'beta'] },
        ],
      })
      captured.clear()

      // Snapshot what getValue answers for both fields, then write changes.
      const expectedCity = await getValue(ctx, { recordId, fieldId: city.id })
      const expectedTags = await getValue(ctx, { recordId, fieldId: tags.id })
      const callsBeforeWrite = getValueCalls()

      await setValuesForEntity(ctx, {
        recordId,
        values: [
          { fieldId: city.id, value: 'Porto' },
          { fieldId: tags.id, value: ['vip'] },
        ],
      })

      // Scalar shaping (TEXT → single TypedFieldValue) and array shaping
      // (multi TEXT → TypedFieldValue[]), both derived from guard rows.
      expect(captured.size).toBe(2)
      expect(captured.get(city.id)).toEqual(expectedCity)
      expect(Array.isArray(captured.get(tags.id))).toBe(true)
      expect(captured.get(tags.id)).toEqual(expectedTags)
      // The derivation replaced the oldValue re-read entirely.
      expect(getValueCalls()).toBe(callsBeforeWrite)
    } finally {
      vi.mocked(registry.hasEntityFieldChangeHooks).mockReturnValue(false)
      vi.mocked(registry.getEntityFieldChangeHooks).mockReturnValue([] as never)
    }
  })

  it('multi-value relationship single write batch-validates once, no per-element fallback', async () => {
    // query-reduction Phase 3: setValueWithBuiltIn primes the batch
    // relationship validator for its own ids, so the per-element fallback
    // SELECT inside validateAndConvertValue never fires.
    const f = await seed()
    const rel = await seedField(f.orgId, f.defId, 'Related', 'a4', 'RELATIONSHIP')
    const inst = await seedInstance(f.orgId, f.defId, 'Ada')
    const t1 = await seedInstance(f.orgId, f.defId, 'Bob')
    const t2 = await seedInstance(f.orgId, f.defId, 'Cid')

    const batchSpy = vi.spyOn(f.ctx.validator, 'batchValidateRelationships')
    const fallbackSpy = vi.spyOn(f.ctx.validator, 'validateRelationship')

    await setValueWithBuiltIn(f.ctx, {
      recordId: recordIdFor(f.defId, inst.id),
      fieldId: rel.id,
      value: [{ recordId: recordIdFor(f.defId, t1.id) }, { recordId: recordIdFor(f.defId, t2.id) }],
    })

    expect(batchSpy).toHaveBeenCalledTimes(1)
    expect(fallbackSpy).not.toHaveBeenCalled()
    const rows = await storedRows(f.orgId, inst.id, rel.id)
    expect(rows.map((r) => r.relatedEntityId).sort()).toEqual([t1.id, t2.id].sort())
  })

  it('two entries resolving to the same field in one op: the second write is NOT a stale-preload no-op', async () => {
    const f = await seed()
    // Field addressable two ways: by UUID and by systemAttribute alias —
    // `resolveFieldIds` maps the alias to the same UUID, and the values
    // array legitimately carries both (unified-handler supports the mix).
    const [aliased] = await db()
      .insert(schema.CustomField)
      .values({
        organizationId: f.orgId,
        entityDefinitionId: f.defId,
        modelType: 'contact',
        name: 'Nickname',
        type: 'TEXT',
        systemAttribute: 'test_nickname',
        sortOrder: 'a9',
        isCustom: true,
        updatedAt: new Date(),
      })
      .returning()
    const inst = await seedInstance(f.orgId, f.defId, 'Ada')
    const recordId = recordIdFor(f.defId, inst.id)

    await setValuesForEntity(f.ctx, {
      recordId,
      values: [{ fieldId: aliased!.id, value: 'x' }],
    })

    // Stored 'x'; write [alias→'y', uuid→'x']. The second entry must re-read
    // fresh rows (the pair's preload entry is consumed after the first
    // write) — a stale snapshot would compare 'x' == 'x', skip the write,
    // and leave 'y' persisted instead of last-write-wins 'x'.
    await setValuesForEntity(f.ctx, {
      recordId,
      values: [
        { fieldId: 'test_nickname', value: 'y' },
        { fieldId: aliased!.id, value: 'x' },
      ],
    })
    const rows = await storedRows(f.orgId, inst.id, aliased!.id)
    expect(rows.map((r) => r.valueText)).toEqual(['x'])

    // Mirror for clears: on an empty field, [set 'z', clear] must end empty —
    // a stale "covered, no rows" entry would turn the clear into a B-14 no-op.
    const empty = await seedInstance(f.orgId, f.defId, 'Bob')
    await setValuesForEntity(f.ctx, {
      recordId: recordIdFor(f.defId, empty.id),
      values: [
        { fieldId: 'test_nickname', value: 'z' },
        { fieldId: aliased!.id, value: null },
      ],
    })
    expect(await storedRows(f.orgId, empty.id, aliased!.id)).toHaveLength(0)
  })

  it('an orchestrated RELATIONSHIP write batch-validates exactly once', async () => {
    const f = await seed()
    const rel = await seedField(f.orgId, f.defId, 'Related', 'a3', 'RELATIONSHIP')
    const inst = await seedInstance(f.orgId, f.defId, 'Ada')
    const target = await seedInstance(f.orgId, f.defId, 'Bob')

    // The orchestrator primes the whole write up front; the per-field
    // priming inside setValueWithBuiltIn must SKIP ids the cache already
    // answers instead of re-running the validator's SELECT.
    const validate = vi.spyOn(f.ctx.validator, 'batchValidateRelationships')

    await setValuesForEntity(f.ctx, {
      recordId: recordIdFor(f.defId, inst.id),
      values: [{ fieldId: rel.id, value: [{ recordId: recordIdFor(f.defId, target.id) }] }],
    })

    expect(validate).toHaveBeenCalledTimes(1)
    const rows = await storedRows(f.orgId, inst.id, rel.id)
    expect(rows.map((r) => r.relatedEntityId)).toEqual([target.id])
  })

  it('RELATIONSHIP rows shape identically through getValue and the derivation', async () => {
    const f = await seed()
    const rel = await seedField(f.orgId, f.defId, 'Related', 'a3', 'RELATIONSHIP')
    const inst = await seedInstance(f.orgId, f.defId, 'Ada')
    const target = await seedInstance(f.orgId, f.defId, 'Bob')
    const recordId = recordIdFor(f.defId, inst.id)

    // Seed relationship rows directly — the read seam is what is under test.
    await db().insert(schema.FieldValue).values({
      organizationId: f.orgId,
      entityId: inst.id,
      entityDefinitionId: f.defId,
      fieldId: rel.id,
      sortKey: 'a0',
      relatedEntityId: target.id,
      relatedEntityDefinitionId: f.defId,
      updatedAt: new Date(),
    })

    const viaGetValue = await getValue(f.ctx, { recordId, fieldId: rel.id })
    const rows = (await storedRows(f.orgId, inst.id, rel.id)) as unknown as FieldValueRow[]
    const viaDerivation = await getValueFromStoredRows(
      f.ctx,
      recordId,
      rel.id,
      rel as unknown as CachedField,
      rows
    )

    expect(viaDerivation).toEqual(viaGetValue)
    expect(Array.isArray(viaDerivation)).toBe(true)
  })
})
