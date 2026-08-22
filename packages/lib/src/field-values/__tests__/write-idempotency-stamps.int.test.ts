// packages/lib/src/field-values/__tests__/write-idempotency-stamps.int.test.ts
//
// DB-backed behaviour test (vitest.integration.config.ts → auxx_test) for the two
// coupled decisions at the bottom of plans/events/03-write-context-and-batch-lane-plan.md:
//
//   D-6 — the idempotency guard on the forward `set` path. An identical write must not
//         DELETE+INSERT. "Don't suppress the event, suppress the write."
//   D-7 — `EntityInstance.updatedAt` lost its `$onUpdate` and is stamped EXPLICITLY, once
//         per record write, only when at least one field really changed.
//
// WHY INTEGRATION. The existing `set-idempotency.test.ts` and
// `instance-updated-at-stamp.test.ts` mock the db, so they assert D-6 as "the delete spy
// was not called" and D-7 as "the update spy was called once". Both claims are really
// claims about ROW IDENTITY over time — that the stored FieldValue row is the SAME row
// afterwards, not an identical-looking replacement, and that a no-op write leaves the
// instance's `updatedAt` byte-for-byte alone. A fake db cannot distinguish "row survived"
// from "row deleted and re-inserted with the same values", which is precisely the
// distinction D-6 exists to make: the DELETE+INSERT is what re-dirties the dedup
// watermark and what D-1's `lastActivityAt` bump would otherwise ride on.
//
// The org cache is mocked wholesale against the test DB (same approach as
// `email-uniqueness-doors.int.test.ts` next door); realtime and the hook registry are
// mocked because they are Redis / cross-module externals, not part of the claim.

import { type Database, schema } from '@auxx/database'
import { createTestOrganization, getTestDb } from '@auxx/test-utils'
import type { RecordId } from '@auxx/types/resource'
import { and, eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFieldValueContext, type FieldValueContext } from '../field-value-helpers'
import { setValuesForEntity } from '../field-value-mutations'

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
  nameFieldId: string
  noteFieldId: string
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

  const field = async (name: string, systemAttribute: string, sortOrder: string) => {
    const [f] = await db()
      .insert(schema.CustomField)
      .values({
        organizationId: org.id,
        entityDefinitionId: def!.id,
        modelType: 'contact',
        name,
        type: 'TEXT',
        systemAttribute,
        sortOrder,
        isCustom: false,
        updatedAt: new Date(),
      })
      .returning()
    return f!.id
  }

  const nameFieldId = await field('First Name', 'first_name', 'a1')
  const noteFieldId = await field('Note', 'note', 'a2')

  const [inst] = await db()
    .insert(schema.EntityInstance)
    .values({
      organizationId: org.id,
      entityDefinitionId: def!.id,
      displayName: 'Ada',
      // Deliberately in the past, so any stamp is unambiguous.
      updatedAt: new Date(Date.now() - 60 * 60 * 1000),
    })
    .returning()

  return {
    orgId: org.id,
    defId: def!.id,
    nameFieldId,
    noteFieldId,
    instanceId: inst!.id,
    // No userId → the post-hook / trigger branches stay off; the guard does not.
    ctx: createFieldValueContext(org.id, undefined, db()),
  }
}

const recordIdOf = (f: Fixture) => `${f.defId}:${f.instanceId}` as RecordId

/** The stored FieldValue rows for one field — id and updatedAt are the identity proof. */
async function valueRows(f: Fixture, fieldId: string) {
  return await db()
    .select()
    .from(schema.FieldValue)
    .where(
      and(
        eq(schema.FieldValue.organizationId, f.orgId),
        eq(schema.FieldValue.entityId, f.instanceId),
        eq(schema.FieldValue.fieldId, fieldId)
      )
    )
}

async function instanceUpdatedAt(f: Fixture): Promise<Date> {
  const [row] = await db()
    .select()
    .from(schema.EntityInstance)
    .where(eq(schema.EntityInstance.id, f.instanceId))
  return row!.updatedAt
}

const setName = (f: Fixture, value: unknown) =>
  setValuesForEntity(f.ctx, {
    recordId: recordIdOf(f),
    values: [{ fieldId: f.nameFieldId, value: value as never }],
  })

let f: Fixture
beforeEach(async () => {
  vi.clearAllMocks()
  f = await seed()
})

// ═══════════════════════════════════════════════════════════════════════════════
// D-6 — the guard, proven by row identity rather than by an unfired spy
// ═══════════════════════════════════════════════════════════════════════════════

