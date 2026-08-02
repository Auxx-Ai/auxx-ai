// packages/lib/src/resources/crud/__tests__/article-scope.test.ts
//
// Plan v3/06 W1 + W1b — the records lane stops serving every article in the org.
//
// `record.listFiltered({ entityDefinitionId: 'article' })` reached
// `querySystemResourceIdsPaged` with `organizationId` and nothing else, because
// `recordScope` short-circuited every system table to `{ arm: 'all' }` BEFORE
// consulting a single capability. An article's policy is real; it just lives one
// hop away, on its knowledge base.
//
// W1 alone is inert: `querySystemResourceIdsPaged` took no visibility argument,
// so a scope that returned a predicate produced SQL nobody read. W1b is the
// parameter, and the two properties below are what make the fix real:
//
//   1. the predicate is FORWARDED into the query helper, and
//   2. the page query and the `COUNT(*)` share ONE clause, so `total` describes
//      the visible set (the plan v3/02 short-page property).
//
// ⚠ Deliberately NOT `listAll` / `lookupByField` / `getById`. Per §3.1 R2/R6/R6b
// those are `EntityInstance`-only and cannot return an article row at all
// (verified against dev: zero `EntityInstance` rows for any article def). Wiring
// the predicate there would AND a `"Article"`-qualified clause into a query over
// `"EntityInstance"` and raise `missing FROM-clause entry`.
//
// ⚠ Nothing here asserts the CONTENT of a predicate — columns are `{}` under
// this package's Vitest config, so such an assertion passes vacuously. What is
// asserted is forwarding (by object identity) and clause sharing (by identity).

import { beforeEach, describe, expect, it, vi } from 'vitest'

const DEF_ID = vi.hoisted(() => 'edf000000000000000000001')
const knowledgeBases = vi.hoisted(() => ({ rows: [] as Array<{ id: string; kind: string }> }))

// A FULL factory, not `importOriginal` + spread — see the note in
// `list-filtered-mail-lens.test.ts`: the real `cache` barrel's transitive graph
// re-enters `unified-handler-queries` while the factory is still running, so the
// module under test binds the REAL helper and the override never takes effect.
vi.mock('../../../cache', () => ({
  findCachedResource: vi.fn(async () => ({ id: DEF_ID, entityDefinitionId: DEF_ID })),
  getCachedResourceFields: vi.fn(async () => []),
  getCachedEntityDefId: vi.fn(async () => undefined),
  getCachedKnowledgeBases: vi.fn(async () => knowledgeBases.rows),
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
    buildOrderBySql: vi.fn(() => [{ USER_SORT: true }]),
  },
}))

// PARTIAL mock — the handler imports a dozen other helpers from this module, and
// replacing it wholesale kills the file at collection.
vi.mock('../unified-handler-queries', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../unified-handler-queries')>()
  return {
    ...actual,
    querySystemResourceIdsPaged: vi.fn(async () => ({
      ids: ['art_1', 'art_2'],
      total: 2,
      hasMore: false,
    })),
  }
})

import type { CapabilityView } from '../../../permissions/capabilities/capability-view'
import { UnifiedCrudHandler } from '../unified-handler'
import { querySystemResourceIdsPaged } from '../unified-handler-queries'

const ORG = 'org_abgwpa1l81reht2zmwrcih'
const STANDARD_KB = 'r7gncj0m9f88home9kp8j1s7'
const SOURCE_KB = 'd9mvw4li82k90ftph4h26n0m'
const LEARNED_KB = 'oixvifyqdgq5r0nz1wr2qsfy'

const paged = vi.mocked(querySystemResourceIdsPaged)

/** A member whose `canViewInstance('kb', …)` answers from `rungs`. */
function view(rungs: Record<string, 'read' | 'edit' | 'admin'> | '*'): CapabilityView {
  const at = (id: string) => (rungs === '*' ? 'edit' : rungs[id])
  return {
    // `canViewEntity` is unconditionally true for `article`
    // (`NON_RECORD_DEF_SLUGS`) — which is precisely why the def gate never
    // stopped this read.
    canViewEntity: () => true,
    hasRecordGrantsOn: () => false,
    canViewInstance: (_key: string, id: string) => at(id) !== undefined,
    canEditInstance: (_key: string, id: string) => at(id) === 'edit' || at(id) === 'admin',
    canAdminInstance: (_key: string, id: string) => at(id) === 'admin',
  } as unknown as CapabilityView
}

