// packages/lib/src/resources/crud/__tests__/delete-closure.test.ts
//
// `collectDeleteClosure` and `findRestrictViolations` against a fake database
// that INTERPRETS the queries: `drizzle-orm`'s `eq` / `inArray` / `and` are
// mocked to plain descriptors and the schema proxy yields column names, so the
// fake can answer each statement from an in-memory `EntityInstance` +
// `FieldValue` fixture and record what was asked. That is what lets these
// tests pin the round-trip count, not just the result.
//
// The fixture holds CHILD-side rows only (`entityId` = child, `relatedEntityId`
// = parent), which is the half the module reads; a parent-side mirror row is
// never consulted, so none is written here.

import { beforeEach, describe, expect, it, vi } from 'vitest'

// Built inside the factory: `vi.mock` is hoisted above the imports, and the
// static import of the module under test runs the factory before any
// top-level const of this file is initialized.
vi.mock('@auxx/database', () => ({
  database: {},
  schema: new Proxy(
    {},
    {
      get: (_target, table) =>
        new Proxy({}, { get: (_t, column) => `${String(table)}.${String(column)}` }),
    }
  ),
}))

type Cond =
  | { type: 'eq'; col: string; val: unknown }
  | { type: 'inArray'; col: string; vals: unknown[] }
  | { type: 'and'; conds: Cond[] }

vi.mock('drizzle-orm', () => ({
  eq: (col: string, val: unknown): Cond => ({ type: 'eq', col, val }),
  inArray: (col: string, vals: unknown[]): Cond => ({ type: 'inArray', col, vals }),
  and: (...conds: Cond[]): Cond => ({ type: 'and', conds }),
  count: () => 'count',
}))

const h = vi.hoisted(() => ({
  /** entityDefinitionId -> CustomField rows. */
  fields: new Map<string, unknown[]>(),
  resources: [] as Array<{ entityDefinitionId: string; apiSlug: string; label: string }>,
}))

vi.mock('../../../cache', () => ({
  getCachedCustomFields: async (_org: string, defId: string) => h.fields.get(defId) ?? [],
  getCachedResources: async () => h.resources,
}))

import { ConflictError } from '../../../errors'
import { collectDeleteClosure, findRestrictViolations } from '../delete-closure'

interface Instance {
  id: string
  entityDefinitionId: string
}
interface Value {
  entityId: string
  fieldId: string
  relatedEntityId: string
}
interface Query {
  kind: 'resolve' | 'cascade' | 'restrict'
  fieldId?: string
  ids: string[]
}

function flatten(cond: Cond | undefined): Cond[] {
  if (!cond) return []
  return cond.type === 'and' ? cond.conds.flatMap(flatten) : [cond]
}

/**
 * A database holding `instances` and `values`, answering the three statement
 * shapes the module issues and logging each one.
 */
function fakeDb(fixture: { instances: Instance[]; values: Value[] }) {
  const queries: Query[] = []
  const instanceById = new Map(fixture.instances.map((row) => [row.id, row]))

  const run = (projection: Record<string, unknown>, where: Cond) => {
    const conds = flatten(where)
    const idsOf = (col: string) =>
      (conds.find((c) => c.type === 'inArray' && c.col === col) as { vals: string[] } | undefined)
        ?.vals ?? []
    const eqOf = (col: string) =>
      (conds.find((c) => c.type === 'eq' && c.col === col) as { val: unknown } | undefined)?.val

    if ('childId' in projection) {
      const fieldId = eqOf('FieldValue.fieldId') as string
      const ids = idsOf('FieldValue.relatedEntityId')
      queries.push({ kind: 'cascade', fieldId, ids })
      return fixture.values
        .filter((v) => v.fieldId === fieldId && ids.includes(v.relatedEntityId))
        .flatMap((v) => {
          const child = instanceById.get(v.entityId)
          return child
            ? [
                {
                  parentId: v.relatedEntityId,
                  childId: v.entityId,
                  childDefId: child.entityDefinitionId,
                },
              ]
            : []
        })
    }

    if ('related' in projection) {
      const fieldId = eqOf('FieldValue.fieldId') as string
      const ids = idsOf('FieldValue.relatedEntityId')
      queries.push({ kind: 'restrict', fieldId, ids })
      const counts = new Map<string, number>()
      for (const v of fixture.values) {
        if (v.fieldId !== fieldId || !ids.includes(v.relatedEntityId)) continue
        if (!instanceById.has(v.entityId)) continue
        counts.set(v.relatedEntityId, (counts.get(v.relatedEntityId) ?? 0) + 1)
      }
      return [...counts].map(([parentId, related]) => ({ parentId, related }))
    }

    const ids = idsOf('EntityInstance.id')
    queries.push({ kind: 'resolve', ids })
    return fixture.instances.filter((row) => ids.includes(row.id))
  }

  const db = {
    select: (projection: Record<string, unknown>) => {
      const chain = {
        from: () => chain,
        innerJoin: () => chain,
        where: (where: Cond) => {
          const rows = run(projection, where)
          // Awaitable directly, or after `.groupBy()` for the grouped count.
          return Object.assign(Promise.resolve(rows), { groupBy: () => Promise.resolve(rows) })
        },
      }
      return chain
    },
  }

  return { db: db as never, queries }
}

