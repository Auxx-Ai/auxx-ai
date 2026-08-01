// packages/lib/src/resources/crud/__tests__/list-filtered-dropped-conditions.test.ts
//
// `ListFilteredResult.droppedConditions` — the observability channel for this
// lane's deliberate fail-open.
//
// A filter condition the builder cannot compile is DROPPED and the query runs
// anyway, so the list silently widens. That is the right call for saved views,
// the mail list, unread counts and the workflow Find node, all of which depend on
// `baseScope` for a genuine empty filter — but it made the failure invisible by
// construction, and four separate fail-open bugs hid behind it (KB free-text
// search, the KB Tag/Status/Kind filters, dashboard thread widgets, and an
// unknown operator compiling to `eq(col, value)`).
//
// Four properties, and all four are the point:
//
//   1. Both lanes report. The `EntityInstance` path and the system-table path are
//      separate functions with separate builders; a UI must not have to branch on
//      which one served it, so the SHAPE is asserted identical for both.
//   2. Strictly additive. A clean build must not put the keys on the response at
//      all — an existing caller spreading the result must see no shape change.
//   3. Bounded. A pathological filter set must not put an unbounded array on
//      every list response, and the COUNT must stay exact past the cap so a UI
//      that renders it never *undercounts* what it is warning about.
//   4. It never changes the SQL. Reporting a drop must not also start filtering
//      on it — the whole contract is "widened, and said so".

import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../../cache', () => ({
  getCachedResourceFields: vi.fn(async () => []),
  findCachedResource: vi.fn(async () => undefined),
  getCachedEntityDefId: vi.fn(async () => undefined),
  getOrgCache: vi.fn(() => ({ get: vi.fn(async () => ({})) })),
}))

/** Diagnostics the two builder mocks below hand back, swapped per test. */
const entityBuild = {
  sql: undefined as unknown,
  requestedConditions: 0,
  droppedConditions: [] as unknown[],
  allConditionsDropped: false,
}
const systemBuild = {
  sql: undefined as unknown,
  requestedConditions: 0,
  droppedConditions: [] as unknown[],
  allConditionsDropped: false,
}

vi.mock('../../query-builder/entity-condition-builder', () => ({
  entityConditionBuilder: {
    buildGroupedQueryWithDiagnostics: vi.fn(() => entityBuild),
    buildOrderBySql: vi.fn(() => undefined),
  },
}))

vi.mock('../../query-builder/system-condition-builder', () => ({
  systemConditionBuilder: {
    buildGroupedQueryWithDiagnostics: vi.fn(() => systemBuild),
    buildOrderBySql: vi.fn(() => undefined),
  },
}))

import {
  MAX_REPORTED_DROPPED_CONDITIONS,
  queryEntityInstanceIdsPaged,
  querySystemResourceIdsPaged,
} from '../unified-handler-queries'

/** One internal drop record, in the shape `BaseConditionBuilder` produces. */
function drop(n: number) {
  return {
    conditionId: `cond_${n}`,
    fieldRef: `article:field_${n}`,
    operator: 'equals',
    reason: 'unresolved-field-or-operator' as const,
    // Builder internals — the class name that gave up. Must NOT reach a client.
    detail: 'SystemConditionBuilder',
  }
}

function setDrops(target: typeof entityBuild, drops: ReturnType<typeof drop>[]) {
  target.droppedConditions = drops
  target.requestedConditions = drops.length
  target.allConditionsDropped = drops.length > 0
}

/** Drizzle stand-in that records every `where()` argument; each chain is a thenable. */
function fakeDb(...results: unknown[][]) {
  const wheres: unknown[] = []
  const chain = (result: unknown[]) => {
    const c: Record<string, unknown> = {}
    c.from = () => c
    c.where = (w: unknown) => {
      wheres.push(w)
      return c
    }
    c.orderBy = () => c
    c.limit = () => c
    c.offset = () => c
    // biome-ignore lint/suspicious/noThenProperty: a Drizzle builder IS a thenable; faking it needs `then`
    c.then = (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) =>
      Promise.resolve(result).then(res, rej)
    return c
  }
  let n = 0
  return { db: { select: () => chain(results[n++] ?? []) } as never, wheres }
}

const ids = (...v: string[]) => v.map((id) => ({ id }))

const entityBase = {
  entityDefinitionId: 'edf000000000000000000001',
  organizationId: 'org_1',
  filters: [],
  sorting: [],
  limit: 10,
  offset: 0,
}
const systemBase = {
  tableId: 'article' as const,
  organizationId: 'org_1',
  filters: [],
  sorting: [],
  limit: 10,
  offset: 0,
}

beforeEach(() => {
  setDrops(entityBuild, [])
  setDrops(systemBuild, [])
})

describe('a clean build stays byte-identical — no key appears at all', () => {
  it('omits both keys on the EntityInstance path', async () => {
    const { db } = fakeDb(ids('i0'))
    const r = await queryEntityInstanceIdsPaged({ ...entityBase, db })

    expect(r.droppedConditions).toBeUndefined()
    expect(r.droppedConditionCount).toBeUndefined()
    // Not just `undefined` — ABSENT. A caller doing `'droppedConditions' in r`,
    // or serializing the page, must see the pre-change shape.
    expect(Object.keys(r).sort()).toEqual(['hasMore', 'ids'])
  })

  it('omits both keys on the system-resource path', async () => {
    const { db } = fakeDb(ids('a0'))
    const r = await querySystemResourceIdsPaged({ ...systemBase, db })

    expect(Object.keys(r).sort()).toEqual(['hasMore', 'ids'])
  })
})

