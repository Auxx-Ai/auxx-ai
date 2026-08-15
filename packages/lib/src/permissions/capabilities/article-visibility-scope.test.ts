// packages/lib/src/permissions/capabilities/article-visibility-scope.test.ts
//
// The PURE half of plan v3/06's article-visibility module: the `kind` policy,
// the allow-list fold, the rung folds and the arm decision.
//
// ⚠ Nothing here asserts on a built Drizzle predicate. Under this package's
// Vitest config `schema`'s COLUMNS are `{}` (table refs are assertable since
// #1409; columns still are not), so `expect(predicate).toContain(...)` passes
// vacuously and a wrong column reference in `articleVisibilitySql` is
// structurally uncatchable here. That is why P1b's acceptance requires one real
// query against dev postgres — see the plan's §9 P1b banner. What IS assertable,
// and what this file pins, is **arms and id lists**.

import { beforeEach, describe, expect, it, vi } from 'vitest'

const knowledgeBases = vi.hoisted(() => ({ rows: [] as Array<{ id: string; kind: string }> }))

// A FULL factory, not `importOriginal` + spread: loading the real `cache` barrel
// drags its transitive graph back into the module under test while the factory
// is still running, and the override silently never takes effect. Every sibling
// file in this repo that mocks `../../cache` uses this shape for that reason.
vi.mock('../../cache', () => ({
  getCachedKnowledgeBases: vi.fn(async () => knowledgeBases.rows),
}))

import {
  articleAccessRung,
  articleRowAccess,
  articleWriteRung,
  systemTableVisibilityScope,
  viewableKnowledgeBaseIds,
} from './article-visibility-scope'
import type { CapabilityView } from './capability-view'

const ORG = 'org_abgwpa1l81reht2zmwrcih'

/** The dev fixture (plan §1.2), which is also the shape the DB check uses. */
const STANDARD_KB = 'r7gncj0m9f88home9kp8j1s7'
const SOURCE_KB = 'd9mvw4li82k90ftph4h26n0m'
const LEARNED_KB = 'oixvifyqdgq5r0nz1wr2qsfy'
const OTHER_STANDARD_KB = 'oucloniq2dmfkxkt9h5u5h03'

function seedOrgKbs(): void {
  knowledgeBases.rows = [
    { id: STANDARD_KB, kind: 'standard' },
    { id: OTHER_STANDARD_KB, kind: 'standard' },
    { id: SOURCE_KB, kind: 'source' },
    { id: LEARNED_KB, kind: 'learned' },
  ]
}

/**
 * A `CapabilityView` stub exposing only the three instance predicates this
 * module reads. `rungs` maps a KB id → the highest rung the member holds; an
 * absent id is not viewable at all.
 *
 * ⚠ `'*'` means "every KB", which is the SEEDED BASELINE, not an exotic case:
 * `MEMBER_BASELINE_LEVELS[Area.knowledgeBase]` is `Level.Edit` and `kb` is
 * `baselineAtCreate: false`, so a stock member composes `edit` on every KB
 * carrying no restricting row — source KBs included.
 */
function view(rungs: Record<string, 'read' | 'edit' | 'admin'> | '*'): CapabilityView {
  const at = (id: string) => (rungs === '*' ? 'edit' : rungs[id])
  return {
    canViewInstance: (_key: string, id: string) => at(id) !== undefined,
    canEditInstance: (_key: string, id: string) => at(id) === 'edit' || at(id) === 'admin',
    canAdminInstance: (_key: string, id: string) => at(id) === 'admin',
    // `'*'` means "holds everything", which as a filter is a deny-list of
    // nothing; a named map is an allow-list of exactly those ids.
    instanceListScope: () =>
      rungs === '*'
        ? { kind: 'exclude', excludeIds: [] }
        : Object.keys(rungs).length > 0
          ? { kind: 'include', includeIds: Object.keys(rungs) }
          : { kind: 'none' },
  } as unknown as CapabilityView
}

beforeEach(() => {
  seedOrgKbs()
})

