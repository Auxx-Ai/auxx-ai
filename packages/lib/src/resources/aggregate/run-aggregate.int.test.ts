// packages/lib/src/resources/aggregate/run-aggregate.int.test.ts
//
// DB-backed behavior tests for the aggregate engine (vitest.integration.config.ts
// → auxx_test database). Field metadata comes from a mocked org cache, and the
// aggregate result cache is a deterministic in-memory stub (no Redis in tests);
// rows are seeded directly through Drizzle. SQL behavior is asserted through
// results, never through SQL strings.

import { type Database, schema } from '@auxx/database'
import { createTestOrganization, createTestUser, getTestDb } from '@auxx/test-utils'
import { type FieldPath, toFieldId, toResourceFieldId } from '@auxx/types/field'
import { generateId } from '@auxx/utils'
import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ForbiddenError, UnprocessableEntityError } from '../../errors'
import { BaseType } from '../../workflow-engine/core/types'
import type { ResourceField } from '../registry/field-types'
import { runAggregate, runKpi } from './run-aggregate'
import type { AggregateQuery } from './types'

// ── Org-cache mock (field metadata + actor directories) ─────────────────────

const h = vi.hoisted(() => ({
  fieldsByDef: new Map<string, unknown[]>(),
  members: [] as unknown[],
  agents: [] as unknown[],
  groups: [] as unknown[],
  aggCache: new Map<string, { result: unknown; computedAt: number }>(),
  /** `logger.warn` calls made by the `aggregate-engine` scope only. */
  warnings: [] as Array<{ message: string; meta: Record<string, unknown> | undefined }>,
}))

// Partial mock: `@auxx/logger`'s barrel registers sinks at module load, so a full
// replacement breaks whichever file loads it first. Every other scope keeps the
// real logger — only `aggregate-engine`'s `warn` is teed into `h.warnings`,
// because "a dropped widget filter is still REPORTED" is a behaviour under test
// (a silently ignored filter makes a KPI number too high).
vi.mock('@auxx/logger', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@auxx/logger')>()
  return {
    ...actual,
    createScopedLogger: (
      scope: string,
      options?: Parameters<typeof actual.createScopedLogger>[1]
    ) => {
      const real = actual.createScopedLogger(scope, options)
      if (scope !== 'aggregate-engine') return real
      return {
        ...real,
        warn: (message: string, ...args: unknown[]) => {
          h.warnings.push({ message, meta: args[0] as Record<string, unknown> | undefined })
          real.warn(message, ...args)
        },
      }
    },
  }
})

vi.mock('../../cache', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>()
  return {
    ...actual,
    getCachedResourceFields: async (_orgId: string, defId: string) =>
      h.fieldsByDef.get(defId) ?? [],
    getCachedMembers: async () => h.members,
    getCachedAgents: async () => h.agents,
    getCachedGroups: async () => h.groups,
    // Deterministic stand-in for the aggregate result cache (no Redis here).
    getAggregateCache: () => ({
      read: async (key: string) => h.aggCache.get(key) ?? null,
      write: async (key: string, result: unknown) => {
        h.aggCache.set(key, { result, computedAt: Date.now() })
      },
    }),
  }
})

// ── Fixture helpers ──────────────────────────────────────────────────────────

const caps = {
  filterable: true,
  sortable: true,
  creatable: true,
  updatable: true,
  configurable: true,
}

function makeField(
  defId: string,
  args: {
    id: string
    key: string
    type: BaseType
    fieldType: string
    options?: Record<string, unknown>
    relationship?: Record<string, unknown>
    isSystem?: boolean
    dbColumn?: string
    systemAttribute?: string
  }
): ResourceField {
  return {
    id: toFieldId(args.id),
    resourceFieldId: toResourceFieldId(defId, args.id),
    key: args.key,
    label: args.key,
    type: args.type,
    fieldType: args.fieldType,
    options: args.options,
    relationship: args.relationship,
    isSystem: args.isSystem,
    dbColumn: args.dbColumn,
    systemAttribute: args.systemAttribute,
    capabilities: caps,
  } as ResourceField
}

const db = () => getTestDb() as unknown as Database

async function seedDef(orgId: string) {
  const name = `def_${generateId().slice(0, 8)}`
  const rows = await db()
    .insert(schema.EntityDefinition)
    .values({
      organizationId: orgId,
      apiSlug: name,
      singular: name,
      plural: `${name}s`,
      updatedAt: new Date(),
    })
    .returning()
  return rows[0]!
}

async function seedCustomField(orgId: string, fieldType: string) {
  const rows = await db()
    .insert(schema.CustomField)
    .values({
      organizationId: orgId,
      name: `f_${generateId().slice(0, 8)}`,
      // biome-ignore lint/suspicious/noExplicitAny: enum column accepts FieldType strings
      type: fieldType as any,
      updatedAt: new Date(),
    })
    .returning()
  return rows[0]!
}

async function seedInstance(orgId: string, defId: string, displayName?: string) {
  const rows = await db()
    .insert(schema.EntityInstance)
    .values({
      organizationId: orgId,
      entityDefinitionId: defId,
      displayName,
      updatedAt: new Date(),
    })
    .returning()
  return rows[0]!
}

