// packages/lib/src/field-values/__tests__/bulk-stamp-batching.int.test.ts
//
// DB-backed tests for plans/field-values/query-reduction.md Phase 2 (stamps
// half of Option C): the per-record D-7 watermark stamps in the bulk paths
// collapse into ONE batched UPDATE covering exactly the records that changed.
//
//   1. `setBulkValues` stamps once, covering only the changed record — a
//      record whose write was a D-6 no-op keeps its `updatedAt` untouched.
//   2. `removeValuesBulk` stamps every entity that actually lost rows in one
//      batched call.
//
// `EntityInstance.updatedAt` carries no `$onUpdate` (removed in #1805), so
// only explicit stamps move it — which is what makes the DB assertions here
// airtight. The `../field-value-helpers` mock is a counting passthrough
// (real implementations wrapped in vi.fn); note the single-record
// `stampEntityInstanceUpdatedAt` delegates to the batched helper
// module-internally, so the batched spy counts only the direct batched
// calls the bulk paths make.

import { type Database, schema } from '@auxx/database'
import { createTestOrganization, getTestDb } from '@auxx/test-utils'
import type { RecordId } from '@auxx/types/resource'
import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFieldValueContext } from '../field-value-helpers'
import { removeValuesBulk, setBulkValues, setValuesForEntity } from '../field-value-mutations'
import { flushInstanceDerived, flushInstancesDerived } from '../instance-derived'

const db = () => getTestDb() as never as Database

// ── Mocks ──────────────────────────────────────────────────────────────────────

// The D-7 stamp rides the record's ONE derived-column flush
// (`instance-derived.ts`): a batched stamp is a `flushInstancesDerived` call
// with `stampUpdatedAt`, a per-record one a `flushInstanceDerived` call.
vi.mock('../instance-derived', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../instance-derived')>()
  return {
    ...mod,
    flushInstanceDerived: vi.fn(mod.flushInstanceDerived),
    flushInstancesDerived: vi.fn(mod.flushInstancesDerived),
  }
})

