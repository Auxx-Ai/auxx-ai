// packages/lib/src/field-values/__tests__/set-atomicity.int.test.ts
//
// DB-backed tests for plans/field-values/delete-insert-replace.md Phase 0: the
// set-shaped replace (DELETE all rows for (entityId, fieldId), INSERT the new
// set) runs inside one transaction holding the per-(entity, field) advisory
// lock.
//
//   1. A failure between the DELETE and the INSERT must roll back the DELETE —
//      the stored values survive. Before Phase 0 this window LOST the field's
//      values entirely.
//   2. Two concurrent set-writers with different value counts must produce
//      exactly one writer's complete list, never a merged mix (the plan's
//      §3(b) corruption: deterministic sortKeys + onConflictDoUpdate let the
//      longer writer's tail survive under the shorter writer's rows).
//   3. An ambient transaction (merge-service passes one) nests as a SAVEPOINT:
//      the inner write commits and rolls back with the outer transaction.
//
// Mock setup mirrors write-idempotency-stamps.int.test.ts next door: the org
// cache is backed by the test DB; realtime and the hook registry are external
// to the claim and mocked off.

import { type Database, schema } from '@auxx/database'
import { createTestOrganization, getTestDb } from '@auxx/test-utils'
import type { RecordId } from '@auxx/types/resource'
import { and, asc, eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFieldValueContext, type FieldValueContext } from '../field-value-helpers'
import { setValueWithBuiltIn, setValueWithType } from '../field-value-mutations'

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
  tagsFieldId: string
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
      updatedAt: new Date(),
    })
    .returning()

  return {
    orgId: org.id,
    defId: def!.id,
    tagsFieldId: field!.id,
    instanceId: inst!.id,
    ctx: createFieldValueContext(org.id, undefined, db()),
  }
}

const recordIdOf = (f: Fixture) => `${f.defId}:${f.instanceId}` as RecordId

async function valueTexts(f: Fixture): Promise<string[]> {
  const rows = await db()
    .select()
    .from(schema.FieldValue)
    .where(
      and(
        eq(schema.FieldValue.organizationId, f.orgId),
        eq(schema.FieldValue.entityId, f.instanceId),
        eq(schema.FieldValue.fieldId, f.tagsFieldId)
      )
    )
    .orderBy(asc(schema.FieldValue.sortKey))
  return rows.map((r) => r.valueText!)
}

const textValues = (vals: string[]) => vals.map((v) => ({ type: 'text' as const, value: v }))

const setTags = (ctx: FieldValueContext, f: Fixture, vals: string[]) =>
  setValueWithType(ctx, {
    recordId: recordIdOf(f),
    fieldId: f.tagsFieldId,
    fieldType: 'TEXT',
    value: textValues(vals),
  })

/**
 * A ctx whose transactions run for real but whose tx handle refuses the named
 * method — deterministically simulating a crash at that point INSIDE the
 * transaction. Everything up to the failure executes real SQL on the real tx.
 */
function failingCtx(f: Fixture, failOn: 'insert'): FieldValueContext {
  const real = db()
  const failingDb = new Proxy(real, {
    get(target, prop, receiver) {
      if (prop === 'transaction') {
        return (fn: (tx: unknown) => unknown) =>
          target.transaction(async (tx) => {
            const failingTx = new Proxy(tx as object, {
              get(t, p) {
                if (p === failOn) {
                  throw new Error(`simulated crash before ${String(p)}`)
                }
                const v = Reflect.get(t, p)
                return typeof v === 'function' ? (v as (...a: unknown[]) => unknown).bind(t) : v
              },
            })
            return await fn(failingTx)
          })
      }
      const v = Reflect.get(target, prop, receiver)
      return typeof v === 'function' ? (v as (...a: unknown[]) => unknown).bind(target) : v
    },
  })
  return createFieldValueContext(f.orgId, undefined, failingDb as never as Database)
}

let f: Fixture
beforeEach(async () => {
  vi.clearAllMocks()
  f = await seed()
})

// ═══════════════════════════════════════════════════════════════════════════════
// 1. Failure between DELETE and INSERT rolls back — no destroy window
// ═══════════════════════════════════════════════════════════════════════════════

describe('atomic replace', () => {
  it('a failure after the DELETE leaves the stored values intact', async () => {
    await setTags(f.ctx, f, ['red', 'green'])
    expect(await valueTexts(f)).toEqual(['red', 'green'])

    await expect(setTags(failingCtx(f, 'insert'), f, ['blue', 'yellow'])).rejects.toThrow(
      'simulated crash'
    )

    // Pre-Phase-0 this read returned [] — the DELETE had already committed.
    expect(await valueTexts(f)).toEqual(['red', 'green'])
  })

  it('two concurrent writers with different value counts: one complete list wins', async () => {
    // §3(b): deterministic sortKeys mean interleaved writers merge into a
    // mixed list (the 3-writer's tail row survives under the 2-writer's
    // rows). The advisory lock serializes them; run several rounds since a
    // race is probabilistic by nature.
    for (let round = 0; round < 5; round++) {
      const a = ['a1', 'a2', 'a3'].map((v) => `${v}-r${round}`)
      const b = ['b1', 'b2'].map((v) => `${v}-r${round}`)

      const ctxA = createFieldValueContext(f.orgId, undefined, db())
      const ctxB = createFieldValueContext(f.orgId, undefined, db())
      await Promise.all([setTags(ctxA, f, a), setTags(ctxB, f, b)])

      const stored = await valueTexts(f)
      const isA = JSON.stringify(stored) === JSON.stringify(a)
      const isB = JSON.stringify(stored) === JSON.stringify(b)
      expect(isA || isB, `round ${round}: got a mixed list ${JSON.stringify(stored)}`).toBe(true)
    }
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// 2. Ambient transaction nests as a savepoint (merge-service is the live path)
// ═══════════════════════════════════════════════════════════════════════════════

describe('ambient transaction nesting', () => {
  it('a set-write inside an open transaction commits with it', async () => {
    await db().transaction(async (outer) => {
      const txCtx = createFieldValueContext(f.orgId, undefined, outer as never as Database)
      await setValueWithBuiltIn(txCtx, {
        recordId: recordIdOf(f),
        fieldId: f.tagsFieldId,
        value: ['nested'],
      })
    })

    expect(await valueTexts(f)).toEqual(['nested'])
  })

  it('a set-write inside a transaction that rolls back leaves no rows', async () => {
    await setTags(f.ctx, f, ['before'])

    await expect(
      db().transaction(async (outer) => {
        const txCtx = createFieldValueContext(f.orgId, undefined, outer as never as Database)
        await setValueWithBuiltIn(txCtx, {
          recordId: recordIdOf(f),
          fieldId: f.tagsFieldId,
          value: ['doomed'],
        })
        throw new Error('outer rollback')
      })
    ).rejects.toThrow('outer rollback')

    expect(await valueTexts(f)).toEqual(['before'])
  })
})