/**
 * A RELATIONSHIP CustomField row, as the org cache holds it. The inverse is
 * stored as `<EntityDefinition.id>:<CustomField.id>`, the format every writer
 * uses; by convention here the inverse of `f_x` on `target` is `inv_f_x`.
 */
function relation(
  id: string,
  name: string,
  target: string,
  opts: {
    type?: 'has_many' | 'has_one' | 'belongs_to'
    onDelete?: string
    inverse?: string | null
  } = {}
) {
  return {
    id,
    name,
    type: 'RELATIONSHIP',
    options: {
      relationship: {
        relationshipType: opts.type ?? 'has_many',
        isInverse: false,
        inverseResourceFieldId:
          opts.inverse === null ? null : `${target}:${opts.inverse ?? `inv_${id}`}`,
        ...(opts.onDelete ? { onDelete: opts.onDelete } : {}),
      },
    },
  }
}

/** The child-side `belongs_to` field that `relation(id, …, target)` points at. */
function inverseOf(id: string, name: string, parentDef: string) {
  return relation(`inv_${id}`, name, parentDef, { type: 'belongs_to', inverse: id })
}

/** A child-side row: `child` names `parent` through the child's field. */
const value = (child: string, fieldId: string, parent: string): Value => ({
  entityId: child,
  fieldId,
  relatedEntityId: parent,
})

/**
 * Two orders. Order 1 owns two lines and a credit memo with two memo lines;
 * order 2 owns one line and a tax line. Both belong to a contact, and order 1
 * also names a build through a relationship with no `onDelete` at all.
 */
function orderFixture() {
  h.fields.set('def_orders', [
    relation('f_lines', 'Line items', 'def_lines', { onDelete: 'cascade' }),
    relation('f_credit_memos', 'Credit memos', 'def_credit_memos', { onDelete: 'cascade' }),
    relation('f_tax', 'Tax lines', 'def_tax', { onDelete: 'cascade' }),
    // Declared on the wrong side: a child cannot cascade its parent.
    relation('f_contact', 'Contact', 'def_contacts', { type: 'belongs_to', onDelete: 'cascade' }),
    // No declaration at all: unlink, which the relation sweep already does.
    relation('f_builds', 'Builds', 'def_builds'),
    { id: 'f_number', name: 'Number', type: 'TEXT', options: null },
  ])
  h.fields.set('def_credit_memos', [
    inverseOf('f_credit_memos', 'Order', 'def_orders'),
    relation('f_memo_lines', 'Credit memo lines', 'def_memo_lines', { onDelete: 'cascade' }),
  ])
  h.fields.set('def_lines', [inverseOf('f_lines', 'Order', 'def_orders')])
  h.fields.set('def_tax', [inverseOf('f_tax', 'Order', 'def_orders')])
  h.fields.set('def_memo_lines', [inverseOf('f_memo_lines', 'Credit memo', 'def_credit_memos')])
  h.fields.set('def_contacts', [
    relation('inv_f_contact', 'Orders', 'def_orders', { inverse: 'f_contact' }),
  ])
  h.fields.set('def_builds', [inverseOf('f_builds', 'Order', 'def_orders')])
  return fakeDb({
    instances: [
      { id: 'o1', entityDefinitionId: 'def_orders' },
      { id: 'o2', entityDefinitionId: 'def_orders' },
      { id: 'l1', entityDefinitionId: 'def_lines' },
      { id: 'l2', entityDefinitionId: 'def_lines' },
      { id: 'l3', entityDefinitionId: 'def_lines' },
      { id: 'cm1', entityDefinitionId: 'def_credit_memos' },
      { id: 'cml1', entityDefinitionId: 'def_memo_lines' },
      { id: 'cml2', entityDefinitionId: 'def_memo_lines' },
      { id: 't1', entityDefinitionId: 'def_tax' },
      { id: 'c1', entityDefinitionId: 'def_contacts' },
      { id: 'b1', entityDefinitionId: 'def_builds' },
    ],
    values: [
      value('l1', 'inv_f_lines', 'o1'),
      value('l2', 'inv_f_lines', 'o1'),
      value('l3', 'inv_f_lines', 'o2'),
      value('cm1', 'inv_f_credit_memos', 'o1'),
      value('cml1', 'inv_f_memo_lines', 'cm1'),
      value('cml2', 'inv_f_memo_lines', 'cm1'),
      value('t1', 'inv_f_tax', 'o2'),
      value('c1', 'inv_f_contact', 'o1'),
      value('c1', 'inv_f_contact', 'o2'),
      value('b1', 'inv_f_builds', 'o1'),
    ],
  })
}

