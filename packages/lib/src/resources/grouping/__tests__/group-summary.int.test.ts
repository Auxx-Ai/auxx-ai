// packages/lib/src/resources/grouping/__tests__/group-summary.int.test.ts
//
// DB-backed checks of the group summary and the grouped list page against the
// auxx_test database. Field metadata comes from a mocked org cache; rows are
// seeded through Drizzle (same pattern as aggregate/__tests__/run-aggregate.int.test.ts).

import { type Database, schema } from '@auxx/database'
import { createTestOrganization, getTestDb } from '@auxx/test-utils'
import { toFieldId, toResourceFieldId } from '@auxx/types/field'
import { generateId } from '@auxx/utils'
import { ne } from 'drizzle-orm'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { UnprocessableEntityError } from '../../../errors'
import { BaseType } from '../../../workflow-engine/core/types'
import { queryEntityInstanceIdsPaged } from '../../crud/unified-handler-queries'
import type { ResourceField } from '../../registry/field-types'
import { queryEntityGroupSummary } from '../group-summary'
import { MAX_SUMMARY_GROUPS } from '../types'

const h = vi.hoisted(() => ({ fieldsByDef: new Map<string, unknown[]>() }))

vi.mock('../../../cache', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>()
  return {
    ...actual,
    getCachedResourceFields: async (_orgId: string, defId: string) =>
      h.fieldsByDef.get(defId) ?? [],
    getCachedMembers: async () => [],
    getCachedAgents: async () => [],
    getCachedGroups: async () => [],
  }
})

const caps = { filterable: true, sortable: true, creatable: true, updatable: true }
const db = () => getTestDb() as unknown as Database

function makeField(
  defId: string,
  args: { id: string; key: string; type: BaseType; fieldType: string; options?: unknown }
): ResourceField {
  return {
    id: toFieldId(args.id),
    resourceFieldId: toResourceFieldId(defId, args.id),
    key: args.key,
    label: args.key,
    type: args.type,
    fieldType: args.fieldType,
    options: args.options,
    capabilities: caps,
  } as ResourceField
}

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
      type: fieldType as any,
      updatedAt: new Date(),
    })
    .returning()
  return rows[0]!
}

async function seedInstances(orgId: string, defId: string, count: number) {
  return db()
    .insert(schema.EntityInstance)
    .values(
      Array.from({ length: count }, (_, i) => ({
        organizationId: orgId,
        entityDefinitionId: defId,
        displayName: `r${i}`,
        createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, i)),
        updatedAt: new Date(),
      }))
    )
    .returning()
}

type ValueRow = Partial<typeof schema.FieldValue.$inferInsert> & {
  entityId: string
  fieldId: string
}

async function seedValues(orgId: string, defId: string, values: ValueRow[]) {
  if (values.length === 0) return
  await db()
    .insert(schema.FieldValue)
    .values(
      values.map((v) => ({
        organizationId: orgId,
        entityDefinitionId: defId,
        sortKey: 'a',
        updatedAt: new Date(),
        ...v,
      }))
    )
}

async function setup() {
  h.fieldsByDef.clear()
  const org = await createTestOrganization()
  const def = await seedDef(org.id)
  const statusCf = await seedCustomField(org.id, 'SINGLE_SELECT')
  const amountCf = await seedCustomField(org.id, 'NUMBER')
  const seenCf = await seedCustomField(org.id, 'DATETIME')
  const noteCf = await seedCustomField(org.id, 'TEXT')

  h.fieldsByDef.set(def.id, [
    makeField(def.id, {
      id: statusCf.id,
      key: 'status',
      type: BaseType.ENUM,
      fieldType: 'SINGLE_SELECT',
      // Option order is deliberately not alphabetical; 'legacy' is a `value`-keyspace key.
      options: {
        options: [
          { id: 'opt_z', value: 'zeta', label: 'Zeta' },
          { id: 'opt_a', value: 'legacy', label: 'Alpha' },
        ],
      },
    }),
    makeField(def.id, {
      id: amountCf.id,
      key: 'amount',
      type: BaseType.NUMBER,
      fieldType: 'NUMBER',
    }),
    makeField(def.id, {
      id: seenCf.id,
      key: 'seen',
      type: BaseType.DATETIME,
      fieldType: 'DATETIME',
    }),
    makeField(def.id, { id: noteCf.id, key: 'note', type: BaseType.STRING, fieldType: 'TEXT' }),
  ])

  const ref = (id: string) => toResourceFieldId(def.id, id)
  const params = {
    entityDefinitionId: def.id,
    organizationId: org.id,
    filters: [],
  }
  return {
    org,
    def,
    ref,
    params,
    ids: { status: statusCf.id, amount: amountCf.id, seen: seenCf.id, note: noteCf.id },
  }
}

