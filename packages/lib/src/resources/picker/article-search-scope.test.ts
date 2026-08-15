// packages/lib/src/resources/picker/article-search-scope.test.ts
//
// Plan v3/06 R4 + R5 — the SEARCH lane.
//
// `record.search({ entityDefinitionId: 'article' })` routes
// `UnifiedCrudHandler.search` → `RecordPickerService.getResources` →
// `fetchResourcesFromDb`, which never consulted `recordScope` and never reached
// `admitSystemRows`. The ⌘K / `@`-reference global union
// (`article-reference-list.tsx`) is worse: `searchGlobalUnion` calls
// `fetchResourcesFromDb` per system table DIRECTLY, bypassing `getResources`
// entirely — so enforcing in `getResources` alone would have left it open.
// Both are closed by putting the predicate at the `fetchResourcesFromDb` choke
// point.
//
// 🔴 The other half is the CACHE. `RecordPickerCacheService.buildListKey` is
// `(orgId, entityDefinitionId, {cursor, search, filters})` — no user dimension
// at all. Narrowing the query without extending the key serves the first
// caller's visible set to every other member of the org for the full 30-minute
// TTL, in BOTH directions: a narrow member reads a wide member's results (worse
// than the leak being closed) and a wide member silently loses rows.
//
// ⚠ Assertions are on the KEY STRING and on which rows come back — never on a
// built predicate, whose columns are `{}` here. The predicate's correctness is
// verified against dev postgres, including that it survives Drizzle's relational
// query builder (whose top-level FROM is `"Article" "Article"`).

import { beforeEach, describe, expect, it, vi } from 'vitest'

const knowledgeBases = vi.hoisted(() => ({ rows: [] as Array<{ id: string; kind: string }> }))

vi.mock('../../identity', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../identity')>()
  return { ...actual, getRecordIdentitiesForRecords: vi.fn(async () => new Map()) }
})

// FULL factory — see the note in `article-admit.test.ts`.
vi.mock('../../cache', () => ({
  getCachedKnowledgeBases: vi.fn(async () => knowledgeBases.rows),
  getCachedEntityDefId: vi.fn(async () => undefined),
  getCachedResource: vi.fn(async () => null),
  getCachedResources: vi.fn(async () => []),
  getOrgCache: vi.fn(() => ({ get: vi.fn(async () => ({})) })),
}))

import { knowledgeBaseScopeFingerprint } from '../../permissions/capabilities/article-visibility-scope'
import type { CapabilityView } from '../../permissions/capabilities/capability-view'
import { RecordPickerCacheService } from './record-picker-cache'
import { RecordPickerService } from './record-picker-service'
import type { PaginatedResourcesResult } from './types'

const ORG = 'org_abgwpa1l81reht2zmwrcih'
const USER = 'usr_member00000000000000'

const STANDARD_KB = 'r7gncj0m9f88home9kp8j1s7'
const SOURCE_KB = 'd9mvw4li82k90ftph4h26n0m'
const LEARNED_KB = 'oixvifyqdgq5r0nz1wr2qsfy'

function view(rungs: Record<string, 'read' | 'edit' | 'admin'> | '*'): CapabilityView {
  const at = (id: string) => (rungs === '*' ? 'edit' : rungs[id])
  return {
    canViewEntity: () => true,
    hasRecordGrantsOn: () => false,
    canViewInstance: (_key: string, id: string) => at(id) !== undefined,
    canEditInstance: (_key: string, id: string) => at(id) === 'edit' || at(id) === 'admin',
    canAdminInstance: (_key: string, id: string) => at(id) === 'admin',
    instanceListScope: () =>
      rungs === '*'
        ? { kind: 'exclude', excludeIds: [] }
        : Object.keys(rungs).length > 0
          ? { kind: 'include', includeIds: Object.keys(rungs) }
          : { kind: 'none' },
  } as unknown as CapabilityView
}

/**
 * A service whose direct/join fetchers are stubbed, so we can observe exactly
 * what `fetchResourcesFromDb` hands them — including whether it hands them a
 * predicate at all.
 */
