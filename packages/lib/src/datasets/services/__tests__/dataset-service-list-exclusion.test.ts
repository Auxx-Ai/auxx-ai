// packages/lib/src/datasets/services/__tests__/dataset-service-list-exclusion.test.ts

import { DatasetService } from '../dataset-service'

/**
 * `DatasetService.list`'s access exclusion (`DatasetFilters.excludeIds`, plan 30).
 *
 * Two properties the router's correctness rests on, neither of which the router
 * test can see (it mocks this service):
 *  1. the page query and the `totalCount` query run over the SAME where-clause,
 *     so an exclusion can never make them disagree;
 *  2. the exclusion is emitted as a `not in` predicate when there are ids, and
 *     emitted NOT AT ALL when the list is empty — Drizzle renders an empty
 *     `notInArray` as invalid SQL.
 *
 * Drizzle table columns are `undefined` under vitest (they resolve to a
 * type-stripped artifact), so these assert on the SQL's operator *shape* and on
 * object identity rather than on column references.
 */

/** Concatenated literal SQL text of a Drizzle `SQL` node (params elided). */
function sqlShape(node: unknown): string {
  if (node === null || typeof node !== 'object') return ''
  if (Array.isArray(node)) return node.map(sqlShape).join('')
  const rec = node as Record<string, unknown>
  if (rec.constructor?.name === 'StringChunk' && Array.isArray(rec.value)) {
    return rec.value.join('')
  }
  if (Array.isArray(rec.queryChunks)) return sqlShape(rec.queryChunks)
  return ''
}

/** Minimal stand-in for the two queries `list` fires, capturing each where-clause. */
function fakeDb() {
  const captured: { page?: unknown; count?: unknown } = {}
  const db = {
    query: {
      Dataset: {
        findMany: async ({ where }: { where: unknown }) => {
          captured.page = where
          return []
        },
      },
    },
    select: () => ({
      from: () => ({
        where: async (where: unknown) => {
          captured.count = where
          return [{ value: 0 }]
        },
      }),
    }),
  }
  return { db, captured }
}

async function whereClausesFor(excludeIds?: readonly string[]) {
  const { db, captured } = fakeDb()
  await new DatasetService(db as never).list('org_1', { excludeIds }, { page: 1, limit: 20 })
  return captured
}

async function whereClausesForInclude(includeIds?: readonly string[]) {
  const { db, captured } = fakeDb()
  await new DatasetService(db as never).list('org_1', { includeIds }, { page: 1, limit: 20 })
  return captured
}

describe('DatasetService.list — excludeIds', () => {
  it('runs the page query and the totalCount query over the same where-clause', async () => {
    const captured = await whereClausesFor(['dset_a', 'dset_b'])
    expect(captured.page).toBeDefined()
    // Object identity: there is one clause, so `limit`/`offset` and `totalCount`
    // can never describe different sets.
    expect(captured.count).toBe(captured.page)
  })

  it('emits a `not in` predicate when ids are excluded', async () => {
    const captured = await whereClausesFor(['dset_a', 'dset_b'])
    expect(sqlShape(captured.page)).toContain(' not in ')
  })

  it('emits NO exclusion predicate for an empty id list', async () => {
    // Drizzle renders an empty `notInArray` as invalid SQL, so the guard is not
    // an optimization — an unguarded push breaks every unrestricted org's list.
    const captured = await whereClausesFor([])
    expect(sqlShape(captured.page)).not.toContain(' not in ')
    expect(sqlShape(captured.page)).toBe(sqlShape((await whereClausesFor(undefined)).page))
  })
})

/**
 * `DatasetFilters.includeIds` — the plan 25 §2 inverse: a `datasets: None`
 * member holding explicit grants sees exactly those datasets. Same two
 * properties, and the same empty-array hazard (`inArray([])` is invalid SQL too).
 */
describe('DatasetService.list — includeIds', () => {
  it('emits an `in` predicate when ids are named', async () => {
    const captured = await whereClausesForInclude(['dset_a', 'dset_b'])
    const shape = sqlShape(captured.page)
    expect(shape).toContain(' in ')
    expect(shape).not.toContain(' not in ')
  })

  it('runs the page query and the totalCount query over the same where-clause', async () => {
    const captured = await whereClausesForInclude(['dset_a'])
    expect(captured.page).toBeDefined()
    expect(captured.count).toBe(captured.page)
  })

  it('emits NO predicate for an empty id list', async () => {
    // Drizzle renders an empty `inArray` as invalid SQL. `instanceListScope`
    // returns `kind: 'none'` in that case and the router short-circuits before
    // reaching here, but the guard must hold on its own.
    const captured = await whereClausesForInclude([])
    expect(sqlShape(captured.page)).toBe(sqlShape((await whereClausesForInclude(undefined)).page))
  })
})
