// packages/lib/src/permissions/capabilities/article-read-access.test.ts
//
// The ONE boolean article/KB read gate (plan v3/06 P5) — the convergence target
// for the six ad-hoc spellings in §2.5.
//
// ⚠ Nothing here asserts on a built Drizzle predicate: under this package's
// Vitest config `schema`'s COLUMNS are `{}`, so a column assertion passes
// vacuously. What IS assertable, and what this file pins, is **which queries run
// at all**, the arms, and the boolean answers.

import { beforeEach, describe, expect, it, vi } from 'vitest'

const knowledgeBases = vi.hoisted(() => ({ rows: [] as Array<{ id: string; kind: string }> }))

// A FULL factory, not `importOriginal` + spread — loading the real `cache`
// barrel drags its transitive graph back into the module under test while the
// factory is still running and the override silently never takes effect. Same
// shape as `article-visibility-scope.test.ts`.
vi.mock('../../cache', () => ({
  getCachedKnowledgeBases: vi.fn(async () => knowledgeBases.rows),
}))

import type { Database } from '@auxx/database'
import {
  canReadArticle,
  canReadKnowledgeBase,
  resolveArticleReadScope,
} from './article-read-access'
import type { CapabilityView } from './capability-view'

const ORG = 'org_abgwpa1l81reht2zmwrcih'

/** The dev fixture (plan §1.2). */
const STANDARD_KB = 'r7gncj0m9f88home9kp8j1s7'
const SOURCE_KB = 'd9mvw4li82k90ftph4h26n0m'
const LEARNED_KB = 'oixvifyqdgq5r0nz1wr2qsfy'
const OTHER_STANDARD_KB = 'oucloniq2dmfkxkt9h5u5h03'

/** §1.2's multi-home row: homed in the SOURCE KB, placed into the standard one. */
const MULTI_HOME_ARTICLE = 'gxbz6zn31qsebel4lhqek50y'
/** §1.2's source-ONLY row — it must disappear. */
const SOURCE_ONLY_ARTICLE = 'ng8kbpmv3nj166lneqv56n1d'

function seedOrgKbs(): void {
  knowledgeBases.rows = [
    { id: STANDARD_KB, kind: 'standard' },
    { id: OTHER_STANDARD_KB, kind: 'standard' },
    { id: SOURCE_KB, kind: 'source' },
    { id: LEARNED_KB, kind: 'learned' },
  ]
}

/** A `CapabilityView` stub exposing only the instance predicates this reads. */
function view(rungs: Record<string, 'read' | 'edit' | 'admin'> | '*'): CapabilityView {
  const at = (id: string) => (rungs === '*' ? 'edit' : rungs[id])
  return {
    canViewInstance: (_key: string, id: string) => at(id) !== undefined,
    canEditInstance: (_key: string, id: string) => at(id) === 'edit' || at(id) === 'admin',
    canAdminInstance: (_key: string, id: string) => at(id) === 'admin',
  } as unknown as CapabilityView
}

interface DbCalls {
  articles: number
  placements: number
}

/**
 * A `db` stub for the ONE article under test, counting which of the two reads
 * happened.
 *
 * Deliberately keyed on the **projection shape** rather than on the WHERE
 * clause: columns are `{}` under this package's Vitest config, so a real
 * `eq(...)` carries nothing a test can read back. Every case here exercises a
 * single article, so "which query" is all the routing that is needed — and the
 * assertion that actually matters (`calls`) is about whether a query ran at all.
 */
function stubDb(fixture: { home?: string; placements?: string[] } = {}): {
  db: Database
  calls: DbCalls
} {
  const calls: DbCalls = { articles: 0, placements: 0 }
  const db = {
    select(projection: Record<string, unknown>) {
      const isArticle = 'homeKnowledgeBaseId' in projection
      return {
        from: () => ({
          where: () => {
            let rows: Record<string, string>[]
            if (isArticle) {
              calls.articles += 1
              rows = fixture.home ? [{ homeKnowledgeBaseId: fixture.home }] : []
            } else {
              calls.placements += 1
              rows = (fixture.placements ?? []).map((knowledgeBaseId) => ({ knowledgeBaseId }))
            }
            return Object.assign(Promise.resolve(rows), { limit: async () => rows })
          },
        }),
      }
    },
  } as unknown as Database
  return { db, calls }
}

beforeEach(() => {
  seedOrgKbs()
})

describe('resolveArticleReadScope', () => {
  it('`capabilities: undefined` ⇒ unrestricted — the headless convention (§8.2)', async () => {
    const scope = await resolveArticleReadScope(ORG, undefined)
    expect(scope.unrestricted).toBe(true)
    expect(scope.canReadKnowledgeBase(SOURCE_KB)).toBe(true)
    expect(scope.canReadArticleIn([])).toBe(true)
  })

  it('a member who holds EVERY KB is still narrowed by `kind` — never `unrestricted`', async () => {
    // The load-bearing case, not a corner: `MEMBER_BASELINE_LEVELS` is
    // `knowledgeBase: Edit` and `kb` is `baselineAtCreate: false`, so a stock
    // member composes `edit` on every row-less KB — source KBs included.
    const scope = await resolveArticleReadScope(ORG, view('*'))
    expect(scope.unrestricted).toBe(false)
    expect(scope.canReadKnowledgeBase(SOURCE_KB)).toBe(false)
    expect(scope.canReadKnowledgeBase(LEARNED_KB)).toBe(true)
  })

  it('canReadArticleIn is any-of, and tolerates null/undefined entries', async () => {
    const scope = await resolveArticleReadScope(ORG, view({ [STANDARD_KB]: 'read' }))
    expect(scope.canReadArticleIn([SOURCE_KB, STANDARD_KB])).toBe(true)
    expect(scope.canReadArticleIn([SOURCE_KB, OTHER_STANDARD_KB])).toBe(false)
    expect(scope.canReadArticleIn([null, undefined])).toBe(false)
  })
})