const params = (recordIds: string[]) => ({ organizationId: 'org_1', recordIds }) as never

beforeEach(() => {
  h.fields.clear()
  h.resources = [
    { entityDefinitionId: 'def_orders', apiSlug: 'orders', label: 'Order' },
    { entityDefinitionId: 'def_lines', apiSlug: 'line-items', label: 'Line item' },
    { entityDefinitionId: 'def_credit_memos', apiSlug: 'credit-memos', label: 'Credit memo' },
    {
      entityDefinitionId: 'def_memo_lines',
      apiSlug: 'credit-memo-lines',
      label: 'Credit memo line',
    },
    { entityDefinitionId: 'def_tax', apiSlug: 'tax-lines', label: 'Tax line' },
    { entityDefinitionId: 'def_moves', apiSlug: 'stock-movements', label: 'Stock movement' },
  ]
})

describe('collectDeleteClosure', () => {
  it('collects an order tree two levels deep, one query per (definition, field) per level, deepest first', async () => {
    const { db, queries } = orderFixture()

    const result = await collectDeleteClosure(db, params(['def_orders:o1', 'def_orders:o2']))

    expect(result.isOk()).toBe(true)
    const { groups, notFound } = result._unsafeUnwrap()
    expect(notFound).toEqual([])
    expect(
      groups.map((g) => [g.apiSlug, g.depth, g.records.map((r) => r.entityInstanceId)])
    ).toEqual([
      ['credit-memo-lines', 2, ['cml1', 'cml2']],
      ['line-items', 1, ['l1', 'l2', 'l3']],
      ['credit-memos', 1, ['cm1']],
      ['tax-lines', 1, ['t1']],
      ['orders', 0, ['o1', 'o2']],
    ])
    // The belongs_to and the undeclared relationship were not followed.
    const collected = groups.flatMap((g) => g.records.map((r) => r.entityInstanceId))
    expect(collected).not.toContain('c1')
    expect(collected).not.toContain('b1')

    // 1 resolve + 3 (order fields) at level 1 + 1 (credit memo field) at level 2,
    // each read through the CHILD's field. Lines and tax lines have no cascade
    // fields, so level 2 asks nothing of them.
    expect(queries.map((q) => [q.kind, q.fieldId ?? null])).toEqual([
      ['resolve', null],
      ['cascade', 'inv_f_lines'],
      ['cascade', 'inv_f_credit_memos'],
      ['cascade', 'inv_f_tax'],
      ['cascade', 'inv_f_memo_lines'],
    ])
  })

  it('records the parent each cascaded record was collected through, and keeps requested ids as written', async () => {
    const { db } = orderFixture()

    const { groups } = (await collectDeleteClosure(db, params(['orders:o1'])))._unsafeUnwrap()

    const byId = new Map(groups.flatMap((g) => g.records).map((r) => [r.entityInstanceId, r]))
    // The caller's slug-keyed spelling survives on the requested record.
    expect(byId.get('o1')).toMatchObject({ recordId: 'orders:o1', requestedBy: null, depth: 0 })
    // Cascaded records carry the canonical definition id and their parent.
    expect(byId.get('l1')).toMatchObject({
      recordId: 'def_lines:l1',
      requestedBy: 'orders:o1',
      depth: 1,
    })
    expect(byId.get('cml1')).toMatchObject({ requestedBy: 'def_credit_memos:cm1', depth: 2 })
  })

  it('a record reached twice appears once and keeps the greater depth, staying a root if requested', async () => {
    const { db } = orderFixture()

    const { groups } = (
      await collectDeleteClosure(db, params(['def_lines:l1', 'def_orders:o1']))
    )._unsafeUnwrap()

    const lines = groups.find((g) => g.apiSlug === 'line-items')!
    const l1 = lines.records.filter((r) => r.entityInstanceId === 'l1')
    expect(l1).toHaveLength(1)
    expect(l1[0]).toMatchObject({ recordId: 'def_lines:l1', requestedBy: null, depth: 1 })
    // And the lines group still sorts ahead of the orders group.
    expect(groups.map((g) => g.apiSlug).indexOf('line-items')).toBeLessThan(
      groups.map((g) => g.apiSlug).indexOf('orders')
    )
  })

  it('terminates on a self-referential cascade, even a cyclic one', async () => {
    // Only the child-side (`parent_movement`) rows exist, which is exactly
    // how the stored self-relation pairs were written.
    h.fields.set('def_moves', [
      relation('f_children', 'Child movements', 'def_moves', { onDelete: 'cascade' }),
      inverseOf('f_children', 'Parent movement', 'def_moves'),
    ])
    const { db, queries } = fakeDb({
      instances: [
        { id: 'm1', entityDefinitionId: 'def_moves' },
        { id: 'm2', entityDefinitionId: 'def_moves' },
        { id: 'm3', entityDefinitionId: 'def_moves' },
      ],
      values: [
        value('m2', 'inv_f_children', 'm1'),
        value('m3', 'inv_f_children', 'm2'),
        value('m1', 'inv_f_children', 'm3'),
      ],
    })

    const { groups } = (await collectDeleteClosure(db, params(['def_moves:m1'])))._unsafeUnwrap()

    expect(groups).toHaveLength(1)
    expect(groups[0]?.records.map((r) => r.entityInstanceId).sort()).toEqual(['m1', 'm2', 'm3'])
    // One resolve, then one cascade query per level until the frontier is empty.
    expect(queries.map((q) => q.kind)).toEqual(['resolve', 'cascade', 'cascade', 'cascade'])
  })

  it('collects nothing, and does not throw, for a cascade field whose target has no EntityInstance rows', async () => {
    // Some registry relationships describe Drizzle tables rather than
    // FieldValue-backed records; the join on EntityInstance yields no rows.
    h.fields.set('def_orders', [
      relation('f_messages', 'Messages', 'def_messages', { onDelete: 'cascade' }),
    ])
    h.fields.set('def_messages', [inverseOf('f_messages', 'Order', 'def_orders')])
    const { db } = fakeDb({
      instances: [{ id: 'o1', entityDefinitionId: 'def_orders' }],
      values: [value('msg_1', 'inv_f_messages', 'o1')],
    })

    const result = await collectDeleteClosure(db, params(['def_orders:o1']))

    expect(result.isOk()).toBe(true)
    const { groups } = result._unsafeUnwrap()
    expect(groups).toHaveLength(1)
    expect(groups[0]?.records.map((r) => r.entityInstanceId)).toEqual(['o1'])
  })

  it('skips a cascade edge whose inverse field cannot be resolved, asking nothing for it', async () => {
    // The seeder leaves a `user`-typed inverse null, and a field can drop out
    // of the cache; either way the edge is skipped, which cascades nothing.
    h.fields.set('def_orders', [
      relation('f_owner', 'Owner', 'user', { onDelete: 'cascade', inverse: null }),
      relation('f_ghosts', 'Ghosts', 'def_ghosts', { onDelete: 'cascade' }),
      relation('f_lines', 'Line items', 'def_lines', { onDelete: 'cascade' }),
    ])
    h.fields.set('def_lines', [inverseOf('f_lines', 'Order', 'def_orders')])
    const { db, queries } = fakeDb({
      instances: [
        { id: 'o1', entityDefinitionId: 'def_orders' },
        { id: 'l1', entityDefinitionId: 'def_lines' },
      ],
      values: [value('l1', 'inv_f_lines', 'o1')],
    })

    const { groups } = (await collectDeleteClosure(db, params(['def_orders:o1'])))._unsafeUnwrap()

    expect(groups.flatMap((g) => g.records.map((r) => r.entityInstanceId)).sort()).toEqual([
      'l1',
      'o1',
    ])
    expect(queries.map((q) => [q.kind, q.fieldId ?? null])).toEqual([
      ['resolve', null],
      ['cascade', 'inv_f_lines'],
    ])
  })

  it('reports requested ids that resolve to nothing, and dedupes the request', async () => {
    const { db } = orderFixture()

    const { groups, notFound } = (
      await collectDeleteClosure(db, params(['def_orders:o1', 'def_orders:o1', 'def_orders:ghost']))
    )._unsafeUnwrap()

    expect(notFound).toEqual(['def_orders:ghost'])
    expect(
      groups.find((g) => g.apiSlug === 'orders')?.records.map((r) => r.entityInstanceId)
    ).toEqual(['o1'])
  })

  it('chunks the ids of one statement at 500', async () => {
    const ids = Array.from({ length: 501 }, (_, i) => `c${i}`)
    const { db, queries } = fakeDb({
      instances: ids.map((id) => ({ id, entityDefinitionId: 'def_contacts' })),
      values: [],
    })

    await collectDeleteClosure(db, params(ids.map((id) => `def_contacts:${id}`)))

    expect(queries.map((q) => [q.kind, q.ids.length])).toEqual([
      ['resolve', 500],
      ['resolve', 1],
    ])
  })

  it('returns err rather than throwing when a statement fails', async () => {
    const db = {
      select: () => {
        throw new Error('connection reset')
      },
    }

    const result = await collectDeleteClosure(db as never, params(['def_orders:o1']))

    expect(result.isErr()).toBe(true)
    expect(result._unsafeUnwrapErr().message).toBe('connection reset')
  })
})