describe('queryEntityGroupSummary', () => {
  let p: Awaited<ReturnType<typeof setup>>

  /** r0,r1 → opt_z; r2 → 'legacy' (value keyspace of opt_a, grouped as opt_a); r3 → no value. */
  async function seedStatusRows() {
    const rows = await seedInstances(p.org.id, p.def.id, 4)
    const [r0, r1, r2, r3] = rows as [
      (typeof rows)[number],
      (typeof rows)[number],
      (typeof rows)[number],
      (typeof rows)[number],
    ]
    const status = p.ids.status
    const amount = p.ids.amount
    await seedValues(p.org.id, p.def.id, [
      { entityId: r0.id, fieldId: status, optionId: 'opt_z' },
      { entityId: r1.id, fieldId: status, optionId: 'opt_z' },
      { entityId: r2.id, fieldId: status, optionId: 'legacy' },
      { entityId: r0.id, fieldId: amount, valueNumber: 10 },
      { entityId: r1.id, fieldId: amount, valueNumber: 5 },
      { entityId: r3.id, fieldId: amount, valueNumber: 7 },
    ])
    return { r0, r1, r2, r3 }
  }

  beforeEach(async () => {
    p = await setup()
  })

  it('counts and sums per group in option order, the empty group last', async () => {
    await seedStatusRows()
    const result = await queryEntityGroupSummary(db(), {
      ...p.params,
      groupBy: { fieldId: p.ref(p.ids.status) },
      aggregates: { [p.ref(p.ids.amount)]: 'sum' },
    })
    expect(result._unsafeUnwrap()).toEqual({
      groups: [
        { key: 'opt_z', count: 2, aggregates: { [p.ref(p.ids.amount)]: 15 } },
        { key: 'opt_a', count: 1, aggregates: { [p.ref(p.ids.amount)]: null } },
        { key: null, count: 1, aggregates: { [p.ref(p.ids.amount)]: 7 } },
      ],
      hasMoreGroups: false,
    })
  })

  it('desc reverses the groups but keeps the empty group last', async () => {
    await seedStatusRows()
    const result = await queryEntityGroupSummary(db(), {
      ...p.params,
      groupBy: { fieldId: p.ref(p.ids.status), desc: true },
    })
    expect(result._unsafeUnwrap().groups.map((g) => g.key)).toEqual(['opt_a', 'opt_z', null])
  })

  it('one option stored under both keyspaces is one group, keyed by its id', async () => {
    const { r3 } = await seedStatusRows()
    await seedValues(p.org.id, p.def.id, [
      { entityId: r3.id, fieldId: p.ids.status, optionId: 'opt_a' },
    ])
    const result = await queryEntityGroupSummary(db(), {
      ...p.params,
      groupBy: { fieldId: p.ref(p.ids.status) },
    })
    expect(result._unsafeUnwrap().groups.map((g) => [g.key, g.count])).toEqual([
      ['opt_z', 2],
      ['opt_a', 2],
    ])
  })

  it('the visibility predicate removes hidden rows from the counts', async () => {
    const { r0 } = await seedStatusRows()
    const result = await queryEntityGroupSummary(db(), {
      ...p.params,
      groupBy: { fieldId: p.ref(p.ids.status) },
      aggregates: { [p.ref(p.ids.amount)]: 'max' },
      visibilityWhere: ne(schema.EntityInstance.id, r0.id),
    })
    expect(result._unsafeUnwrap().groups[0]).toEqual({
      key: 'opt_z',
      count: 1,
      aggregates: { [p.ref(p.ids.amount)]: 5 },
    })
  })

  it('sets hasMoreGroups past the cap', async () => {
    const rows = await seedInstances(p.org.id, p.def.id, MAX_SUMMARY_GROUPS + 2)
    await seedValues(
      p.org.id,
      p.def.id,
      rows.map((r, i) => ({
        entityId: r.id,
        fieldId: p.ids.seen,
        valueDate: new Date(Date.UTC(2024, 0, 1) + i * 86_400_000).toISOString(),
      }))
    )
    const result = await queryEntityGroupSummary(db(), {
      ...p.params,
      groupBy: { fieldId: p.ref(p.ids.seen), dateGranularity: 'day' },
      timezone: 'UTC',
    })
    const value = result._unsafeUnwrap()
    expect(value.hasMoreGroups).toBe(true)
    expect(value.groups).toHaveLength(MAX_SUMMARY_GROUPS)
    // Kept in group order: the first days, not an arbitrary 500.
    expect(value.groups[0]?.key).toBe('2024-01-01')
  })

  it('buckets DATETIME in the viewer timezone', async () => {
    const [r] = await seedInstances(p.org.id, p.def.id, 1)
    await seedValues(p.org.id, p.def.id, [
      { entityId: r!.id, fieldId: p.ids.seen, valueDate: '2026-03-01T23:30:00.000Z' },
    ])
    const inZone = async (timezone: string) =>
      (
        await queryEntityGroupSummary(db(), {
          ...p.params,
          groupBy: { fieldId: p.ref(p.ids.seen) },
          timezone,
        })
      )._unsafeUnwrap().groups[0]?.key
    expect(await inZone('UTC')).toBe('2026-03-01')
    expect(await inZone('Europe/Berlin')).toBe('2026-03-02')
  })

  it('refuses an ineligible group field or aggregate column as an err', async () => {
    const byText = await queryEntityGroupSummary(db(), {
      ...p.params,
      groupBy: { fieldId: p.ref(p.ids.note) },
    })
    expect(byText._unsafeUnwrapErr()).toBeInstanceOf(UnprocessableEntityError)

    const sumText = await queryEntityGroupSummary(db(), {
      ...p.params,
      groupBy: { fieldId: p.ref(p.ids.status) },
      aggregates: { [p.ref(p.ids.note)]: 'sum' },
    })
    expect(sumText._unsafeUnwrapErr()).toBeInstanceOf(UnprocessableEntityError)
  })

  it('the grouped list page agrees with the summary order and honours collapsed groups', async () => {
    const { r0, r1, r2, r3 } = await seedStatusRows()
    const page = await queryEntityInstanceIdsPaged({
      db: db(),
      ...p.params,
      sorting: [{ id: p.ref(p.ids.amount), desc: true }],
      limit: 10,
      offset: 0,
      includeTotal: true,
      groupBy: { fieldId: p.ref(p.ids.status) },
    })
    expect(page.ids).toEqual([r0.id, r1.id, r2.id, r3.id])
    expect(page.groupKeys).toEqual(['opt_z', 'opt_z', 'opt_a', null])
    expect(page.total).toBe(4)

    const collapsed = await queryEntityInstanceIdsPaged({
      db: db(),
      ...p.params,
      sorting: [],
      limit: 10,
      offset: 0,
      includeTotal: true,
      groupBy: { fieldId: p.ref(p.ids.status) },
      excludeGroupKeys: ['opt_z', '__empty__'],
    })
    expect(collapsed.ids).toEqual([r2.id])
    expect(collapsed.groupKeys).toEqual(['opt_a'])
    expect(collapsed.total).toBe(1)

    const keepsEmpty = await queryEntityInstanceIdsPaged({
      db: db(),
      ...p.params,
      sorting: [],
      limit: 10,
      offset: 0,
      includeTotal: true,
      groupBy: { fieldId: p.ref(p.ids.status) },
      excludeGroupKeys: ['opt_z'],
    })
    expect(keepsEmpty.groupKeys).toEqual(['opt_a', null])
    expect(keepsEmpty.total).toBe(2)
  })
})
