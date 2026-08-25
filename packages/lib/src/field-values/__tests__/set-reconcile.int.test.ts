// packages/lib/src/field-values/__tests__/set-reconcile.int.test.ts
//
// DB-backed behavior of the Phase-1 reconcile (plans/field-values/
// delete-insert-replace.md §5B/§6): set-shaped writes keep row identity —
// unchanged positions keep id + updatedAt, changed positions UPDATE in
// place, only count changes INSERT/DELETE, AI markers transition on the
// SAME row, a deletion-only shrink stamps the dedup watermark, and corrupt
// or grown sortKeys route through the full-rewrite fallback that re-mints
// canonical keys (the built-in compactor). The pure diff is unit-tested in
// set-reconcile.test.ts; this file pins what the statements actually do to
// stored rows. Mock recipe copied from set-atomicity.int.test.ts next door.

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
      // In the past, so a watermark stamp is unambiguous.
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

async function storedRows(f: Fixture) {
  return await db()
    .select()
    .from(schema.FieldValue)
    .where(
      and(
        eq(schema.FieldValue.organizationId, f.orgId),
        eq(schema.FieldValue.entityId, f.instanceId),
        eq(schema.FieldValue.fieldId, f.labelsFieldId)
      )
    )
    .orderBy(asc(schema.FieldValue.sortKey))
}

async function instanceUpdatedAt(f: Fixture): Promise<Date> {
  const [row] = await db()
    .select()
    .from(schema.EntityInstance)
    .where(eq(schema.EntityInstance.id, f.instanceId))
  return row!.updatedAt
}

const textValues = (vals: string[]) => vals.map((v) => ({ type: 'text' as const, value: v }))

const setLabels = (f: Fixture, vals: string[]) =>
  setValueWithType(f.ctx, {
    recordId: recordIdOf(f),
    fieldId: f.labelsFieldId,
    fieldType: 'TEXT',
    value: textValues(vals),
  })

let f: Fixture
beforeEach(async () => {
  vi.clearAllMocks()
  f = await seed()
})

// ═══════════════════════════════════════════════════════════════════════════════
// Row identity across changed writes
// ═══════════════════════════════════════════════════════════════════════════════