describe('findRestrictViolations', () => {
  const orderGroups = [
    {
      entityDefinitionId: 'def_orders',
      apiSlug: 'orders',
      depth: 0,
      records: [
        { recordId: 'def_orders:o1', entityInstanceId: 'o1', requestedBy: null, depth: 0 },
        { recordId: 'def_orders:o2', entityInstanceId: 'o2', requestedBy: null, depth: 0 },
      ],
    },
  ] as never

  it('refuses a record with related rows through a restrict field, with a 409 built from the labels', async () => {
    h.fields.set('def_orders', [
      relation('f_builds', 'Builds', 'def_builds', { onDelete: 'restrict' }),
    ])
    h.fields.set('def_builds', [inverseOf('f_builds', 'Order', 'def_orders')])
    const { db, queries } = fakeDb({
      instances: [
        { id: 'o1', entityDefinitionId: 'def_orders' },
        { id: 'o2', entityDefinitionId: 'def_orders' },
        { id: 'b1', entityDefinitionId: 'def_builds' },
        { id: 'b2', entityDefinitionId: 'def_builds' },
      ],
      values: [value('b1', 'inv_f_builds', 'o1'), value('b2', 'inv_f_builds', 'o1')],
    })

    const violations = (
      await findRestrictViolations(db, { organizationId: 'org_1', groups: orderGroups })
    )._unsafeUnwrap()

    expect([...violations.keys()]).toEqual(['def_orders:o1'])
    const violation = violations.get('def_orders:o1' as never)!
    expect(violation).toMatchObject({ fieldLabel: 'builds', count: 2 })
    expect(violation.error).toBeInstanceOf(ConflictError)
    expect(violation.error.statusCode).toBe(409)
    expect(violation.error.message).toBe(
      'This order has 2 builds. Remove them first, or archive the order instead.'
    )
    // One grouped count for the whole definition, not one per record.
    expect(queries.map((q) => [q.kind, q.fieldId])).toEqual([['restrict', 'inv_f_builds']])
  })

  it('passes a record with no related rows, and ignores a dangling mirror row', async () => {
    h.fields.set('def_orders', [
      relation('f_builds', 'Builds', 'def_builds', { onDelete: 'restrict' }),
    ])
    h.fields.set('def_builds', [inverseOf('f_builds', 'Order', 'def_orders')])
    const { db } = fakeDb({
      instances: [
        { id: 'o1', entityDefinitionId: 'def_orders' },
        { id: 'o2', entityDefinitionId: 'def_orders' },
      ],
      // The build this row belongs to no longer exists: an older delete path left it.
      values: [value('b_gone', 'inv_f_builds', 'o1')],
    })

    const violations = (
      await findRestrictViolations(db, { organizationId: 'org_1', groups: orderGroups })
    )._unsafeUnwrap()

    expect(violations.size).toBe(0)
  })

  it('reads restrict only on the owning side, and asks nothing of a definition without one', async () => {
    h.fields.set('def_orders', [
      relation('f_contact', 'Contact', 'def_contacts', {
        type: 'belongs_to',
        onDelete: 'restrict',
      }),
      relation('f_lines', 'Line items', 'def_lines', { onDelete: 'cascade' }),
    ])
    h.fields.set('def_lines', [inverseOf('f_lines', 'Order', 'def_orders')])
    const { db, queries } = fakeDb({
      instances: [
        { id: 'o1', entityDefinitionId: 'def_orders' },
        { id: 'c1', entityDefinitionId: 'def_contacts' },
      ],
      values: [value('o1', 'f_contact', 'c1')],
    })

    const violations = (
      await findRestrictViolations(db, { organizationId: 'org_1', groups: orderGroups })
    )._unsafeUnwrap()

    expect(violations.size).toBe(0)
    expect(queries).toEqual([])
  })
})