function service(capabilities?: CapabilityView) {
  const svc = new RecordPickerService(ORG, USER, {} as never, capabilities)
  const direct = vi.fn(
    async (): Promise<PaginatedResourcesResult> => ({ items: [], nextCursor: null })
  )
  ;(svc as unknown as { fetchResourcesDirect: unknown }).fetchResourcesDirect = direct
  // Typed parameters, not `async () => …`: an inferred zero-arg mock gives
  // `mock.calls[0]` the tuple type `[]`, so every index read is a tsc error.
  type ListOptions = { cursor?: string | null; search?: string; scope?: string }
  const cacheReads = vi.fn(
    async (_org: string, _def: string, _options: ListOptions): Promise<null> => null
  )
  const cacheWrites = vi.fn(
    async (
      _org: string,
      _def: string,
      _result: PaginatedResourcesResult,
      _options: ListOptions
    ): Promise<void> => undefined
  )
  ;(svc as unknown as { cache: unknown }).cache = {
    getCachedResources: cacheReads,
    cacheResources: cacheWrites,
  }
  return { svc, direct, cacheReads, cacheWrites }
}

/** The 8th positional argument of `fetchResourcesDirect` is `visibilityWhere`. */
function visibilityArg(direct: ReturnType<typeof vi.fn>): unknown {
  return direct.mock.calls[0]?.[6]
}

beforeEach(() => {
  vi.clearAllMocks()
  knowledgeBases.rows = [
    { id: STANDARD_KB, kind: 'standard' },
    { id: SOURCE_KB, kind: 'source' },
    { id: LEARNED_KB, kind: 'learned' },
  ]
})

describe('R4 — the scoped article search is narrowed at the choke point', () => {
  it('hands `fetchResourcesDirect` a predicate for a partially-scoped member', async () => {
    const { svc, direct } = service(view({ [STANDARD_KB]: 'edit' }))

    await svc.getResources({ entityDefinitionId: 'article', limit: 25, search: 'refund' })

    expect(direct).toHaveBeenCalledTimes(1)
    expect(visibilityArg(direct)).toBeDefined()
  })

  it('returns an empty page WITHOUT querying when no KB is viewable', async () => {
    const { svc, direct } = service(view({}))

    const result = await svc.getResources({
      entityDefinitionId: 'article',
      limit: 25,
      search: 'refund',
    })

    expect(result).toEqual({ items: [], nextCursor: null })
    expect(direct).not.toHaveBeenCalled()
  })

  it('leaves system tables with no per-row policy completely unscoped', async () => {
    // `participant` has no instance-access key and no one-hop owner, so the
    // article predicate must not leak onto it. (`user` would be the more obvious
    // choice but resolves its Drizzle table by name through the join strategy,
    // which this package's Vitest schema proxy cannot satisfy.)
    const { svc, direct } = service(view({}))

    await svc.getResources({ entityDefinitionId: 'participant', limit: 25 })

    expect(direct).toHaveBeenCalledTimes(1)
    expect(visibilityArg(direct)).toBeUndefined()
  })

  it('narrows `kb` in SQL rather than after the fetch', async () => {
    // This case used to assert the OPPOSITE — that `kb` reached the fetchers
    // unscoped, on the reasoning that a KB's own policy "stays post-fetch in
    // `admitSystemRows`". That was true only of the by-ids path. On a PAGINATED
    // path a post-fetch filter shorts the page and desyncs the cursor, which is
    // why `record.search` had to refuse `kb` outright instead. It no longer does.
    const { svc, direct } = service(view({ [STANDARD_KB]: 'edit' }))

    await svc.getResources({ entityDefinitionId: 'kb', limit: 25 })

    expect(direct).toHaveBeenCalledTimes(1)
    expect(visibilityArg(direct)).toBeDefined()
  })

  it('returns an empty page for a member with no viewable KB, WITHOUT querying', async () => {
    const { svc, direct } = service(view({}))

    const result = await svc.getResources({ entityDefinitionId: 'kb', limit: 25 })

    expect(direct).not.toHaveBeenCalled()
    expect(result.items).toEqual([])
  })

  it('leaves `kb` unscoped for an unrestricted member, so the common path pays nothing', async () => {
    const { svc, direct } = service(view('*'))

    await svc.getResources({ entityDefinitionId: 'kb', limit: 25 })

    expect(visibilityArg(direct)).toBeUndefined()
  })

  it('does not narrow an internal caller', async () => {
    const { svc, direct } = service(undefined)

    await svc.getResources({ entityDefinitionId: 'article', limit: 25 })

    expect(visibilityArg(direct)).toBeUndefined()
  })
})

