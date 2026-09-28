// packages/lib/src/resources/crud/__tests__/list-filtered-group-keys.test.ts
//
// `queryEntityInstanceIdsPaged` with a group-by (plans/table/group-by-plan.md §4.3):
// group keys ride parallel to ids, collapsed groups leave page AND total, the sort
// follows the group order, and an ungrouped query renders exactly as before.

import { toFieldId, toResourceFieldId } from '@auxx/types/field'
import { type SQL, sql } from 'drizzle-orm'
import { PgDialect } from 'drizzle-orm/pg-core'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// A real (connection-less) EntityInstance so column refs render; every other table
// stays the default memoized `{}`.
vi.mock('@auxx/database', async () => {
  const { pgTable, text, timestamp } = await import('drizzle-orm/pg-core')
  const EntityInstance = pgTable('EntityInstance', {
    id: text().primaryKey(),
    createdAt: timestamp({ precision: 3 }),
    updatedAt: timestamp({ precision: 3 }),
    archivedAt: timestamp({ precision: 3, withTimezone: true }),
    entityDefinitionId: text(),
    organizationId: text(),
    displayName: text(),
  })
  const tables: Record<string, object> = { EntityInstance }
  return {
    database: {},
    schema: new Proxy(tables, {
      get: (target, key: string) => {
        if (!(key in target)) target[key] = {}
        return target[key]
      },
    }),
  }
})

const fields = vi.hoisted(() => ({ current: [] as unknown[] }))

// Full factory, never `importOriginal` + spread — see list-filtered-dropped-conditions.test.ts.
vi.mock('../../../cache', () => ({
  getCachedResourceFields: vi.fn(async () => fields.current),
  findCachedResource: vi.fn(async () => undefined),
  getCachedEntityDefId: vi.fn(async () => undefined),
  getOrgCache: vi.fn(() => ({ get: vi.fn(async () => ({})) })),
  getCachedMembers: vi.fn(async () => []),
  getCachedAgents: vi.fn(async () => []),
  getCachedGroups: vi.fn(async () => []),
}))

import { BaseType } from '../../../workflow-engine/core/types'
import { queryEntityInstanceIdsPaged } from '../unified-handler-queries'

const DEF = 'edf000000000000000000001'
const caps = { filterable: true, sortable: true, creatable: true, updatable: true }
const mkField = (id: string, fieldType: string, type: BaseType, extra = {}) => ({
  id: toFieldId(id),
  resourceFieldId: toResourceFieldId(DEF, id),
  key: id,
  label: id,
  type,
  fieldType,
  capabilities: caps,
  ...extra,
})

const STATUS = toResourceFieldId(DEF, 'status')
const AMOUNT = toResourceFieldId(DEF, 'amount')

/** Drizzle stand-in: records select shape, where and orderBy per chain; each chain is a thenable. */
function fakeDb(...results: unknown[][]) {
  const calls: Array<{ select: Record<string, unknown>; where?: SQL; orderBy?: SQL[] }> = []
  const chain = (select: Record<string, unknown>, result: unknown[]) => {
    const call: (typeof calls)[number] = { select }
    calls.push(call)
    const c: Record<string, unknown> = {}
    c.from = () => c
    c.where = (w: SQL) => {
      call.where = w
      return c
    }
    c.orderBy = (...o: SQL[]) => {
      call.orderBy = o
      return c
    }
    c.limit = () => c
    c.offset = () => c
    // biome-ignore lint/suspicious/noThenProperty: a Drizzle builder IS a thenable; faking it needs `then`
    c.then = (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) =>
      Promise.resolve(result).then(res, rej)
    return c
  }
  let n = 0
  return {
    db: { select: (s: Record<string, unknown>) => chain(s, results[n++] ?? []) } as never,
    calls,
  }
}

const dialect = new PgDialect()
const render = (parts: SQL | SQL[] | undefined) =>
  parts ? dialect.sqlToQuery(Array.isArray(parts) ? sql.join(parts, sql`, `) : parts) : undefined

const base = {
  entityDefinitionId: DEF,
  organizationId: 'org_1',
  filters: [],
  sorting: [] as Array<{ id: string; desc: boolean }>,
  limit: 2,
  offset: 0,
}

beforeEach(() => {
  fields.current = [
    mkField('status', 'SINGLE_SELECT', BaseType.ENUM, {
      options: { options: [{ id: 'opt_a', value: 'a', label: 'A' }] },
    }),
    mkField('amount', 'NUMBER', BaseType.NUMBER),
  ]
})