vi.mock('../../realtime/publish-helpers', () => ({
  publishFieldValueUpdates: vi.fn(async () => {}),
}))

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
  options?: unknown
) {
  const [field] = await db()
    .insert(schema.CustomField)
    .values({
      organizationId: orgId,
      entityDefinitionId: defId,
      modelType: 'contact',
      name,
      type: 'TEXT' as never,
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

const recordIdFor = (defId: string, instanceId: string) => `${defId}:${instanceId}` as RecordId

async function instanceUpdatedAt(instanceId: string): Promise<number> {
  const [row] = await db()
    .select({ updatedAt: schema.EntityInstance.updatedAt })
    .from(schema.EntityInstance)
    .where(eq(schema.EntityInstance.id, instanceId))
  return row!.updatedAt!.getTime()
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

const batchedStampCalls = () =>
  vi.mocked(flushInstancesDerived).mock.calls.filter((call) => call[3]?.stampUpdatedAt === true)
const singleStampCalls = () =>
  vi.mocked(flushInstanceDerived).mock.calls.filter((call) => call[3]?.stampUpdatedAt === true)
const clearStampSpies = () => {
  vi.mocked(flushInstancesDerived).mockClear()
  vi.mocked(flushInstanceDerived).mockClear()
}

beforeEach(() => {
  clearStampSpies()
})

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('batched watermark stamps in bulk ops (query-reduction Phase 2)', () => {
  it('setBulkValues stamps once, covering exactly the changed records', async () => {
    const org = await createTestOrganization()
    const def = await seedDef(org.id)
    const city = await seedField(org.id, def.id, 'City', 'a1')
    const ctx = createFieldValueContext(org.id, undefined, db())

    const noop = await seedInstance(org.id, def.id, 'Ada')
    const changed = await seedInstance(org.id, def.id, 'Bob')

    // `noop` already holds the value the bulk will assert — its write is a
    // D-6 no-op and must not be stamped.
    await setValuesForEntity(ctx, {
      recordId: recordIdFor(def.id, noop.id),
      values: [{ fieldId: city.id, value: 'Porto' }],
    })

    const noopBefore = await instanceUpdatedAt(noop.id)
    const changedBefore = await instanceUpdatedAt(changed.id)
    clearStampSpies()
    await sleep(10)

    await setBulkValues(ctx, {
      recordIds: [noop, changed].map((i) => recordIdFor(def.id, i.id)),
      values: [{ fieldId: city.id, value: 'Porto' }],
    })

    // One direct batched call from the bulk path, naming only the changed
    // record; the suppressed per-record stamp never fired.
    expect(batchedStampCalls()).toHaveLength(1)
    expect(batchedStampCalls()[0]![2]).toEqual([changed.id])
    expect(singleStampCalls()).toHaveLength(0)

    expect(await instanceUpdatedAt(noop.id)).toBe(noopBefore)
    expect(await instanceUpdatedAt(changed.id)).toBeGreaterThan(changedBefore)
  })

  it('an all-no-op bulk stamps nothing', async () => {
    const org = await createTestOrganization()
    const def = await seedDef(org.id)
    const city = await seedField(org.id, def.id, 'City', 'a1')
    const ctx = createFieldValueContext(org.id, undefined, db())
    const a = await seedInstance(org.id, def.id, 'Ada')

    const input = {
      recordIds: [recordIdFor(def.id, a.id)],
      values: [{ fieldId: city.id, value: 'Faro' }],
    }
    await setBulkValues(ctx, input)
    const before = await instanceUpdatedAt(a.id)
    clearStampSpies()
    await sleep(10)

    await setBulkValues(ctx, input)

    // The batched helper short-circuits on an empty id list — asserting on
    // the DB row is what proves no statement dirtied the watermark.
    expect(await instanceUpdatedAt(a.id)).toBe(before)
  })

  it('a bulk clear stamps ONLY via the batched op-level UPDATE (no per-record N+1)', async () => {
    const org = await createTestOrganization()
    const def = await seedDef(org.id)
    const city = await seedField(org.id, def.id, 'City', 'a1')
    const ctx = createFieldValueContext(org.id, undefined, db())

    const a = await seedInstance(org.id, def.id, 'Ada')
    const b = await seedInstance(org.id, def.id, 'Bob')
    for (const inst of [a, b]) {
      await setValuesForEntity(ctx, {
        recordId: recordIdFor(def.id, inst.id),
        values: [{ fieldId: city.id, value: 'Porto' }],
      })
    }

    const aBefore = await instanceUpdatedAt(a.id)
    const bBefore = await instanceUpdatedAt(b.id)
    clearStampSpies()
    await sleep(10)

    // Clears route through deleteValue / the reconcile's deletion-only
    // branch, which stamp unconditionally on the direct paths —
    // `skipInstanceStamp` must reach them too, or a bulk clear issues N
    // per-record stamps PLUS the batched one.
    await setBulkValues(ctx, {
      recordIds: [a, b].map((i) => recordIdFor(def.id, i.id)),
      values: [{ fieldId: city.id, value: null }],
    })

    expect(singleStampCalls()).toHaveLength(0)
    expect(batchedStampCalls()).toHaveLength(1)
    expect([...batchedStampCalls()[0]![2]].sort()).toEqual([a.id, b.id].sort())
    expect(await instanceUpdatedAt(a.id)).toBeGreaterThan(aBefore)
    expect(await instanceUpdatedAt(b.id)).toBeGreaterThan(bBefore)
  })

  it('removeValuesBulk stamps every entity that lost rows in one batched call', async () => {
    const org = await createTestOrganization()
    const def = await seedDef(org.id)
    const tags = await seedField(org.id, def.id, 'Tags', 'a1', { multi: true })
    const ctx = createFieldValueContext(org.id, undefined, db())

    const a = await seedInstance(org.id, def.id, 'Ada')
    const b = await seedInstance(org.id, def.id, 'Bob')
    for (const inst of [a, b]) {
      await setValuesForEntity(ctx, {
        recordId: recordIdFor(def.id, inst.id),
        values: [{ fieldId: tags.id, value: ['vip', 'beta'] }],
      })
    }

    const aBefore = await instanceUpdatedAt(a.id)
    const bBefore = await instanceUpdatedAt(b.id)
    clearStampSpies()
    await sleep(10)

    const { removed } = await removeValuesBulk(ctx, {
      recordIds: [a, b].map((i) => recordIdFor(def.id, i.id)),
      fieldId: tags.id,
      values: ['vip'],
    })

    expect(removed).toBe(2)
    expect(batchedStampCalls()).toHaveLength(1)
    expect([...batchedStampCalls()[0]![2]].sort()).toEqual([a.id, b.id].sort())
    expect(singleStampCalls()).toHaveLength(0)
    expect(await instanceUpdatedAt(a.id)).toBeGreaterThan(aBefore)
    expect(await instanceUpdatedAt(b.id)).toBeGreaterThan(bBefore)
  })
})