describe('canReadKnowledgeBase — the KB-keyed half (I2 / I3 / I6)', () => {
  it('is stricter than a bare canViewInstance: a `source` KB is never readable', async () => {
    const caps = view('*')
    expect(caps.canViewInstance('kb', SOURCE_KB)).toBe(true)
    expect(await canReadKnowledgeBase(ORG, caps, SOURCE_KB)).toBe(false)
  })

  it('admits `learned` (AI Memory) — a member-facing KB, not a container', async () => {
    expect(await canReadKnowledgeBase(ORG, view({ [LEARNED_KB]: 'read' }), LEARNED_KB)).toBe(true)
  })

  it('denies a KB the member holds no rung on', async () => {
    expect(
      await canReadKnowledgeBase(ORG, view({ [STANDARD_KB]: 'read' }), OTHER_STANDARD_KB)
    ).toBe(false)
  })

  it('null/undefined ids fail closed', async () => {
    expect(await canReadKnowledgeBase(ORG, view('*'), null)).toBe(false)
    expect(await canReadKnowledgeBase(ORG, view('*'), undefined)).toBe(false)
  })
})

describe('canReadArticle — the article-keyed half (I4 / I5, §5.2)', () => {
  it('short-circuits on the home KB without touching ArticlePlacement', async () => {
    const { db, calls } = stubDb()
    const allowed = await canReadArticle(db, {
      organizationId: ORG,
      capabilities: view({ [STANDARD_KB]: 'read' }),
      articleId: 'art_home',
      homeKnowledgeBaseId: STANDARD_KB,
    })
    expect(allowed).toBe(true)
    // The common case must cost ZERO queries when the caller already read the
    // row — this gate sits in front of an SSE connect and an attachment download.
    expect(calls).toEqual({ articles: 0, placements: 0 })
  })

  it('admits a SOURCE-homed article through a placement in a KB the caller holds', async () => {
    // §1.2's `gxbz…`: the row a home-only predicate hides in the wrong direction.
    const { db, calls } = stubDb({ placements: [SOURCE_KB, STANDARD_KB] })
    const allowed = await canReadArticle(db, {
      organizationId: ORG,
      capabilities: view({ [STANDARD_KB]: 'read' }),
      articleId: MULTI_HOME_ARTICLE,
      homeKnowledgeBaseId: SOURCE_KB,
    })
    expect(allowed).toBe(true)
    expect(calls.placements).toBe(1)
  })

  it('drops a source-ONLY article, for every principal including a hold-everything member', async () => {
    // §6.1: `source` KBs are excluded unconditionally, so this row leaves every
    // reader that shares the rule. Its own surface is the knowledgeSources router.
    const { db } = stubDb({ placements: [SOURCE_KB] })
    const allowed = await canReadArticle(db, {
      organizationId: ORG,
      capabilities: view('*'),
      articleId: SOURCE_ONLY_ARTICLE,
      homeKnowledgeBaseId: SOURCE_KB,
    })
    expect(allowed).toBe(false)
  })

  it('reads the Article row when the caller supplies no home KB', async () => {
    const { db, calls } = stubDb({ home: STANDARD_KB })
    expect(
      await canReadArticle(db, {
        organizationId: ORG,
        capabilities: view({ [STANDARD_KB]: 'read' }),
        articleId: 'art_known',
      })
    ).toBe(true)
    expect(calls.articles).toBe(1)
  })

  it('an article absent from the org fails closed — invisible ≍ nonexistent', async () => {
    const { db, calls } = stubDb({})
    expect(
      await canReadArticle(db, {
        organizationId: ORG,
        capabilities: view({ [STANDARD_KB]: 'read' }),
        articleId: 'art_missing',
      })
    ).toBe(false)
    // And it stops there: no placement scan for a row that does not exist.
    expect(calls).toEqual({ articles: 1, placements: 0 })
  })

  it('an empty allow-list denies WITHOUT querying', async () => {
    const { db, calls } = stubDb({ home: STANDARD_KB })
    const allowed = await canReadArticle(db, {
      organizationId: ORG,
      capabilities: view({}),
      articleId: 'art_home',
    })
    expect(allowed).toBe(false)
    expect(calls).toEqual({ articles: 0, placements: 0 })
  })

  it('`capabilities: undefined` admits everything without querying', async () => {
    const { db, calls } = stubDb()
    expect(
      await canReadArticle(db, {
        organizationId: ORG,
        capabilities: undefined,
        articleId: SOURCE_ONLY_ARTICLE,
      })
    ).toBe(true)
    expect(calls).toEqual({ articles: 0, placements: 0 })
  })
})