describe('positional row identity', () => {
  it('a multi-value reorder keeps ids positionally — payloads move, rows stay', async () => {
    await setLabels(f, ['alpha', 'beta', 'gamma'])
    const before = await storedRows(f)
    const idsBefore = before.map((r) => r.id)

    await setLabels(f, ['gamma', 'beta', 'alpha'])

    const after = await storedRows(f)
    expect(after.map((r) => r.valueText)).toEqual(['gamma', 'beta', 'alpha'])
    // Same three rows, same positions (sortKey order) — the positions whose
    // payload changed were UPDATEd in place, the identical middle row was
    // not touched at all.
    expect(after.map((r) => r.id)).toEqual(idsBefore)
    expect(after[1]!.updatedAt.getTime()).toBe(before[1]!.updatedAt.getTime())
    expect(after[0]!.updatedAt.getTime()).toBeGreaterThan(before[0]!.updatedAt.getTime())
  })

  it('a grow keeps the surviving prefix untouched and appends after its keys', async () => {
    await setLabels(f, ['alpha'])
    const [original] = await storedRows(f)

    await setLabels(f, ['alpha', 'beta'])

    const after = await storedRows(f)
    expect(after.map((r) => r.valueText)).toEqual(['alpha', 'beta'])
    expect(after[0]!.id).toBe(original!.id)
    expect(after[0]!.updatedAt.getTime()).toBe(original!.updatedAt.getTime())
    expect(after[1]!.sortKey > after[0]!.sortKey).toBe(true)
  })

  it('a shrink deletes only the tail and stamps the dedup watermark', async () => {
    await setLabels(f, ['alpha', 'beta', 'gamma'])
    const before = await storedRows(f)
    const stampBefore = await instanceUpdatedAt(f)

    await setLabels(f, ['alpha', 'beta'])

    const after = await storedRows(f)
    expect(after.map((r) => r.id)).toEqual([before[0]!.id, before[1]!.id])
    // Surviving rows untouched: nothing bumped max(fv.updatedAt), so the
    // deletion-only diff must stamp EntityInstance.updatedAt itself — the
    // GREATEST watermark leg would otherwise never see this write (§4).
    expect(after[0]!.updatedAt.getTime()).toBe(before[0]!.updatedAt.getTime())
    expect((await instanceUpdatedAt(f)).getTime()).toBeGreaterThan(stampBefore.getTime())
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// AI marker transitions happen on the SAME row
// ═══════════════════════════════════════════════════════════════════════════════

describe('AI marker transitions', () => {
  const setViaBuiltIn = (value: unknown, aiGeneration?: Record<string, unknown>) =>
    setValueWithBuiltIn(f.ctx, {
      recordId: recordIdOf(f),
      fieldId: f.labelsFieldId,
      value,
      ...(aiGeneration ? { aiGeneration: aiGeneration as never } : {}),
    })

  it('an AI stage-2 commit over the identical value gains the marker on the same row', async () => {
    await setViaBuiltIn(['alpha'])
    const [original] = await storedRows(f)
    expect(original!.aiStatus).toBeNull()

    await setViaBuiltIn(['alpha'], { model: 'test-model', generatedAt: '2026-08-25T00:00:00Z' })

    const [after] = await storedRows(f)
    expect(after!.id).toBe(original!.id)
    expect(after!.aiStatus).toBe('result')
    expect((after!.valueJson as { meta?: { ai?: { model?: string } } })?.meta?.ai?.model).toBe(
      'test-model'
    )
  })

  it('a manual write after an AI result clears the marker in place', async () => {
    await setViaBuiltIn(['alpha'], { model: 'test-model', generatedAt: '2026-08-25T00:00:00Z' })
    const [marked] = await storedRows(f)
    expect(marked!.aiStatus).toBe('result')

    // Identical visible value — the guard must still treat this as a REAL
    // write (the marker has to go), and the reconcile clears it on the
    // surviving row rather than re-minting the row.
    await setViaBuiltIn(['alpha'])

    const [after] = await storedRows(f)
    expect(after!.id).toBe(marked!.id)
    expect(after!.aiStatus).toBeNull()
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// Corrupt / grown keys: the full-rewrite fallback is the compactor
// ═══════════════════════════════════════════════════════════════════════════════

describe('connector ownership', () => {
  it('a manual set-write clears managedByConnectorId on the surviving row', async () => {
    await setLabels(f, ['alpha'])
    const [row] = await storedRows(f)

    const [connector] = await db()
      .insert(schema.DataConnector)
      .values({ organizationId: f.orgId, type: 'generic-rest', name: 'Test Connector' })
      .returning()
    await db()
      .update(schema.FieldValue)
      .set({ managedByConnectorId: connector!.id })
      .where(eq(schema.FieldValue.id, row!.id))

    // Identical visible value through the guarded path: ownership must still
    // clear — the old DELETE+INSERT cleared it by omission, and a row left
    // marked lets the connector overwrite the user's edit on next sync.
    await setValueWithBuiltIn(f.ctx, {
      recordId: recordIdOf(f),
      fieldId: f.labelsFieldId,
      value: ['alpha'],
    })

    const [after] = await storedRows(f)
    expect(after!.id).toBe(row!.id)
    expect(after!.managedByConnectorId).toBeNull()
    expect(after!.valueText).toBe('alpha')
  })
})

describe('sortKey fallback', () => {
  it('a corrupt stored sortKey triggers the full rewrite and re-mints canonical keys', async () => {
    await setLabels(f, ['alpha', 'beta'])
    const before = await storedRows(f)

    // Corrupt one key behind the write path's back (trailing '0' is invalid
    // in the fractional-indexing scheme).
    await db()
      .update(schema.FieldValue)
      .set({ sortKey: 'a00' })
      .where(eq(schema.FieldValue.id, before[1]!.id))

    await setLabels(f, ['alpha', 'CHANGED'])

    const after = await storedRows(f)
    expect(after.map((r) => r.valueText)).toEqual(['alpha', 'CHANGED'])
    // Full rewrite: fresh rows, fresh canonical keys — the fallback doubled
    // as the compactor.
    expect(after.map((r) => r.sortKey)).toEqual(['a0', 'a1'])
    expect(after.map((r) => r.id)).not.toContain(before[0]!.id)
  })
})