describe('idempotency guard (D-6)', () => {
  it('re-asserting the same value leaves the SAME FieldValue row in place', async () => {
    const [first] = await setName(f, 'Robert')
    expect(first!.changed).toBe(true)

    const after = await valueRows(f, f.nameFieldId)
    expect(after).toHaveLength(1)
    const original = after[0]!

    const [second] = await setName(f, 'Robert')
    expect(second!.changed).toBe(false)

    const rows = await valueRows(f, f.nameFieldId)
    expect(rows).toHaveLength(1)
    // The row IDENTITY survived — this is what a DELETE+INSERT would destroy and
    // what a fake db cannot tell apart from an identical replacement.
    expect(rows[0]!.id).toBe(original.id)
    expect(rows[0]!.updatedAt.getTime()).toBe(original.updatedAt.getTime())
    expect(rows[0]!.createdAt.getTime()).toBe(original.createdAt.getTime())
  })

  it('a real change DOES rewrite the row', async () => {
    await setName(f, 'Robert')
    const original = (await valueRows(f, f.nameFieldId))[0]!

    const [result] = await setName(f, 'Bob')
    expect(result!.changed).toBe(true)

    const rows = await valueRows(f, f.nameFieldId)
    expect(rows).toHaveLength(1)
    expect(rows[0]!.valueText).toBe('Bob')
    // Either a new row id or a moved updatedAt — the write really landed.
    const rewritten =
      rows[0]!.id !== original.id || rows[0]!.updatedAt.getTime() !== original.updatedAt.getTime()
    expect(rewritten).toBe(true)
  })

  it('clearing an already-absent value is a no-op (B-14 delete-of-absent)', async () => {
    const [result] = await setName(f, null)
    expect(result!.changed).toBe(false)
    expect(await valueRows(f, f.nameFieldId)).toHaveLength(0)
  })

  it('clearing a present value is a real change, and the row goes', async () => {
    await setName(f, 'Robert')
    const [result] = await setName(f, null)
    expect(result!.changed).toBe(true)
    expect(await valueRows(f, f.nameFieldId)).toHaveLength(0)
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// D-7 — one explicit stamp per record write, only on a real change
// ═══════════════════════════════════════════════════════════════════════════════

describe('EntityInstance.updatedAt stamping (D-7)', () => {
  it('stamps on a real change', async () => {
    const before = await instanceUpdatedAt(f)
    await setName(f, 'Robert')
    expect((await instanceUpdatedAt(f)).getTime()).toBeGreaterThan(before.getTime())
  })

  it('does NOT stamp on an idempotent re-assertion — the D-6/D-7 coupling', async () => {
    await setName(f, 'Robert')
    const afterRealWrite = await instanceUpdatedAt(f)

    await setName(f, 'Robert')

    // Unchanged to the millisecond. A bump here would re-dirty the dedup
    // watermark on every re-asserting nightly sync — the exact trap D-7 closes.
    expect((await instanceUpdatedAt(f)).getTime()).toBe(afterRealWrite.getTime())
  })

  it('does NOT stamp on a delete-of-absent', async () => {
    const before = await instanceUpdatedAt(f)
    await setName(f, null)
    expect((await instanceUpdatedAt(f)).getTime()).toBe(before.getTime())
  })

  it('stamps ONCE for a multi-field write, and only because one field changed', async () => {
    // Seed both fields, then re-assert `first_name` while changing `note`.
    await setValuesForEntity(f.ctx, {
      recordId: recordIdOf(f),
      values: [
        { fieldId: f.nameFieldId, value: 'Robert' as never },
        { fieldId: f.noteFieldId, value: 'first' as never },
      ],
    })
    const nameRow = (await valueRows(f, f.nameFieldId))[0]!
    const afterSeed = await instanceUpdatedAt(f)

    const results = await setValuesForEntity(f.ctx, {
      recordId: recordIdOf(f),
      values: [
        { fieldId: f.nameFieldId, value: 'Robert' as never }, // identical — guarded
        { fieldId: f.noteFieldId, value: 'second' as never }, // real change
      ],
    })

    expect(results.map((r) => r.changed)).toEqual([false, true])
    // The guarded field's row is untouched even though its sibling wrote.
    const nameAfter = (await valueRows(f, f.nameFieldId))[0]!
    expect(nameAfter.id).toBe(nameRow.id)
    expect(nameAfter.updatedAt.getTime()).toBe(nameRow.updatedAt.getTime())
    // And the record was stamped, because SOMETHING changed.
    expect((await instanceUpdatedAt(f)).getTime()).toBeGreaterThan(afterSeed.getTime())
  })

  it('does NOT stamp when every field in a multi-field write is a no-op', async () => {
    await setValuesForEntity(f.ctx, {
      recordId: recordIdOf(f),
      values: [
        { fieldId: f.nameFieldId, value: 'Robert' as never },
        { fieldId: f.noteFieldId, value: 'first' as never },
      ],
    })
    const afterSeed = await instanceUpdatedAt(f)

    const results = await setValuesForEntity(f.ctx, {
      recordId: recordIdOf(f),
      values: [
        { fieldId: f.nameFieldId, value: 'Robert' as never },
        { fieldId: f.noteFieldId, value: 'first' as never },
      ],
    })

    expect(results.every((r) => !r.changed)).toBe(true)
    expect((await instanceUpdatedAt(f)).getTime()).toBe(afterSeed.getTime())
  })

  it('never bumps lastActivityAt — that is finalize’s door (D-1), not the write path’s', async () => {
    await setName(f, 'Robert')
    const [row] = await db()
      .select()
      .from(schema.EntityInstance)
      .where(eq(schema.EntityInstance.id, f.instanceId))
    expect(row!.lastActivityAt).toBeNull()
  })
})
