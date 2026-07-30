// packages/lib/src/resources/crud/__tests__/list-filtered-paging.test.ts
//
// Plan v3/02 §2.2 — the paged query fn's contract now that the shared snapshot is gone:
// `hasMore` comes from a `limit + 1` probe row (never `offset + ids.length < total`), and
// the `COUNT(*)` is skipped entirely unless `includeTotal`.
//
// Driven by a fake `db`: Drizzle column refs are `undefined` under vitest
// (`project_drizzle_columns_undefined_in_vitest`), so the fake ignores what it's handed
// and only records how many statements were built — that's how we prove the COUNT is skipped.

import { describe, expect, it, vi } from 'vitest'

vi.mock('../../../cache', () => ({
  getCachedResourceFields: vi.fn(async () => []),
  findCachedResource: vi.fn(async () => undefined),
  getCachedEntityDefId: vi.fn(async () => undefined),
  getOrgCache: vi.fn(() => ({ get: vi.fn(async () => ({})) })),
}))

vi.mock('../../../workflow-engine/query-builder/entity-condition-builder', () => ({
  entityConditionBuilder: {
    buildGroupedQuery: vi.fn(() => undefined),
    buildOrderBySql: vi.fn(() => undefined),
    droppedConditions: [],
  },
}))

import { queryEntityInstanceIdsPaged } from '../unified-handler-queries'

/**
 * Minimal Drizzle stand-in. The ids query builds `select().from().where().orderBy()
 * .limit().offset()`; the count query builds `select().from().where()`. Both are awaited,
 * so each chain is a thenable. The first `select()` serves ids, the second serves the count.
 */
function fakeDb(idRows: Array<{ id: string }>, countRows: Array<{ count: number }>) {
  const built: string[] = []
  const chain = (rows: unknown[]) => {
    const c: Record<string, unknown> = {}
    for (const m of ['from', 'where', 'orderBy', 'limit', 'offset']) c[m] = () => c
    // biome-ignore lint/suspicious/noThenProperty: a Drizzle builder IS a thenable; faking it needs `then`
    c.then = (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) =>
      Promise.resolve(rows).then(res, rej)
    return c
  }
  return {
    db: {
      select: () => {
        const isIds = built.length === 0
        built.push(isIds ? 'ids' : 'count')
        return chain(isIds ? idRows : countRows)
      },
    } as never,
    built,
  }
}

const rows = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `i${i}` }))

const base = {
  entityDefinitionId: 'edf000000000000000000001',
  organizationId: 'org_1',
  filters: [],
  sorting: [],
}

describe('queryEntityInstanceIdsPaged — limit+1 probe and optional COUNT', () => {
  it('exactly-limit rows available ⇒ hasMore false, every id returned', async () => {
    // The query asks for `limit + 1`; with exactly `limit` matches the probe row is absent.
    const { db } = fakeDb(rows(10), [{ count: 10 }])
    const r = await queryEntityInstanceIdsPaged({
      ...base,
      db,
      limit: 10,
      offset: 0,
      includeTotal: true,
    })
    expect(r.hasMore).toBe(false)
    expect(r.ids).toHaveLength(10)
    expect(r.total).toBe(10)
  })

  it('limit+1 rows available ⇒ hasMore true and the probe row is NOT returned', async () => {
    const { db } = fakeDb(rows(11), [{ count: 42 }])
    const r = await queryEntityInstanceIdsPaged({
      ...base,
      db,
      limit: 10,
      offset: 0,
      includeTotal: true,
    })
    expect(r.hasMore).toBe(true)
    expect(r.ids).toHaveLength(10)
    expect(r.ids).not.toContain('i10')
  })

  it('hasMore is the probe, not arithmetic on a drifted total', async () => {
    // A concurrent delete shrank the COUNT below what the page actually returned.
    // `offset + ids.length < total` would say "no more"; the probe row says otherwise.
    const { db } = fakeDb(rows(11), [{ count: 3 }])
    const r = await queryEntityInstanceIdsPaged({
      ...base,
      db,
      limit: 10,
      offset: 0,
      includeTotal: true,
    })
    expect(r.total).toBe(3)
    expect(r.hasMore).toBe(true)
  })

  it('reports total 0 (not an omitted total) when includeTotal and the def is empty', async () => {
    const { db } = fakeDb([], [{ count: 0 }])
    const r = await queryEntityInstanceIdsPaged({
      ...base,
      db,
      limit: 10,
      offset: 0,
      includeTotal: true,
    })
    expect(r).toEqual({ ids: [], total: 0, hasMore: false })
  })

  it('omits total AND builds no second statement when includeTotal is false', async () => {
    const { db, built } = fakeDb(rows(11), [{ count: 99 }])
    const r = await queryEntityInstanceIdsPaged({
      ...base,
      db,
      limit: 10,
      offset: 10,
      includeTotal: false,
    })
    expect('total' in r).toBe(false)
    expect(r.hasMore).toBe(true)
    expect(built).toEqual(['ids']) // the COUNT never ran
  })
})
