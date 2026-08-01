// packages/lib/src/resources/crud/__tests__/list-filtered-search.test.ts
//
// Plan step 2.4 — free-text search on the records list.
//
// What is worth asserting here is the WIRING, not the formula: the ranking
// expression has its own tests in `search/text-search-sql.test.ts` and
// `resources/search/record-search-sql.test.ts`. What this file pins down is the
// three decisions that live in `unified-handler-queries.ts` and nowhere else:
//
//   1. search NARROWS — the predicate is `AND`-ed in, never `OR`-ed with filters;
//   2. `total` stays honest — the page query and the `COUNT(*)` read the SAME
//      `baseWhere`, so the count describes the searched set;
//   3. an explicit column sort BEATS relevance — rank is the DEFAULT ordering,
//      not an override.
//
// Drizzle column refs are `{}`/`undefined` under this package's Vitest setup
// (`project_drizzle_columns_undefined_in_vitest`), so the assertions read the
// rendered SQL TEXT — `to_tsvector(`, `plainto_tsquery(`, `similarity(` — which
// survives the missing columns, rather than the column identities, which do not.

import { PgDialect } from 'drizzle-orm/pg-core'
import { describe, expect, it, vi } from 'vitest'

vi.mock('../../../cache', () => ({
  getCachedResourceFields: vi.fn(async () => []),
  findCachedResource: vi.fn(async () => undefined),
  getCachedEntityDefId: vi.fn(async () => undefined),
  getOrgCache: vi.fn(() => ({ get: vi.fn(async () => ({})) })),
}))

vi.mock('../../query-builder/entity-condition-builder', () => ({
  entityConditionBuilder: {
    buildGroupedQueryWithDiagnostics: vi.fn(() => ({
      sql: undefined,
      requestedConditions: 0,
      droppedConditions: [],
      allConditionsDropped: false,
    })),
    // A sentinel the ORDER BY assertions can find: this is "the user clicked a
    // column header", as distinct from the relevance ordering.
    buildOrderBySql: vi.fn(() => [{ USER_SORT: true }]),
  },
}))

import { countEntityInstances, queryEntityInstanceIdsPaged } from '../unified-handler-queries'

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

/**
 * Drizzle stand-in that records every `where()` / `orderBy()` argument. The ids
 * query builds `select().from().where().orderBy().limit().offset()`; the count
 * query builds `select().from().where()`. Both are awaited, so each chain is a
 * thenable.
 */
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
  entityDefinitionId: 'edf000000000000000000001',
  organizationId: 'org_1',
  filters: [],
  sorting: [],
  limit: 10,
  offset: 0,
}

describe('queryEntityInstanceIdsPaged — free-text search', () => {
  it('adds no search SQL when `search` is absent', async () => {
    const { db, captured } = fakeDb(ids('i0'))
    await queryEntityInstanceIdsPaged({ ...base, db })

    expect(render(captured.wheres[0])).not.toContain('to_tsvector(')
    // Ordering stays the bare deterministic tie-break.
    expect(captured.orderBys[0]).toHaveLength(1)
  })

  it('ANDs the ranked predicate into the WHERE clause', async () => {
    const { db, captured } = fakeDb(ids('i0'))
    await queryEntityInstanceIdsPaged({ ...base, db, search: 'acme berlin' })

    const where = render(captured.wheres[0])
    expect(where).toContain('to_tsvector(')
    expect(where).toContain('plainto_tsquery(')
    expect(where).toContain('similarity(')
    // Narrows, never widens: the OR block arrives parenthesized and joined with
    // `and`, so the equality predicates cannot be reassociated away.
    expect(where).toContain(' and ')
  })

  it('keeps `total` honest — the COUNT reads the same searched WHERE', async () => {
    const { db, captured } = fakeDb(ids('i0'), total(3))
    const r = await queryEntityInstanceIdsPaged({
      ...base,
      db,
      search: 'acme',
      includeTotal: true,
    })

    expect(r.total).toBe(3)
    expect(captured.wheres).toHaveLength(2)
    // Not "both contain a search predicate" — the SAME fragment object, which is
    // what makes drift between the page and the count unrepresentable.
    expect(captured.wheres[1]).toBe(captured.wheres[0])
  })

  it('orders by relevance, then updatedAt, then id when no sort is set', async () => {
    const { db, captured } = fakeDb(ids('i0'))
    await queryEntityInstanceIdsPaged({ ...base, db, search: 'acme' })

    const orderBy = captured.orderBys[0]!
    expect(orderBy).toHaveLength(3)
    // Rank first — most rows score 0 on trigram, so the secondary matters.
    expect(render(orderBy[0])).toContain('ts_rank_cd(')
    expect(render(orderBy[0])).toContain('similarity(')
    expect(render(orderBy[0])).toContain('desc')
  })

  it('lets an explicit column sort BEAT relevance', async () => {
    const { db, captured } = fakeDb(ids('i0'))
    await queryEntityInstanceIdsPaged({
      ...base,
      db,
      search: 'acme',
      sorting: [{ id: 'name', desc: false }],
    })

    const orderBy = captured.orderBys[0]!
    // The user's column + the id tie-break. No rank clause.
    expect(orderBy).toHaveLength(2)
    expect(orderBy[0]).toEqual({ USER_SORT: true })
    expect(orderBy.map(render).join(' ')).not.toContain('ts_rank_cd(')

    // …but the search still NARROWS. Sorting by a column must not silently
    // return rows the user did not search for.
    expect(render(captured.wheres[0])).toContain('to_tsvector(')
  })

  it('treats a blank / whitespace-only search as absent', async () => {
    const { db, captured } = fakeDb(ids('i0'))
    await queryEntityInstanceIdsPaged({ ...base, db, search: '   ' })

    expect(render(captured.wheres[0])).not.toContain('to_tsvector(')
    expect(captured.orderBys[0]).toHaveLength(1)
  })
})

describe('countEntityInstances — free-text search', () => {
  it('applies the same predicate, so a counted list cannot describe a wider set', async () => {
    const { db, captured } = fakeDb(total(7))
    const n = await countEntityInstances({ ...base, db, search: 'acme' })

    expect(n.count).toBe(7)
    expect(render(captured.wheres[0])).toContain('to_tsvector(')
  })

  it('counts the unsearched set when no search is given', async () => {
    const { db, captured } = fakeDb(total(42))
    const n = await countEntityInstances({ ...base, db })

    expect(n.count).toBe(42)
    expect(render(captured.wheres[0])).not.toContain('to_tsvector(')
  })
})
