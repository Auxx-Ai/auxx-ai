// packages/lib/src/resources/crud/__tests__/list-filtered-system-search.test.ts
//
// Free-text search on the SYSTEM-resource path (`Article` and, eventually, the
// other ~10 non-`EntityInstance` buckets).
//
// The sibling file `list-filtered-search.test.ts` pins the same three decisions
// for the `EntityInstance` path. They are re-asserted here rather than shared,
// because the two paths are separate functions and the failure mode being
// guarded against is exactly that one of them drifts:
//
//   1. search NARROWS — the predicate is `AND`-ed in, never `OR`-ed with filters;
//   2. `total` stays honest — the page query and the `COUNT(*)` read the SAME
//      `baseWhere`, so the count describes the searched set;
//   3. an explicit column sort BEATS relevance.
//
// Plus the one decision unique to this path:
//
//   4. a system table with NO binding degrades to the pre-search query — it must
//      not throw, and it must not silently narrow. That property is what lets the
//      remaining tables be adopted one at a time.
//
// Drizzle column refs are `{}`/`undefined` under this package's Vitest setup
// (`project_drizzle_columns_undefined_in_vitest`), so the assertions read the
// rendered SQL TEXT rather than column identities.

import { PgDialect } from 'drizzle-orm/pg-core'
import { describe, expect, it, vi } from 'vitest'

vi.mock('../../../cache', () => ({
  getCachedResourceFields: vi.fn(async () => []),
  findCachedResource: vi.fn(async () => undefined),
  getCachedEntityDefId: vi.fn(async () => undefined),
  getOrgCache: vi.fn(() => ({ get: vi.fn(async () => ({})) })),
}))

vi.mock('../../query-builder/system-condition-builder', () => ({
  systemConditionBuilder: {
    buildGroupedQueryWithDiagnostics: vi.fn(() => ({
      sql: undefined,
      requestedConditions: 0,
      droppedConditions: [],
      allConditionsDropped: false,
    })),
    // A sentinel the ORDER BY assertions can find: "the user clicked a column
    // header", as distinct from the relevance ordering.
    buildOrderBySql: vi.fn(() => [{ USER_SORT: true }]),
  },
}))

import { countSystemResource, querySystemResourceIdsPaged } from '../unified-handler-queries'

const dialect = new PgDialect()

/** Render a captured Drizzle fragment to SQL text, tolerating undefined columns. */
function render(fragment: unknown): string {
  if (!fragment) return ''
  try {
    return dialect.sqlToQuery(fragment as never).sql
  } catch {
    return ''
  }
}

interface Captured {
  wheres: unknown[]
  orderBys: unknown[][]
}