describe('R5 — the ⌘K / @-reference global union goes through the SAME choke point', () => {
  it('narrows the article leg even though it never calls getResources', async () => {
    // `searchGlobalUnion` fans out over `RESOURCE_TABLE_MAP` calling
    // `fetchResourcesFromDb` directly. If the enforcement had been placed in
    // `getResources`, this call would hand `undefined` and the mention picker
    // would still read org-wide.
    const { svc, direct } = service(view({ [STANDARD_KB]: 'edit' }))

    await (
      svc as unknown as {
        fetchResourcesFromDb: (...a: unknown[]) => Promise<PaginatedResourcesResult>
      }
    ).fetchResourcesFromDb('article', 5, null, 'refund', undefined)

    expect(visibilityArg(direct)).toBeDefined()
  })
})

describe('§5.5 — the picker cache key learns the viewer', () => {
  it('passes the scope fingerprint on BOTH the read and the write', async () => {
    const { svc, cacheReads, cacheWrites } = service(view({ [STANDARD_KB]: 'edit' }))

    await svc.getResources({ entityDefinitionId: 'article', limit: 25, search: 'refund' })

    const expected = knowledgeBaseScopeFingerprint([STANDARD_KB])
    expect(cacheReads.mock.calls[0]?.[2]).toMatchObject({ scope: expected })
    // The WRITE must carry it too — a read keyed by scope that writes without
    // one just moves the collision to the next reader.
    expect(cacheWrites.mock.calls[0]?.[3]).toMatchObject({ scope: expected })
  })

  it('omits the dimension for tables that have no viewer-dependent scope', async () => {
    // Their keys must stay byte-identical to the ones they had before §5.5, or
    // this change silently cold-starts every other picker cache.
    const { svc, cacheReads } = service(view({ [STANDARD_KB]: 'edit' }))

    await svc.getResources({ entityDefinitionId: 'participant', limit: 25 })

    expect(cacheReads.mock.calls[0]?.[2]?.scope).toBeUndefined()
  })

  it('carries the dimension for `kb`, whose page IS viewer-dependent', async () => {
    // Without this the org-keyed cache would hand a restricted member's page to
    // an unrestricted one and vice versa — the same failure §5.5 closed for
    // `article`, and the reason `kb` could not simply be unblocked at the router.
    const narrow = service(view({ [STANDARD_KB]: 'edit' }))
    await narrow.svc.getResources({ entityDefinitionId: 'kb', limit: 25 })
    const narrowScope = narrow.cacheReads.mock.calls[0]?.[2]?.scope

    const other = service(view({ [LEARNED_KB]: 'edit' }))
    await other.svc.getResources({ entityDefinitionId: 'kb', limit: 25 })

    expect(narrowScope).toBeDefined()
    expect(other.cacheReads.mock.calls[0]?.[2]?.scope).not.toBe(narrowScope)
  })

  it('omits the `kb` dimension for an unrestricted member, keeping their key stable', async () => {
    const { svc, cacheReads } = service(view('*'))

    await svc.getResources({ entityDefinitionId: 'kb', limit: 25 })

    expect(cacheReads.mock.calls[0]?.[2]?.scope).toBeUndefined()
  })

  it('two members with DIFFERENT access get DIFFERENT key strings', async () => {
    // The property that matters, asserted on the key itself rather than on the
    // options bag: `buildListKey` must actually consume `scope`.
    const cache = new RecordPickerCacheService()
    const buildListKey = (
      cache as unknown as {
        buildListKey: (o: string, d: string, opts: Record<string, unknown>) => string
      }
    ).buildListKey.bind(cache)

    const narrow = buildListKey(ORG, 'article', {
      search: 'refund',
      scope: knowledgeBaseScopeFingerprint([STANDARD_KB]),
    })
    const wide = buildListKey(ORG, 'article', {
      search: 'refund',
      scope: knowledgeBaseScopeFingerprint([STANDARD_KB, LEARNED_KB]),
    })
    const unscoped = buildListKey(ORG, 'article', { search: 'refund' })

    expect(narrow).not.toBe(wide)
    expect(narrow).not.toBe(unscoped)
    expect(narrow).toContain('scope=')
    expect(unscoped).not.toContain('scope=')
  })

  it('two members with the SAME access share one key — the hit rate must survive', async () => {
    // §8.0: nearly everyone composes the same allow-list, so a user-id dimension
    // would fragment the cache by headcount for no enforcement gain.
    expect(knowledgeBaseScopeFingerprint([STANDARD_KB, LEARNED_KB])).toBe(
      knowledgeBaseScopeFingerprint([LEARNED_KB, STANDARD_KB])
    )
  })

  it("an internal caller's 'all' never collides with a member who sees nothing", async () => {
    expect(knowledgeBaseScopeFingerprint('all')).not.toBe(knowledgeBaseScopeFingerprint([]))
  })
})