async function seedValue(args: {
  orgId: string
  defId: string
  entityId: string
  fieldId: string
  sortKey?: string
  valueText?: string
  valueNumber?: number
  valueBoolean?: boolean
  valueDate?: string
  optionId?: string
  relatedEntityId?: string
  relatedEntityDefinitionId?: string
  actorId?: string
}) {
  await db()
    .insert(schema.FieldValue)
    .values({
      organizationId: args.orgId,
      entityDefinitionId: args.defId,
      entityId: args.entityId,
      fieldId: args.fieldId,
      sortKey: args.sortKey ?? 'a',
      updatedAt: new Date(),
      valueText: args.valueText,
      valueNumber: args.valueNumber,
      valueBoolean: args.valueBoolean,
      valueDate: args.valueDate,
      optionId: args.optionId,
      relatedEntityId: args.relatedEntityId,
      relatedEntityDefinitionId: args.relatedEntityDefinitionId,
      actorId: args.actorId,
    })
}

/** One org + one entity def with the field kinds the tests exercise. */
async function setupPlayground() {
  h.fieldsByDef.clear()
  h.members = []
  h.agents = []
  h.groups = []
  h.aggCache.clear()

  const org = await createTestOrganization()
  const def = await seedDef(org.id)

  const statusCf = await seedCustomField(org.id, 'SINGLE_SELECT')
  const amountCf = await seedCustomField(org.id, 'NUMBER')
  const doneCf = await seedCustomField(org.id, 'CHECKBOX')
  const createdCf = await seedCustomField(org.id, 'DATETIME')
  const tagsCf = await seedCustomField(org.id, 'TAGS')
  const noteCf = await seedCustomField(org.id, 'TEXT')
  const ownerCf = await seedCustomField(org.id, 'ACTOR')

  const statusOptions = {
    options: [
      { id: 's1', value: 's1', label: 'Open' },
      { id: 's2', value: 's2', label: 'Closed' },
    ],
  }
  const tagOptions = {
    options: [
      { id: 't1', value: 't1', label: 'Bug' },
      { id: 't2', value: 't2', label: 'Feature' },
    ],
  }

  const fields = [
    makeField(def.id, {
      id: statusCf.id,
      key: 'status',
      type: BaseType.ENUM,
      fieldType: 'SINGLE_SELECT',
      options: statusOptions,
    }),
    makeField(def.id, {
      id: amountCf.id,
      key: 'amount',
      type: BaseType.NUMBER,
      fieldType: 'NUMBER',
    }),
    makeField(def.id, {
      id: doneCf.id,
      key: 'done',
      type: BaseType.BOOLEAN,
      fieldType: 'CHECKBOX',
    }),
    makeField(def.id, {
      id: createdCf.id,
      key: 'created',
      type: BaseType.DATETIME,
      fieldType: 'DATETIME',
    }),
    makeField(def.id, {
      id: tagsCf.id,
      key: 'tags',
      type: BaseType.ENUM,
      fieldType: 'TAGS',
      options: tagOptions,
    }),
    makeField(def.id, { id: noteCf.id, key: 'note', type: BaseType.STRING, fieldType: 'TEXT' }),
    makeField(def.id, { id: ownerCf.id, key: 'owner', type: BaseType.ACTOR, fieldType: 'ACTOR' }),
  ]
  h.fieldsByDef.set(def.id, fields)

  const ref = (fieldId: string) => toResourceFieldId(def.id, fieldId)

  const baseQuery = (over: Partial<AggregateQuery>): AggregateQuery => ({
    source: { kind: 'entity', entityDefinitionId: def.id },
    metric: { op: 'count' },
    timezone: 'UTC',
    ...over,
  })

  return {
    org,
    def,
    ref,
    baseQuery,
    fieldIds: {
      status: statusCf.id,
      amount: amountCf.id,
      done: doneCf.id,
      created: createdCf.id,
      tags: tagsCf.id,
      note: noteCf.id,
      owner: ownerCf.id,
    },
  }
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('runAggregate — entity source', () => {
  let p: Awaited<ReturnType<typeof setupPlayground>>

  beforeEach(async () => {
    p = await setupPlayground()
  })

  async function seedStatusTrio() {
    const a = await seedInstance(p.org.id, p.def.id, 'A')
    const b = await seedInstance(p.org.id, p.def.id, 'B')
    const c = await seedInstance(p.org.id, p.def.id, 'C')
    const base = { orgId: p.org.id, defId: p.def.id, fieldId: p.fieldIds.status }
    await seedValue({ ...base, entityId: a.id, optionId: 's1' })
    await seedValue({ ...base, entityId: b.id, optionId: 's1' })
    return { a, b, c }
  }

  it('counts records grouped by single-select with option labels and an empty bucket', async () => {
    await seedStatusTrio()
    const result = await runAggregate(
      db(),
      p.org.id,
      undefined,
      p.baseQuery({ groupBy: { fieldRef: p.ref(p.fieldIds.status) } })
    )
    expect(result.isOk()).toBe(true)
    const value = result._unsafeUnwrap()
    expect(value.groups).toEqual([
      { key: 's1', label: 'Open', value: 2 },
      { key: null, label: '(empty)', value: 1 },
    ])
    expect(value.totalValue).toBe(3)
    expect(value.hasMoreGroups).toBe(false)
  })

  it('omitEmpty drops the null bucket', async () => {
    await seedStatusTrio()
    const result = await runAggregate(
      db(),
      p.org.id,
      undefined,
      p.baseQuery({ groupBy: { fieldRef: p.ref(p.fieldIds.status), omitEmpty: true } })
    )
    expect(result._unsafeUnwrap().groups).toEqual([{ key: 's1', label: 'Open', value: 2 }])
  })

  it('ignores archived records and other orgs', async () => {
    await seedStatusTrio()
    // Archived record with a status value
    const archived = await seedInstance(p.org.id, p.def.id, 'Z')
    await db()
      .update(schema.EntityInstance)
      .set({ archivedAt: new Date() })
      .where(eq(schema.EntityInstance.id, archived.id))
    await seedValue({
      orgId: p.org.id,
      defId: p.def.id,
      entityId: archived.id,
      fieldId: p.fieldIds.status,
      optionId: 's1',
    })
    const result = await runAggregate(
      db(),
      p.org.id,
      undefined,
      p.baseQuery({ groupBy: { fieldRef: p.ref(p.fieldIds.status), omitEmpty: true } })
    )
    expect(result._unsafeUnwrap().groups[0]?.value).toBe(2)
  })

  it('sum / avg / min / max over a number field (no group = single value)', async () => {
    const a = await seedInstance(p.org.id, p.def.id)
    const b = await seedInstance(p.org.id, p.def.id)
    await seedInstance(p.org.id, p.def.id) // no amount
    const base = { orgId: p.org.id, defId: p.def.id, fieldId: p.fieldIds.amount }
    await seedValue({ ...base, entityId: a.id, valueNumber: 10 })
    await seedValue({ ...base, entityId: b.id, valueNumber: 30 })

    const metricRef = p.ref(p.fieldIds.amount)
    for (const [op, expected] of [
      ['sum', 40],
      ['avg', 20],
      ['min', 10],
      ['max', 30],
    ] as const) {
      const result = await runAggregate(
        db(),
        p.org.id,
        undefined,
        p.baseQuery({ metric: { op, fieldRef: metricRef } })
      )
      expect(result._unsafeUnwrap().totalValue).toBe(expected)
    }
  })

  it('countEmpty / countNotEmpty / percentNotEmpty follow the no-row-means-empty invariant', async () => {
    const a = await seedInstance(p.org.id, p.def.id)
    const b = await seedInstance(p.org.id, p.def.id)
    await seedInstance(p.org.id, p.def.id) // never set
    const base = { orgId: p.org.id, defId: p.def.id, fieldId: p.fieldIds.amount }
    await seedValue({ ...base, entityId: a.id, valueNumber: 1 })
    await seedValue({ ...base, entityId: b.id, valueNumber: 2 })

    const metricRef = p.ref(p.fieldIds.amount)
    const run = (op: 'countEmpty' | 'countNotEmpty' | 'percentNotEmpty') =>
      runAggregate(db(), p.org.id, undefined, p.baseQuery({ metric: { op, fieldRef: metricRef } }))

    expect((await run('countEmpty'))._unsafeUnwrap().totalValue).toBe(1)
    expect((await run('countNotEmpty'))._unsafeUnwrap().totalValue).toBe(2)
    expect((await run('percentNotEmpty'))._unsafeUnwrap().totalValue).toBeCloseTo(66.67, 1)
  })

  it('countTrue / countFalse on a checkbox field', async () => {
    const a = await seedInstance(p.org.id, p.def.id)
    const b = await seedInstance(p.org.id, p.def.id)
    const c = await seedInstance(p.org.id, p.def.id)
    const base = { orgId: p.org.id, defId: p.def.id, fieldId: p.fieldIds.done }
    await seedValue({ ...base, entityId: a.id, valueBoolean: true })
    await seedValue({ ...base, entityId: b.id, valueBoolean: false })
    await seedValue({ ...base, entityId: c.id, valueBoolean: true })

    const metricRef = p.ref(p.fieldIds.done)
    const trueResult = await runAggregate(
      db(),
      p.org.id,
      undefined,
      p.baseQuery({ metric: { op: 'countTrue', fieldRef: metricRef } })
    )
    const falseResult = await runAggregate(
      db(),
      p.org.id,
      undefined,
      p.baseQuery({ metric: { op: 'countFalse', fieldRef: metricRef } })
    )
    expect(trueResult._unsafeUnwrap().totalValue).toBe(2)
    expect(falseResult._unsafeUnwrap().totalValue).toBe(1)
  })

  it('countUnique counts distinct values, not records', async () => {
    await seedStatusTrio() // two records share s1
    const result = await runAggregate(
      db(),
      p.org.id,
      undefined,
      p.baseQuery({ metric: { op: 'countUnique', fieldRef: p.ref(p.fieldIds.status) } })
    )
    expect(result._unsafeUnwrap().totalValue).toBe(1)
  })

  it('multi-value TAGS group-by counts a record once per tag, but count stays DISTINCT per bucket', async () => {
    const a = await seedInstance(p.org.id, p.def.id)
    const b = await seedInstance(p.org.id, p.def.id)
    const base = { orgId: p.org.id, defId: p.def.id, fieldId: p.fieldIds.tags }
    await seedValue({ ...base, entityId: a.id, optionId: 't1', sortKey: 'a' })
    await seedValue({ ...base, entityId: a.id, optionId: 't2', sortKey: 'b' })
    await seedValue({ ...base, entityId: b.id, optionId: 't1', sortKey: 'a' })

    const result = await runAggregate(
      db(),
      p.org.id,
      undefined,
      p.baseQuery({ groupBy: { fieldRef: p.ref(p.fieldIds.tags), omitEmpty: true } })
    )
    expect(result._unsafeUnwrap().groups).toEqual([
      { key: 't1', label: 'Bug', value: 2 },
      { key: 't2', label: 'Feature', value: 1 },
    ])
  })

  it('groups by relationship with displayName labels', async () => {
    const companyDef = await seedDef(p.org.id)
    h.fieldsByDef.set(companyDef.id, [])
    const acme = await seedInstance(p.org.id, companyDef.id, 'Acme')
    const globex = await seedInstance(p.org.id, companyDef.id, 'Globex')

    const companyCf = await seedCustomField(p.org.id, 'RELATIONSHIP')
    const companyField = makeField(p.def.id, {
      id: companyCf.id,
      key: 'company',
      type: BaseType.RELATION,
      fieldType: 'RELATIONSHIP',
      relationship: { inverseResourceFieldId: toResourceFieldId(companyDef.id, 'items') },
    })
    h.fieldsByDef.set(p.def.id, [...(h.fieldsByDef.get(p.def.id) as ResourceField[]), companyField])

    const a = await seedInstance(p.org.id, p.def.id)
    const b = await seedInstance(p.org.id, p.def.id)
    const c = await seedInstance(p.org.id, p.def.id)
    const base = { orgId: p.org.id, defId: p.def.id, fieldId: companyCf.id }
    await seedValue({ ...base, entityId: a.id, relatedEntityId: acme.id })
    await seedValue({ ...base, entityId: b.id, relatedEntityId: acme.id })
    await seedValue({ ...base, entityId: c.id, relatedEntityId: globex.id })

    const result = await runAggregate(
      db(),
      p.org.id,
      undefined,
      p.baseQuery({ groupBy: { fieldRef: p.ref(companyCf.id) } })
    )
    expect(result._unsafeUnwrap().groups).toEqual([
      { key: acme.id, label: 'Acme', value: 2 },
      { key: globex.id, label: 'Globex', value: 1 },
    ])
  })

  it('ACTOR group-by coalesces user (actorId) and group (relatedEntityId) storage', async () => {
    const user = await createTestUser({ name: 'Alice' })
    h.members = [
      { user: { id: user.id, name: 'Alice', email: user.email, image: null, userType: 'user' } },
    ]
    h.groups = [{ id: 'grp1', displayName: 'Support Team', metadata: {} }]

    const a = await seedInstance(p.org.id, p.def.id)
    const b = await seedInstance(p.org.id, p.def.id)
    const base = { orgId: p.org.id, defId: p.def.id, fieldId: p.fieldIds.owner }
    await seedValue({ ...base, entityId: a.id, actorId: user.id })
    await seedValue({ ...base, entityId: b.id, relatedEntityId: 'grp1' })

    const result = await runAggregate(
      db(),
      p.org.id,
      undefined,
      p.baseQuery({ groupBy: { fieldRef: p.ref(p.fieldIds.owner), sort: 'labelAsc' } })
    )
    expect(result._unsafeUnwrap().groups).toEqual([
      { key: user.id, label: 'Alice', value: 1 },
      { key: 'grp1', label: 'Support Team', value: 1 },
    ])
  })

  it('one-hop group-by traverses a relationship to the target field', async () => {
    // contact def with a tier select; tickets relate to contacts.
    const contactDef = await seedDef(p.org.id)
    const tierCf = await seedCustomField(p.org.id, 'SINGLE_SELECT')
    h.fieldsByDef.set(contactDef.id, [
      makeField(contactDef.id, {
        id: tierCf.id,
        key: 'tier',
        type: BaseType.ENUM,
        fieldType: 'SINGLE_SELECT',
        options: {
          options: [
            { id: 'gold', value: 'gold', label: 'Gold' },
            { id: 'silver', value: 'silver', label: 'Silver' },
          ],
        },
      }),
    ])

    const contactCf = await seedCustomField(p.org.id, 'RELATIONSHIP')
    const contactField = makeField(p.def.id, {
      id: contactCf.id,
      key: 'contact',
      type: BaseType.RELATION,
      fieldType: 'RELATIONSHIP',
      relationship: { inverseResourceFieldId: toResourceFieldId(contactDef.id, 'tickets') },
    })
    h.fieldsByDef.set(p.def.id, [...(h.fieldsByDef.get(p.def.id) as ResourceField[]), contactField])

    const c1 = await seedInstance(p.org.id, contactDef.id, 'C1')
    const c2 = await seedInstance(p.org.id, contactDef.id, 'C2')
    await seedValue({
      orgId: p.org.id,
      defId: contactDef.id,
      entityId: c1.id,
      fieldId: tierCf.id,
      optionId: 'gold',
    })
    await seedValue({
      orgId: p.org.id,
      defId: contactDef.id,
      entityId: c2.id,
      fieldId: tierCf.id,
      optionId: 'silver',
    })

    const [t1, t2, t3, t4] = await Promise.all([
      seedInstance(p.org.id, p.def.id),
      seedInstance(p.org.id, p.def.id),
      seedInstance(p.org.id, p.def.id),
      seedInstance(p.org.id, p.def.id),
    ])
    const rel = { orgId: p.org.id, defId: p.def.id, fieldId: contactCf.id }
    await seedValue({ ...rel, entityId: t1!.id, relatedEntityId: c1.id })
    await seedValue({ ...rel, entityId: t2!.id, relatedEntityId: c1.id })
    await seedValue({ ...rel, entityId: t3!.id, relatedEntityId: c2.id })
    // t4 has no contact → empty bucket

    const hopRef: FieldPath = [
      toResourceFieldId(p.def.id, contactCf.id),
      toResourceFieldId(contactDef.id, tierCf.id),
    ]
    const result = await runAggregate(
      db(),
      p.org.id,
      undefined,
      p.baseQuery({ groupBy: { fieldRef: hopRef } })
    )
    expect(result._unsafeUnwrap().groups).toEqual([
      { key: 'gold', label: 'Gold', value: 2 },
      { key: 'silver', label: 'Silver', value: 1 },
      { key: null, label: '(empty)', value: 1 },
    ])
    expect(t4).toBeDefined()
  })

  it('buckets dates by day in the viewer timezone across a DST boundary', async () => {
    const base = { orgId: p.org.id, defId: p.def.id, fieldId: p.fieldIds.created }
    // NY DST spring-forward is 2026-03-08 (EST→EDT).
    for (const iso of [
      '2026-03-08T04:30:00.000Z', // Mar 7 23:30 EST → 2026-03-07
      '2026-03-08T05:30:00.000Z', // Mar 8 00:30 EST → 2026-03-08
      '2026-03-09T03:30:00.000Z', // Mar 8 23:30 EDT → 2026-03-08
    ]) {
      const instance = await seedInstance(p.org.id, p.def.id)
      await seedValue({ ...base, entityId: instance.id, valueDate: iso })
    }

    const result = await runAggregate(
      db(),
      p.org.id,
      undefined,
      p.baseQuery({
        timezone: 'America/New_York',
        groupBy: {
          fieldRef: p.ref(p.fieldIds.created),
          dateGranularity: 'day',
          sort: 'labelAsc',
          omitEmpty: true,
        },
      })
    )
    expect(result._unsafeUnwrap().groups).toEqual([
      { key: '2026-03-07', label: 'Mar 7, 2026', value: 1 },
      { key: '2026-03-08', label: 'Mar 8, 2026', value: 2 },
    ])
  })

  it('zero-fills missing buckets when the window is bounded on the group field', async () => {
    const base = { orgId: p.org.id, defId: p.def.id, fieldId: p.fieldIds.created }
    const a = await seedInstance(p.org.id, p.def.id)
    const b = await seedInstance(p.org.id, p.def.id)
    await seedValue({ ...base, entityId: a.id, valueDate: '2026-07-01T10:00:00.000Z' })
    await seedValue({ ...base, entityId: b.id, valueDate: '2026-07-03T10:00:00.000Z' })

    const result = await runAggregate(
      db(),
      p.org.id,
      undefined,
      p.baseQuery({
        groupBy: { fieldRef: p.ref(p.fieldIds.created), dateGranularity: 'day', sort: 'labelAsc' },
        dateWindow: {
          fieldRef: p.ref(p.fieldIds.created),
          from: new Date('2026-07-01T00:00:00.000Z'),
          to: new Date('2026-07-04T00:00:00.000Z'),
        },
      })
    )
    expect(result._unsafeUnwrap().groups).toEqual([
      { key: '2026-07-01', label: 'Jul 1, 2026', value: 1 },
      { key: '2026-07-02', label: 'Jul 2, 2026', value: 0 },
      { key: '2026-07-03', label: 'Jul 3, 2026', value: 1 },
    ])
  })

  it('secondary group-by shapes per-group series ranked by global series totals', async () => {
    const a = await seedInstance(p.org.id, p.def.id)
    const b = await seedInstance(p.org.id, p.def.id)
    const c = await seedInstance(p.org.id, p.def.id)
    const status = { orgId: p.org.id, defId: p.def.id, fieldId: p.fieldIds.status }
    const done = { orgId: p.org.id, defId: p.def.id, fieldId: p.fieldIds.done }
    await seedValue({ ...status, entityId: a.id, optionId: 's1' })
    await seedValue({ ...status, entityId: b.id, optionId: 's1' })
    await seedValue({ ...status, entityId: c.id, optionId: 's2' })
    await seedValue({ ...done, entityId: a.id, valueBoolean: true })
    await seedValue({ ...done, entityId: b.id, valueBoolean: false })
    await seedValue({ ...done, entityId: c.id, valueBoolean: true })

    const result = await runAggregate(
      db(),
      p.org.id,
      undefined,
      p.baseQuery({
        groupBy: { fieldRef: p.ref(p.fieldIds.status) },
        secondaryGroupBy: { fieldRef: p.ref(p.fieldIds.done) },
      })
    )
    const groups = result._unsafeUnwrap().groups
    expect(groups[0]).toMatchObject({ key: 's1', value: 2 })
    expect(groups[0]?.series).toEqual([
      { key: 'true', label: 'True', value: 1 },
      { key: 'false', label: 'False', value: 1 },
    ])
    expect(groups[1]).toMatchObject({ key: 's2', value: 1 })
    expect(groups[1]?.series).toEqual([{ key: 'true', label: 'True', value: 1 }])
  })

  it('applies ConditionGroup filters', async () => {
    const { a } = await seedStatusTrio()
    const amount = { orgId: p.org.id, defId: p.def.id, fieldId: p.fieldIds.amount }
    await seedValue({ ...amount, entityId: a.id, valueNumber: 5 })

    const result = await runAggregate(
      db(),
      p.org.id,
      undefined,
      p.baseQuery({
        filters: [
          {
            id: 'g1',
            logicalOperator: 'AND',
            conditions: [
              {
                id: 'c1',
                fieldId: p.ref(p.fieldIds.status),
                operator: 'is',
                value: 's1',
              },
            ],
          },
        ],
      })
    )
    expect(result._unsafeUnwrap().totalValue).toBe(2)
  })

  it('min/max on a date field return epoch milliseconds', async () => {
    const base = { orgId: p.org.id, defId: p.def.id, fieldId: p.fieldIds.created }
    const a = await seedInstance(p.org.id, p.def.id)
    const b = await seedInstance(p.org.id, p.def.id)
    await seedValue({ ...base, entityId: a.id, valueDate: '2026-01-01T00:00:00.000Z' })
    await seedValue({ ...base, entityId: b.id, valueDate: '2026-06-01T00:00:00.000Z' })

    const result = await runAggregate(
      db(),
      p.org.id,
      undefined,
      p.baseQuery({ metric: { op: 'min', fieldRef: p.ref(p.fieldIds.created) } })
    )
    expect(result._unsafeUnwrap().totalValue).toBe(new Date('2026-01-01T00:00:00.000Z').getTime())
  })

  it('rejects invalid metric/group configurations with UnprocessableEntityError', async () => {
    const cases: AggregateQuery[] = [
      // sum on a text field
      p.baseQuery({ metric: { op: 'sum', fieldRef: p.ref(p.fieldIds.note) } }),
      // metric op that needs a field, without one
      p.baseQuery({ metric: { op: 'sum' } }),
      // granularity on a non-date field
      p.baseQuery({
        groupBy: { fieldRef: p.ref(p.fieldIds.status), dateGranularity: 'month' },
      }),
      // unknown field
      p.baseQuery({ groupBy: { fieldRef: p.ref('nope') } }),
      // countTrue on non-checkbox
      p.baseQuery({ metric: { op: 'countTrue', fieldRef: p.ref(p.fieldIds.note) } }),
    ]
    for (const query of cases) {
      const result = await runAggregate(db(), p.org.id, undefined, query)
      expect(result.isErr()).toBe(true)
      expect(result._unsafeUnwrapErr()).toBeInstanceOf(UnprocessableEntityError)
    }

    // two-hop path
    const twoHop: FieldPath = [
      toResourceFieldId(p.def.id, 'x'),
      toResourceFieldId('other', 'y'),
      toResourceFieldId('third', 'z'),
    ]
    const hopResult = await runAggregate(
      db(),
      p.org.id,
      undefined,
      p.baseQuery({ groupBy: { fieldRef: twoHop } })
    )
    expect(hopResult._unsafeUnwrapErr()).toBeInstanceOf(UnprocessableEntityError)
  })
})

describe('runKpi', () => {
  let p: Awaited<ReturnType<typeof setupPlayground>>

  beforeEach(async () => {
    p = await setupPlayground()
  })

  async function seedCreatedAt(iso: string) {
    const instance = await seedInstance(p.org.id, p.def.id)
    await seedValue({
      orgId: p.org.id,
      defId: p.def.id,
      entityId: instance.id,
      fieldId: p.fieldIds.created,
      valueDate: iso,
    })
  }

  it('previousPeriod trend runs current + previous windows', async () => {
    await seedCreatedAt('2026-07-02T00:00:00.000Z')
    await seedCreatedAt('2026-07-03T00:00:00.000Z')
    await seedCreatedAt('2026-07-04T00:00:00.000Z')
    await seedCreatedAt('2026-06-26T00:00:00.000Z') // previous window

    const result = await runKpi(db(), p.org.id, undefined, {
      base: p.baseQuery({
        dateWindow: {
          fieldRef: p.ref(p.fieldIds.created),
          from: new Date('2026-07-01T00:00:00.000Z'),
          to: new Date('2026-07-08T00:00:00.000Z'),
        },
      }),
      trend: { compare: 'previousPeriod' },
    })
    expect(result._unsafeUnwrap()).toEqual({ value: 3, previousValue: 1 })
  })

  it('unbounded window → no previousValue', async () => {
    await seedCreatedAt('2026-07-02T00:00:00.000Z')
    const result = await runKpi(db(), p.org.id, undefined, {
      base: p.baseQuery({}),
      trend: { compare: 'previousPeriod' },
    })
    expect(result._unsafeUnwrap()).toEqual({ value: 1 })
  })
})

describe('aggregate result cache', () => {
  let p: Awaited<ReturnType<typeof setupPlayground>>

  beforeEach(async () => {
    p = await setupPlayground()
  })

  async function seedStatusRecord(name: string) {
    const instance = await seedInstance(p.org.id, p.def.id, name)
    await seedValue({
      orgId: p.org.id,
      defId: p.def.id,
      entityId: instance.id,
      fieldId: p.fieldIds.status,
      optionId: 's1',
    })
  }

  it('serves repeat calls from cache; skipCache recomputes and repopulates', async () => {
    await seedStatusRecord('A')
    const query = p.baseQuery({ groupBy: { fieldRef: p.ref(p.fieldIds.status) } })

    const first = (await runAggregate(db(), p.org.id, undefined, query))._unsafeUnwrap()
    expect(first.totalValue).toBe(1)
    expect(h.aggCache.size).toBe(1)

    // Mutate the data — a cached re-run must NOT see it.
    await seedStatusRecord('B')
    const cached = (await runAggregate(db(), p.org.id, undefined, query))._unsafeUnwrap()
    expect(cached).toEqual(first)

    // skipCache bypasses the read but still writes the fresh result back.
    const fresh = (
      await runAggregate(db(), p.org.id, undefined, query, { skipCache: true })
    )._unsafeUnwrap()
    expect(fresh.totalValue).toBe(2)
    const afterRefresh = (await runAggregate(db(), p.org.id, undefined, query))._unsafeUnwrap()
    expect(afterRefresh).toEqual(fresh)
  })

  it('never caches errors', async () => {
    const result = await runAggregate(
      db(),
      p.org.id,
      undefined,
      p.baseQuery({ metric: { op: 'sum' } })
    )
    expect(result.isErr()).toBe(true)
    expect(h.aggCache.size).toBe(0)
  })

  it('kpi entries key on the trend compare', async () => {
    const base = p.baseQuery({})
    ;(await runKpi(db(), p.org.id, undefined, { base }))._unsafeUnwrap()
    ;(
      await runKpi(db(), p.org.id, undefined, { base, trend: { compare: 'previousPeriod' } })
    )._unsafeUnwrap()
    expect(h.aggCache.size).toBe(2)
  })
})

describe('runAggregate — system source', () => {
  it('aggregates articles by status via direct columns', async () => {
    const org = await createTestOrganization()
    // `User` has no `organizationId` column — the row is only needed for
    // `createdById` below.
    const user = await createTestUser()
    const kbRows = await db()
      .insert(schema.KnowledgeBase)
      .values({
        organizationId: org.id,
        name: 'kb',
        slug: `kb-${generateId().slice(0, 8)}`,
        createdById: user.id,
        updatedAt: new Date(),
      })
      .returning()
    const kb = kbRows[0]!

    for (const [title, status] of [
      ['a', 'PUBLISHED'],
      ['b', 'PUBLISHED'],
      ['c', 'DRAFT'],
    ] as const) {
      await db().insert(schema.Article).values({
        title,
        organizationId: org.id,
        homeKnowledgeBaseId: kb.id,
        status,
        updatedAt: new Date(),
      })
    }

    h.fieldsByDef.set('article', [
      makeField('article', {
        id: 'status',
        key: 'status',
        type: BaseType.ENUM,
        fieldType: 'SINGLE_SELECT',
        dbColumn: 'status',
        isSystem: true,
        options: {
          options: [
            { id: 'PUBLISHED', value: 'PUBLISHED', label: 'Published' },
            { id: 'DRAFT', value: 'DRAFT', label: 'Draft' },
          ],
        },
      }),
    ])

    const result = await runAggregate(db(), org.id, undefined, {
      source: { kind: 'system', tableId: 'article' },
      metric: { op: 'count' },
      groupBy: { fieldRef: toResourceFieldId('article', 'status') },
      timezone: 'UTC',
    })
    expect(result._unsafeUnwrap().groups).toEqual([
      { key: 'PUBLISHED', label: 'Published', value: 2 },
      { key: 'DRAFT', label: 'Draft', value: 1 },
    ])
  })

  it('rejects non-allowlisted system tables', async () => {
    const org = await createTestOrganization()
    const result = await runAggregate(db(), org.id, undefined, {
      source: { kind: 'system', tableId: 'user' },
      metric: { op: 'count' },
      timezone: 'UTC',
    })
    expect(result._unsafeUnwrapErr()).toBeInstanceOf(UnprocessableEntityError)
  })

  // The one that used to live here aggregated THREADS by status and passed —
  // which was the bug. `buildSystemAggregateSql` scopes by `organizationId` and
  // nothing else, so that green test was measuring the whole org's mailbox. The
  // unit-level proof (no DB touched at all) is in `mail-lens-refusal.test.ts`;
  // this one pins the refusal with a real database underneath.
  it('refuses thread and message even with rows present in the table', async () => {
    const org = await createTestOrganization()
    const integrationRows = await db()
      .insert(schema.Integration)
      .values({ organizationId: org.id, updatedAt: new Date() })
      .returning()
    const integration = integrationRows[0]!
    await db()
      .insert(schema.Thread)
      .values({ subject: 'a', organizationId: org.id, integrationId: integration.id })

    for (const tableId of ['thread', 'message'] as const) {
      const result = await runAggregate(db(), org.id, undefined, {
        source: { kind: 'system', tableId },
        metric: { op: 'count' },
        timezone: 'UTC',
      })
      expect(result._unsafeUnwrapErr()).toBeInstanceOf(ForbiddenError)

      const kpi = await runKpi(db(), org.id, undefined, {
        base: { source: { kind: 'system', tableId }, metric: { op: 'count' }, timezone: 'UTC' },
      })
      expect(kpi._unsafeUnwrapErr()).toBeInstanceOf(ForbiddenError)
    }
  })
})

// ── System-source filters addressed by the merged CustomField cuid ───────────
//
// The filter surfaces address a field on a system resource by the org's merged
// `CustomField` cuid, while `SystemConditionBuilder` resolves against
// `RESOURCE_FIELD_REGISTRY['article']`, which is keyed by the STATIC key
// ('status'). Untranslated, the condition never resolved and was DROPPED — and a
// dropped filter does not narrow, so the widget answered with the unfiltered
// total. `prepareAggregate` now runs `canonicalizeSystemConditions` over the
// filters first, against the same merged `rootFields` it already loaded.
//
// Asserted through counts against real rows, never through SQL strings: 3
// articles exist, 2 are PUBLISHED, so "did the filter apply" is the difference
// between 2 and 3 and the pre-fix behaviour is a failing 3.

describe('runAggregate — system-source filters addressed by CustomField cuid', () => {
  /** The org's materialized `CustomField` row id for the static `article:status` field. */
  const STATUS_CUID = 'cf_article_status_00000001'
  /** A cuid that matches no merged field — e.g. a widget saved against a retired one. */
  const UNKNOWN_CUID = 'cf_retired_field_000000001'

  /**
   * 3 articles (2 PUBLISHED, 1 DRAFT) plus the merged field shape
   * `mergeSystemAndCustomFields` produces for a system resource: `id` is the DB
   * `CustomField.id`, `key` stays the static registry key.
   */
  async function seedArticles() {
    h.aggCache.clear()
    h.warnings.length = 0
    h.fieldsByDef.clear()

    const org = await createTestOrganization()
    const user = await createTestUser()
    const kbRows = await db()
      .insert(schema.KnowledgeBase)
      .values({
        organizationId: org.id,
        name: 'kb',
        slug: `kb-${generateId().slice(0, 8)}`,
        createdById: user.id,
        updatedAt: new Date(),
      })
      .returning()
    const kb = kbRows[0]!

    for (const [title, status] of [
      ['a', 'PUBLISHED'],
      ['b', 'PUBLISHED'],
      ['c', 'DRAFT'],
    ] as const) {
      await db().insert(schema.Article).values({
        title,
        organizationId: org.id,
        homeKnowledgeBaseId: kb.id,
        status,
        updatedAt: new Date(),
      })
    }

    h.fieldsByDef.set('article', [
      makeField('article', {
        id: STATUS_CUID,
        key: 'status',
        type: BaseType.ENUM,
        fieldType: 'SINGLE_SELECT',
        dbColumn: 'status',
        systemAttribute: 'article_status',
        isSystem: true,
      }),
    ])

    return org
  }

  const statusFilter = (fieldRef: string): AggregateQuery['filters'] => [
    {
      id: 'g1',
      logicalOperator: 'AND',
      conditions: [{ id: 'c1', fieldId: fieldRef, operator: 'is', value: 'PUBLISHED' }],
    },
  ]

  const countArticles = (orgId: string, filters?: AggregateQuery['filters']) =>
    runAggregate(db(), orgId, undefined, {
      source: { kind: 'system', tableId: 'article' },
      metric: { op: 'count' },
      timezone: 'UTC',
      filters,
    })

  it('narrows on a `<defId>:<cuid>` filter — the table filter builder shape', async () => {
    const org = await seedArticles()

    expect((await countArticles(org.id))._unsafeUnwrap().totalValue).toBe(3)
    const filtered = await countArticles(
      org.id,
      statusFilter(toResourceFieldId('article', STATUS_CUID))
    )
    expect(filtered._unsafeUnwrap().totalValue).toBe(2)
    expect(h.warnings).toEqual([])
  })

  it('narrows on a bare cuid too — the records searchbar shape', async () => {
    const org = await seedArticles()

    const filtered = await countArticles(org.id, statusFilter(STATUS_CUID))
    expect(filtered._unsafeUnwrap().totalValue).toBe(2)
    expect(h.warnings).toEqual([])
  })

  it('still narrows when the filter already names the static key', async () => {
    const org = await seedArticles()

    // Idempotence where it matters: stored widgets hold both shapes.
    expect((await countArticles(org.id, statusFilter('status')))._unsafeUnwrap().totalValue).toBe(2)
    expect(
      (await countArticles(org.id, statusFilter('article:status')))._unsafeUnwrap().totalValue
    ).toBe(2)
    expect(h.warnings).toEqual([])
  })

  it('narrows a KPI the same way — runKpi shares prepareAggregate', async () => {
    const org = await seedArticles()

    const kpi = await runKpi(db(), org.id, undefined, {
      base: {
        source: { kind: 'system', tableId: 'article' },
        metric: { op: 'count' },
        timezone: 'UTC',
        filters: statusFilter(STATUS_CUID),
      },
    })
    expect(kpi._unsafeUnwrap().value).toBe(2)
  })

  it('an unresolvable cuid still fails open, and says so', async () => {
    const org = await seedArticles()

    // Deliberate contract for a widget: render WIDER rather than error. The
    // canonicalizer returns an unknown ref unchanged precisely so the builder
    // keeps dropping it visibly instead of compiling a confident guess.
    const result = await countArticles(org.id, statusFilter(UNKNOWN_CUID))
    expect(result._unsafeUnwrap().totalValue).toBe(3)

    expect(h.warnings).toHaveLength(1)
    expect(h.warnings[0]?.message).toBe('Dropped widget filter conditions')
    expect(h.warnings[0]?.meta).toMatchObject({
      entityDefinitionId: 'article',
      droppedCount: 1,
      requestedConditions: 1,
      allConditionsDropped: true,
    })
  })
})