function handler(capabilities?: CapabilityView) {
  return new UnifiedCrudHandler(ORG, 'usr_member', {} as never, undefined, {
    capabilities: capabilities as never,
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  knowledgeBases.rows = [
    { id: STANDARD_KB, kind: 'standard' },
    { id: SOURCE_KB, kind: 'source' },
    { id: LEARNED_KB, kind: 'learned' },
  ]
})

describe('listFiltered — the article visibility predicate is forwarded (W1 → W1b)', () => {
  it('forwards a predicate when the member holds only SOME of the org’s KBs', async () => {
    await handler(view({ [STANDARD_KB]: 'edit' })).listFiltered({ entityDefinitionId: 'article' })

    expect(paged).toHaveBeenCalledTimes(1)
    // The parameter existing AND arriving is the whole of W1b. Its CONTENT is
    // verified by the real-DB check the plan makes blocking for P1b.
    expect(paged.mock.calls[0]?.[0]?.visibilityWhere).toBeDefined()
  })

  it('STILL forwards one for a member who holds every KB — source KBs are excluded by kind', async () => {
    // 🔴 §8.0's "a stock org narrows nothing" is wrong. The GRANT half narrows
    // nothing (baseline `knowledgeBase: Edit` + `baselineAtCreate: false`); the
    // `kind` half narrows for everyone, OWNER included. Dropping the predicate
    // here would re-admit source-only articles.
    await handler(view('*')).listFiltered({ entityDefinitionId: 'article' })

    expect(paged.mock.calls[0]?.[0]?.visibilityWhere).toBeDefined()
  })

  it('returns an empty page WITHOUT querying when no KB is viewable', async () => {
    const result = await handler(view({})).listFiltered({ entityDefinitionId: 'article' })

    expect(result).toEqual({ ids: [], total: 0, hasMore: false })
    // Not "queried and filtered to nothing" — arm `none` must cost nothing, and
    // a `total` from a query nobody was allowed to run is the v3/02 bug.
    expect(paged).not.toHaveBeenCalled()
  })

  it('leaves every OTHER system table untouched', async () => {
    // A member with no KB at all must still list users. The dispatch is
    // per-table; regressing this is an outage, not a tightening.
    await handler(view({})).listFiltered({ entityDefinitionId: 'user' })

    expect(paged).toHaveBeenCalledTimes(1)
    expect(paged.mock.calls[0]?.[0]?.visibilityWhere).toBeUndefined()
  })

  it('does not narrow an INTERNAL caller (`capabilities: undefined`)', async () => {
    // Article sync, embedding jobs and the export worker rely on this.
    await handler().listFiltered({ entityDefinitionId: 'article' })

    expect(paged.mock.calls[0]?.[0]?.visibilityWhere).toBeUndefined()
  })

  it('resolves the KB allow-list ONCE per handler, not once per call', async () => {
    const h = handler(view({ [STANDARD_KB]: 'edit' }))
    await h.listFiltered({ entityDefinitionId: 'article' })
    await h.listFiltered({ entityDefinitionId: 'article', offset: 100 })

    const { getCachedKnowledgeBases } = await import('../../../cache')
    expect(vi.mocked(getCachedKnowledgeBases)).toHaveBeenCalledTimes(1)
  })
})

describe('querySystemResourceIdsPaged — the page and the COUNT share ONE clause', () => {
  /** Records every `.where(...)` argument the builder is handed. */
  function recordingDb() {
    const whereArgs: unknown[] = []
    const select = vi.fn(() => {
      const c: Record<string, unknown> = {}
      c.from = () => c
      c.where = (arg: unknown) => {
        whereArgs.push(arg)
        return c
      }
      c.orderBy = () => c
      c.limit = () => c
      c.offset = () => c
      // biome-ignore lint/suspicious/noThenProperty: a Drizzle builder IS a thenable; faking it needs `then`
      c.then = (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) =>
        Promise.resolve([{ id: 'art_1', count: 1 }]).then(res, rej)
      return c
    })
    return { db: { select } as never, whereArgs }
  }

  /** Is `target` reachable by reference anywhere inside `root`? */
  function containsRef(root: unknown, target: unknown, depth = 0): boolean {
    if (root === target) return true
    if (depth > 8 || root === null || typeof root !== 'object') return false
    for (const value of Object.values(root as Record<string, unknown>)) {
      if (containsRef(value, target, depth + 1)) return true
    }
    return false
  }

  const base = {
    organizationId: ORG,
    tableId: 'article' as const,
    filters: [],
    sorting: [],
    limit: 10,
    offset: 0,
    includeTotal: true,
  }

  it('ANDs `visibilityWhere` into the clause BOTH queries use', async () => {
    const { db, whereArgs } = recordingDb()
    // A sentinel we can find by identity — the only kind of assertion that is
    // not vacuous here.
    const sentinel = { VISIBILITY: true } as never

    const { querySystemResourceIdsPaged: real } = await vi.importActual<
      typeof import('../unified-handler-queries')
    >('../unified-handler-queries')
    await real({ ...base, db, visibilityWhere: sentinel })

    expect(whereArgs).toHaveLength(2)
    // Same OBJECT, not merely an equal one: a `total` built from a second,
    // independently-assembled clause is exactly how the count drifts from the page.
    expect(whereArgs[0]).toBe(whereArgs[1])
    expect(containsRef(whereArgs[0], sentinel)).toBe(true)
  })

  it('omits it cleanly when absent — the pre-existing query shape is unchanged', async () => {
    const { db, whereArgs } = recordingDb()
    const { querySystemResourceIdsPaged: real } = await vi.importActual<
      typeof import('../unified-handler-queries')
    >('../unified-handler-queries')
    await real({ ...base, db })

    expect(whereArgs).toHaveLength(2)
    expect(whereArgs[0]).toBe(whereArgs[1])
  })
})