describe('queryEntityInstanceIdsPaged — group keys', () => {
  it('returns groupKeys parallel to ids, the probe row excluded', async () => {
    const { db, calls } = fakeDb(
      [
        { id: 'r1', groupKey: 'opt_a' },
        { id: 'r2', groupKey: null },
        { id: 'r3', groupKey: null },
      ],
      [{ count: 3 }]
    )
    const r = await queryEntityInstanceIdsPaged({
      ...base,
      db,
      includeTotal: true,
      groupBy: { fieldId: STATUS },
    })
    expect(r).toMatchObject({ ids: ['r1', 'r2'], groupKeys: ['opt_a', null], hasMore: true })
    expect(r.total).toBe(3)
    expect(Object.keys(calls[0]!.select)).toEqual(['id', 'groupKey'])
  })

  it('has no groupKeys without groupBy', async () => {
    const { db, calls } = fakeDb([{ id: 'r1' }])
    const r = await queryEntityInstanceIdsPaged({ ...base, db })
    expect(r).toEqual({ ids: ['r1'], hasMore: false })
    expect(Object.keys(calls[0]!.select)).toEqual(['id'])
  })

  it('excludeGroupKeys narrows the page and the total through the shared WHERE', async () => {
    const { db, calls } = fakeDb([{ id: 'r1', groupKey: 'opt_a' }], [{ count: 1 }])
    await queryEntityInstanceIdsPaged({
      ...base,
      db,
      includeTotal: true,
      groupBy: { fieldId: STATUS },
      excludeGroupKeys: ['opt_b', '__empty__'],
    })
    const page = render(calls[0]!.where)!
    const count = render(calls[1]!.where)!
    expect(page.sql).toContain('IS NOT NULL AND NOT (')
    expect(page.sql).toContain('= ANY(ARRAY[')
    expect(page.params).toContain('opt_b')
    expect(count).toEqual(page)
  })

  it('orders by group rank, group key, the sort, then id', async () => {
    const { db, calls } = fakeDb([])
    await queryEntityInstanceIdsPaged({
      ...base,
      db,
      sorting: [{ id: AMOUNT, desc: true }],
      groupBy: { fieldId: STATUS, desc: true },
    })
    const order = calls[0]!.orderBy!.map((o) => render(o)!.sql)
    expect(order).toHaveLength(4)
    expect(order[0]).toMatch(/^array_position\(ARRAY\[/)
    expect(order[0]).toMatch(/DESC NULLS LAST$/)
    expect(order[1]).toMatch(/"FieldValue"."optionId"[\s\S]*\)::text DESC NULLS LAST$/)
    expect(order[2]).toContain('"FieldValue"."valueNumber"')
    expect(order[3]).toBe('"EntityInstance"."id" asc')
  })

  it('grouped without a sort falls back to newest first inside each group', async () => {
    const { db, calls } = fakeDb([])
    await queryEntityInstanceIdsPaged({ ...base, db, groupBy: { fieldId: STATUS } })
    const order = calls[0]!.orderBy!.map((o) => render(o)!.sql)
    expect(order.slice(2)).toEqual([
      '"EntityInstance"."createdAt" desc',
      '"EntityInstance"."id" asc',
    ])
  })

  it('refuses an ineligible group field', async () => {
    const { db } = fakeDb([])
    await expect(
      queryEntityInstanceIdsPaged({ ...base, db, groupBy: { fieldId: AMOUNT } })
    ).rejects.toThrow(/cannot be grouped by/)
  })
})

describe('queryEntityInstanceIdsPaged — ungrouped SQL is unchanged', () => {
  const WHERE =
    '("EntityInstance"."entityDefinitionId" = $1 and "EntityInstance"."organizationId" = $2 and "EntityInstance"."archivedAt" is null)'

  it('sorted', async () => {
    const { db, calls } = fakeDb([], [{ count: 0 }])
    await queryEntityInstanceIdsPaged({
      ...base,
      db,
      includeTotal: true,
      sorting: [{ id: AMOUNT, desc: false }],
    })
    expect(Object.keys(calls[0]!.select)).toEqual(['id'])
    expect(render(calls[0]!.where)!.sql).toBe(WHERE)
    expect(render(calls[1]!.where)!.sql).toBe(WHERE)
    expect(render(calls[0]!.orderBy)!.sql).toBe(
      `(
      SELECT "FieldValue"."valueNumber"
      FROM "FieldValue"
      WHERE "FieldValue"."entityId" = "EntityInstance"."id"
        AND "FieldValue"."fieldId" = $1
      ORDER BY "FieldValue"."sortKey" ASC
      LIMIT 1
    ) ASC NULLS LAST, "EntityInstance"."id" asc`
    )
  })

  it('unsorted, and excludeGroupKeys without a groupBy is inert', async () => {
    const plain = fakeDb([])
    await queryEntityInstanceIdsPaged({ ...base, db: plain.db })
    const withExclude = fakeDb([])
    await queryEntityInstanceIdsPaged({
      ...base,
      db: withExclude.db,
      excludeGroupKeys: ['x'],
      timezone: 'UTC',
    })
    for (const { calls } of [plain, withExclude]) {
      expect(Object.keys(calls[0]!.select)).toEqual(['id'])
      expect(render(calls[0]!.where)!.sql).toBe(WHERE)
      expect(render(calls[0]!.orderBy)!.sql).toBe(
        '"EntityInstance"."createdAt" desc, "EntityInstance"."id" asc'
      )
    }
  })
})