describe('both lanes report the same shape', () => {
  it('reports drops on the EntityInstance path', async () => {
    setDrops(entityBuild, [drop(1)])
    const { db } = fakeDb(ids('i0'))
    const r = await queryEntityInstanceIdsPaged({ ...entityBase, db })

    expect(r.droppedConditionCount).toBe(1)
    expect(r.droppedConditions).toEqual([
      {
        conditionId: 'cond_1',
        fieldRef: 'article:field_1',
        operator: 'equals',
        reason: 'unresolved-field-or-operator',
      },
    ])
  })

  it('reports drops on the system-resource path — the lane where the KB filters drop today', async () => {
    setDrops(systemBuild, [drop(1)])
    const { db } = fakeDb(ids('a0'))
    const r = await querySystemResourceIdsPaged({ ...systemBase, db })

    expect(r.droppedConditionCount).toBe(1)
    expect(r.droppedConditions).toEqual([
      {
        conditionId: 'cond_1',
        fieldRef: 'article:field_1',
        operator: 'equals',
        reason: 'unresolved-field-or-operator',
      },
    ])
  })

  it('produces key-for-key identical notices from the two builders', async () => {
    setDrops(entityBuild, [drop(7)])
    setDrops(systemBuild, [drop(7)])

    const entity = await queryEntityInstanceIdsPaged({ ...entityBase, db: fakeDb(ids('i0')).db })
    const system = await querySystemResourceIdsPaged({ ...systemBase, db: fakeDb(ids('a0')).db })

    // The two paths are separate functions; drift between them is exactly what a
    // UI cannot absorb, so this asserts equality rather than "both non-empty".
    expect(entity.droppedConditions).toEqual(system.droppedConditions)
    expect(entity.droppedConditionCount).toBe(system.droppedConditionCount)
  })
})

describe('client-facing projection withholds builder internals', () => {
  it('strips `detail` — the builder class name / raw valueSource token', async () => {
    setDrops(systemBuild, [drop(1)])
    const { db } = fakeDb(ids('a0'))
    const r = await querySystemResourceIdsPaged({ ...systemBase, db })

    const notice = r.droppedConditions?.[0]
    expect(notice).toBeDefined()
    expect(Object.keys(notice as object).sort()).toEqual([
      'conditionId',
      'fieldRef',
      'operator',
      'reason',
    ])
    expect(JSON.stringify(r)).not.toContain('SystemConditionBuilder')
  })
})

describe('the payload is bounded', () => {
  it(`caps the array at ${MAX_REPORTED_DROPPED_CONDITIONS} but keeps the count exact`, async () => {
    const many = Array.from({ length: MAX_REPORTED_DROPPED_CONDITIONS + 12 }, (_, i) => drop(i))
    setDrops(systemBuild, many)
    const { db } = fakeDb(ids('a0'))
    const r = await querySystemResourceIdsPaged({ ...systemBase, db })

    expect(r.droppedConditions).toHaveLength(MAX_REPORTED_DROPPED_CONDITIONS)
    // The count is the number a UI renders. Truncating it would make the notice
    // itself understate the problem — the same silence this field exists to end.
    expect(r.droppedConditionCount).toBe(MAX_REPORTED_DROPPED_CONDITIONS + 12)
  })

  it('keeps the array intact when it is under the cap', async () => {
    setDrops(entityBuild, [drop(1), drop(2), drop(3)])
    const { db } = fakeDb(ids('i0'))
    const r = await queryEntityInstanceIdsPaged({ ...entityBase, db })

    expect(r.droppedConditions).toHaveLength(3)
    expect(r.droppedConditionCount).toBe(3)
  })
})

describe('reporting does not change the query', () => {
  it('still returns the WIDER page — the fail-open is preserved, not converted to an error', async () => {
    setDrops(systemBuild, [drop(1), drop(2)])
    const { db, wheres } = fakeDb(ids('a0', 'a1', 'a2'))

    // No throw, and the rows the dropped filters would have excluded still come
    // back. Callers that must refuse (AI tools) use `inspectFilterConditions`.
    const r = await querySystemResourceIdsPaged({ ...systemBase, db })

    expect(r.ids).toEqual(['a0', 'a1', 'a2'])
    expect(r.droppedConditionCount).toBe(2)
    // One WHERE was still built and issued — the org scope. Nothing about the
    // reporting path added or removed a predicate.
    expect(wheres).toHaveLength(1)
  })

  it('leaves `total` alone — it still describes the widened set the query actually ran', async () => {
    setDrops(entityBuild, [drop(1)])
    const { db } = fakeDb(ids('i0'), [{ count: 6470 }])
    const r = await queryEntityInstanceIdsPaged({ ...entityBase, db, includeTotal: true })

    expect(r.total).toBe(6470)
    expect(r.droppedConditionCount).toBe(1)
  })
})