describe('viewableKnowledgeBaseIds — the allow-list and the `kind` policy', () => {
  it('excludes `kind: source` even when the member composes edit on it', async () => {
    // This is the load-bearing case, not a corner: under the seeded baseline
    // `canViewInstance('kb', <source kb>)` is TRUE for almost everyone, so the
    // kind policy is the ONLY thing keeping source-managed articles out.
    const ids = await viewableKnowledgeBaseIds(ORG, view('*'))

    expect(ids).not.toContain(SOURCE_KB)
    // And it is a real id LIST, never `'all'` — a member who holds every KB is
    // still narrowed, because the exclusion is by `kind`, not by grant.
    expect(ids).toEqual([STANDARD_KB, OTHER_STANDARD_KB, LEARNED_KB])
  })

  it('INCLUDES `kind: learned` — AI Memory is a member-facing KB, not a container', async () => {
    const ids = await viewableKnowledgeBaseIds(ORG, view('*'))

    expect(ids).toContain(LEARNED_KB)
  })

  it('keeps only the KBs the member may actually view', async () => {
    const ids = await viewableKnowledgeBaseIds(ORG, view({ [STANDARD_KB]: 'edit' }))

    expect(ids).toEqual([STANDARD_KB])
  })

  it('is EMPTY when the member holds nothing — not a wildcard', async () => {
    // The fail-open shape this must never take: "no grants" ⇒ "no restriction".
    expect(await viewableKnowledgeBaseIds(ORG, view({}))).toEqual([])
  })

  it("`capabilities: undefined` ⇒ 'all' — headless callers stay unrestricted", async () => {
    // Article sync, embedding jobs, `apps/kb` rendering and the widget API all
    // run with no member. The convention is load-bearing (§8.2).
    expect(await viewableKnowledgeBaseIds(ORG, undefined)).toBe('all')
  })
})

describe('systemTableVisibilityScope — the arm decision', () => {
  it("answers arm 'all' for system tables with no per-row policy at all", async () => {
    // `kb` and `dataset` are deliberately NOT in this list: they ARE
    // instance-access grant targets, so they delegate to
    // `instanceTableVisibilityScope` instead — see the two cases below.
    for (const tableId of ['user', 'participant', 'visit'] as const) {
      const scope = await systemTableVisibilityScope({
        organizationId: ORG,
        tableId,
        capabilities: view({}),
      })
      expect(scope.arm).toBe('all')
    }
  })

  it('delegates `kb` / `dataset` to their instance-access scope', async () => {
    // A member who can view nothing must not query at all, on either table.
    for (const tableId of ['kb', 'dataset'] as const) {
      const scope = await systemTableVisibilityScope({
        organizationId: ORG,
        tableId,
        capabilities: view({}),
      })
      expect(scope.arm).toBe('none')
    }
  })

  it('leaves `kb` / `dataset` unscoped for an unrestricted member, so nothing pays for the arm', async () => {
    for (const tableId of ['kb', 'dataset'] as const) {
      const scope = await systemTableVisibilityScope({
        organizationId: ORG,
        tableId,
        capabilities: view('*'),
      })
      expect(scope.arm).toBe('all')
      expect(scope.where).toBeUndefined()
    }
  })

  it("answers arm 'none' for `article` when no KB is viewable — the caller must not query", async () => {
    const scope = await systemTableVisibilityScope({
      organizationId: ORG,
      tableId: 'article',
      capabilities: view({}),
    })

    expect(scope.arm).toBe('none')
    expect(scope.where).toBeUndefined()
  })

  it("still answers 'restricted' for a member who holds EVERY KB — because source KBs are excluded", async () => {
    // 🔴 The plan's §8.0 says a stock org "narrows nothing". It is wrong: the
    // `kind` half narrows for everyone, OWNER included, so an org with a
    // KnowledgeSource always carries the predicate. An `arm: 'all'` shortcut here
    // would re-admit the source-only rows §6.1 removes.
    const scope = await systemTableVisibilityScope({
      organizationId: ORG,
      tableId: 'article',
      capabilities: view('*'),
    })

    expect(scope.arm).toBe('restricted')
    expect(scope.where).toBeDefined()
  })

  it("answers arm 'restricted' with a predicate when only SOME KBs are viewable", async () => {
    const scope = await systemTableVisibilityScope({
      organizationId: ORG,
      tableId: 'article',
      capabilities: view({ [STANDARD_KB]: 'edit' }),
    })

    expect(scope.arm).toBe('restricted')
    // Presence only. The predicate's CONTENT is unassertable here (columns are
    // `{}`); the real-DB check in the plan's §9 is what verifies it.
    expect(scope.where).toBeDefined()
  })

  it("`capabilities: undefined` ⇒ arm 'all' for `article` too", async () => {
    const scope = await systemTableVisibilityScope({
      organizationId: ORG,
      tableId: 'article',
      capabilities: undefined,
    })

    expect(scope.arm).toBe('all')
  })
})

describe('articleAccessRung — the READ rung, `max` across placements', () => {
  it('takes the HIGHEST rung, not the lowest', async () => {
    // An article linked into a KB the member administers is administrable there;
    // a second placement in a KB they merely read cannot take that away.
    const caps = view({ [STANDARD_KB]: 'read', [OTHER_STANDARD_KB]: 'admin' })

    expect(articleAccessRung(caps, [STANDARD_KB, OTHER_STANDARD_KB])).toBe('admin')
    expect(articleAccessRung(caps, [OTHER_STANDARD_KB, STANDARD_KB])).toBe('admin')
  })

  it('is `undefined` for an empty list — the row drops', () => {
    expect(articleAccessRung(view('*'), [])).toBeUndefined()
  })

  it('ignores KB ids the member cannot view', () => {
    expect(articleAccessRung(view({ [STANDARD_KB]: 'read' }), [LEARNED_KB])).toBeUndefined()
  })
})