function fakeDb(...results: unknown[][]) {
  const captured: Captured = { wheres: [], orderBys: [] }
  const chain = (result: unknown[]) => {
    const c: Record<string, unknown> = {}
    c.from = () => c
    c.where = (w: unknown) => {
      captured.wheres.push(w)
      return c
    }
    c.orderBy = (...o: unknown[]) => {
      captured.orderBys.push(o)
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
    db: { select: () => chain(results[n++] ?? []) } as never,
    captured,
  }
}

const ids = (...v: string[]) => v.map((id) => ({ id }))
const total = (count: number) => [{ count }]

const base = {
  organizationId: 'org_1',
  filters: [],
  sorting: [],
  limit: 10,
  offset: 0,
}

describe('querySystemResourceIdsPaged — free-text search on a BOUND table (article)', () => {
  it('adds no search SQL when `search` is absent', async () => {
    const { db, captured } = fakeDb(ids('a0'))
    await querySystemResourceIdsPaged({ ...base, db, tableId: 'article' })

    expect(render(captured.wheres[0])).not.toContain('to_tsvector(')
    expect(captured.orderBys[0]).toHaveLength(1)
  })

  it('ANDs the ranked predicate into the WHERE clause', async () => {
    const { db, captured } = fakeDb(ids('a0'))
    await querySystemResourceIdsPaged({ ...base, db, tableId: 'article', search: 'mcp attio' })

    const where = render(captured.wheres[0])
    expect(where).toContain('to_tsvector(')
    expect(where).toContain('plainto_tsquery(')
    expect(where).toContain('similarity(')
    // Narrows, never widens: the OR block arrives parenthesized and joined with
    // `and`, so the org-scope equality cannot be reassociated away.
    expect(where).toContain(' and ')
  })

  it('keeps `total` honest — the COUNT reads the same searched WHERE', async () => {
    const { db, captured } = fakeDb(ids('a0'), total(3))
    const r = await querySystemResourceIdsPaged({
      ...base,
      db,
      tableId: 'article',
      search: 'mcp',
      includeTotal: true,
    })

    expect(r.total).toBe(3)
    expect(captured.wheres).toHaveLength(2)
    // Not "both contain a search predicate" — the SAME fragment object, which is
    // what makes drift between the page and the count unrepresentable.
    expect(captured.wheres[1]).toBe(captured.wheres[0])
  })

  it('orders by relevance, then the id tie-break, when no sort is set', async () => {
    const { db, captured } = fakeDb(ids('a0'))
    await querySystemResourceIdsPaged({ ...base, db, tableId: 'article', search: 'mcp' })

    const orderBy = captured.orderBys[0]!
    expect(orderBy).toHaveLength(2)
    expect(render(orderBy[0])).toContain('ts_rank_cd(')
    expect(render(orderBy[0])).toContain('similarity(')
    expect(render(orderBy[0])).toContain('desc')
  })

  it('lets an explicit column sort BEAT relevance', async () => {
    const { db, captured } = fakeDb(ids('a0'))
    await querySystemResourceIdsPaged({
      ...base,
      db,
      tableId: 'article',
      search: 'mcp',
      sorting: [{ id: 'title', desc: false }],
    })

    const orderBy = captured.orderBys[0]!
    expect(orderBy).toHaveLength(2)
    expect(orderBy[0]).toEqual({ USER_SORT: true })
    expect(orderBy.map(render).join(' ')).not.toContain('ts_rank_cd(')

    // …but the search still NARROWS. Sorting by a column must not silently
    // return rows the user did not search for.
    expect(render(captured.wheres[0])).toContain('to_tsvector(')
  })

  it('treats a blank / whitespace-only search as absent', async () => {
    const { db, captured } = fakeDb(ids('a0'))
    await querySystemResourceIdsPaged({ ...base, db, tableId: 'article', search: '   ' })

    expect(render(captured.wheres[0])).not.toContain('to_tsvector(')
    expect(captured.orderBys[0]).toHaveLength(1)
  })
})

describe('querySystemResourceIdsPaged — an UNBOUND table degrades, it does not break', () => {
  it('ignores `search` for a table with no binding, without throwing', async () => {
    const { db, captured } = fakeDb(ids('u0'))
    const r = await querySystemResourceIdsPaged({
      ...base,
      db,
      tableId: 'user',
      search: 'mcp attio',
    })

    expect(r.ids).toEqual(['u0'])
    // No predicate: `user` has no corpus column and no GIN indexes, so a ranked
    // predicate would seq-scan on a column that does not exist.
    expect(render(captured.wheres[0])).not.toContain('to_tsvector(')
    // And no relevance ordering — the query is the one that ran before search
    // existed on this path.
    expect(captured.orderBys[0]).toHaveLength(1)
  })

  it('leaves an unbound table byte-identical with and without `search`', async () => {
    const withSearch = fakeDb(ids('u0'))
    await querySystemResourceIdsPaged({
      ...base,
      db: withSearch.db,
      tableId: 'user',
      search: 'anything',
    })
    const without = fakeDb(ids('u0'))
    await querySystemResourceIdsPaged({ ...base, db: without.db, tableId: 'user' })

    expect(render(withSearch.captured.wheres[0])).toBe(render(without.captured.wheres[0]))
    expect(withSearch.captured.orderBys[0]).toHaveLength(without.captured.orderBys[0]!.length)
  })
})

describe('countSystemResource — free-text search', () => {
  it('counts the SEARCHED set for a bound table', async () => {
    const { db, captured } = fakeDb(total(7))
    const n = await countSystemResource({
      db,
      tableId: 'article',
      organizationId: 'org_1',
      filters: [],
      search: 'mcp attio',
    })

    expect(n).toBe(7)
    expect(render(captured.wheres[0])).toContain('to_tsvector(')
  })

  it('ignores `search` for an unbound table rather than throwing', async () => {
    const { db, captured } = fakeDb(total(7))
    const n = await countSystemResource({
      db,
      tableId: 'user',
      organizationId: 'org_1',
      filters: [],
      search: 'mcp attio',
    })

    expect(n).toBe(7)
    expect(render(captured.wheres[0])).not.toContain('to_tsvector(')
  })
})