describe('articleWriteRung — home-strict (§7.3 / §11 item 3)', () => {
  const viewable = new Set([STANDARD_KB, OTHER_STANDARD_KB])

  it('reads the HOME KB, never a placement', () => {
    const caps = view({ [STANDARD_KB]: 'read', [OTHER_STANDARD_KB]: 'admin' })

    // Home = the read-only KB. The `admin` placement must NOT lift it, or a
    // linked-placement grant rewrites content in a KB the member cannot open.
    expect(articleWriteRung(caps, STANDARD_KB, viewable)).toBe('read')
  })

  it('is `undefined` when the home KB is outside the allow-list (e.g. a source KB)', () => {
    // The seeded baseline says `canEditInstance('kb', <source kb>)` is true, so
    // without the allow-list check this would return `edit`.
    expect(articleWriteRung(view('*'), SOURCE_KB, viewable)).toBeUndefined()
  })

  it('is `undefined` when the article has no home KB at all', () => {
    expect(articleWriteRung(view('*'), null, viewable)).toBeUndefined()
  })
})

describe('articleRowAccess — the `_access` stamp (§7.1 + §7.3)', () => {
  const viewable = new Set([STANDARD_KB, OTHER_STANDARD_KB, LEARNED_KB])

  it('drops a row whose every KB is unviewable', () => {
    expect(
      articleRowAccess({
        capabilities: view({ [STANDARD_KB]: 'edit' }),
        placementKbIds: [LEARNED_KB],
        homeKnowledgeBaseId: LEARNED_KB,
        viewableKbIds: new Set([STANDARD_KB]),
      })
    ).toBeUndefined()
  })

  it('drops a row placed ONLY in a source KB — the allow-list is the gate', () => {
    // `ng8kbpmv3nj166lneqv56n1d` in the dev fixture. `capabilities` says edit
    // (seeded baseline); the allow-list says no.
    expect(
      articleRowAccess({
        capabilities: view('*'),
        placementKbIds: [SOURCE_KB],
        homeKnowledgeBaseId: SOURCE_KB,
        viewableKbIds: viewable,
      })
    ).toBeUndefined()
  })

  it('ADMITS a source-homed article that is PLACED into a viewable KB', () => {
    // `gxbz6zn31qsebel4lhqek50y` in the dev fixture — the whole multi-home story.
    // A home-only predicate would hide a row deliberately published into a KB
    // the member owns.
    expect(
      articleRowAccess({
        capabilities: view('*'),
        placementKbIds: [SOURCE_KB, STANDARD_KB],
        homeKnowledgeBaseId: SOURCE_KB,
        viewableKbIds: viewable,
      })
    ).toBe('read')
  })

  it('stamps the HOME rung for an ordinary single-placement article', () => {
    // The common case: home === the only placement, so read and write agree and
    // a `knowledgeBase: Edit` member gets `edit` — which is what restores inline
    // tag editing through `assertRecordRowsEditable` (§7.2).
    expect(
      articleRowAccess({
        capabilities: view({ [STANDARD_KB]: 'edit' }),
        placementKbIds: [STANDARD_KB],
        homeKnowledgeBaseId: STANDARD_KB,
        viewableKbIds: viewable,
      })
    ).toBe('edit')
  })

  it('does NOT let a linked-placement `admin` grant raise the stamp above the home rung', () => {
    // The §7.3 property, stated as the stamp rather than as prose: `_access` IS
    // what `canEditRecordAt` / `canDeleteRecordAt` judge.
    expect(
      articleRowAccess({
        capabilities: view({ [STANDARD_KB]: 'read', [OTHER_STANDARD_KB]: 'admin' }),
        placementKbIds: [STANDARD_KB, OTHER_STANDARD_KB],
        homeKnowledgeBaseId: STANDARD_KB,
        viewableKbIds: viewable,
      })
    ).toBe('read')
  })

  it("falls back to 'read' when the row is reachable but its home KB is not", () => {
    // Readable through the placement, writable nowhere. Never `undefined` (that
    // would drop a legitimately linked row) and never `edit`.
    expect(
      articleRowAccess({
        capabilities: view('*'),
        placementKbIds: [SOURCE_KB, STANDARD_KB],
        homeKnowledgeBaseId: SOURCE_KB,
        viewableKbIds: viewable,
      })
    ).toBe('read')
  })
})
