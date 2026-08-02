// apps/web/src/server/api/routers/record-article-scope.test.ts

import { Area, expandLevelsToKeys, Level } from '@auxx/lib/permissions/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Plan v3/06 — **the router seam for `article`**.
 *
 * The narrowing itself lives in `@auxx/lib`
 * (`permissions/capabilities/article-visibility-scope.ts`, applied by the record
 * lane's system-table dispatch), which is where it is unit-tested. What this
 * file pins is the seam either side of it, because three separate decisions meet
 * here and each one is easy to undo by accident:
 *
 *  1. **`article` is deliberately NOT refused at the router** (§4.1). The cheap
 *     alternative was to add it to whatever `assertNotInstanceAccessDefForRead`
 *     refuses, the way `kb` and `dataset` are handled. That was rejected:
 *     `article` has a shipped records-table surface (`ArticlesView` at
 *     `/app/kb`), its own ranked search binding, inline tag editing, saved views,
 *     favourites and the only system-table dashboard aggregate in the product.
 *     Refusing the def deletes all of that. So the read must pass through — and a
 *     future reader "tidying up" by refusing it would break the KB UI while
 *     believing they were closing a hole.
 *  2. **Non-enumeration survives the seam.** A row the lib layer dropped must
 *     leave NO key behind in `getByIds`' map — not `null`, not an empty object.
 *  3. **A 403 from the per-row write gate stays a 403.** The router re-wraps
 *     errors, and a causeless re-wrap flattens an `AuxxError` into a generic 500
 *     — which reads to the client as a bug rather than a denial, and defeats the
 *     access-request lane that keys off the status.
 */

const ORG_ID = 'org_abgwpa1l81reht2zmwrcih'
const USER_ID = 'usr_0D5csE1ejLpyv3rKq3wLQ'

/** The org's `article` EntityDefinition — a CUID, not the `'article'` slug. */
const ARTICLE_DEF = 'qkmgvfi61m4ubmfrxg7y3mzc'
/** Homed in the KB the member holds. */
const VISIBLE_ARTICLE = 'exz17f3i1qu96ik6azu763as'
/** Homed in AI Memory, which the member does not hold. */
const HIDDEN_ARTICLE = 'em0s33wstyynminepz1zkq8t'

const { handler, cache, identity, fieldValues } = vi.hoisted(() => ({
  handler: {
    getByIds: vi.fn(async () => ({}) as Record<string, { _access?: string }>),
    listFiltered: vi.fn(async () => ({ ids: [] as string[], total: 0, hasMore: false })),
    delete: vi.fn(async () => undefined),
  },
  cache: {
    getCachedResources: vi.fn(async () => [] as unknown[]),
    getCachedResource: vi.fn(async () => undefined as unknown),
  },
  identity: { getRecordIdentityViews: vi.fn(async () => []) },
  fieldValues: { getDescendantIds: vi.fn(async () => []) },
}))

vi.mock('@auxx/lib/resources', () => ({
  RESOURCE_TABLE_REGISTRY: [],
  UnifiedCrudHandler: class {
    getByIds = handler.getByIds
    listFiltered = handler.listFiltered
    delete = handler.delete
  },
}))

vi.mock('@auxx/lib/cache', () => ({
  getCachedResources: cache.getCachedResources,
  getCachedResource: cache.getCachedResource,
}))
vi.mock('@auxx/lib/identity', () => ({
  getRecordIdentityViews: identity.getRecordIdentityViews,
}))
vi.mock('@auxx/lib/field-values', () => ({ getDescendantIds: fieldValues.getDescendantIds }))
vi.mock('@auxx/lib/conditions', async () => {
  const { z } = await import('zod')
  return { conditionGroupSchema: z.any() }
})

// The barrel hangs under vitest — hand back the REAL guards from their deep
// modules. Faking `isInstanceAccessKey` would make property 1 self-fulfilling:
// the whole point is that `article` is genuinely not an instance-access key.
vi.mock('@auxx/lib/permissions', async () => {
  const registry = await import('@auxx/lib/permissions/capabilities/registry')
  const instanceAccess = await import('@auxx/lib/permissions/capabilities/instance-access')
  return {
    PermissionKey: registry.PermissionKey,
    isInstanceAccessKey: instanceAccess.isInstanceAccessKey,
  }
})

vi.mock('~/server/api/trpc', async () => {
  const { initTRPC } = await import('@trpc/server')
  const t = initTRPC.context<Record<string, unknown>>().create()
  return {
    createTRPCRouter: t.router,
    capabilityProcedure: t.procedure,
    protectedProcedure: t.procedure,
    isAuxxError: (e: unknown): boolean =>
      typeof e === 'object' && e !== null && 'statusCode' in e && 'name' in e,
  }
})

const { CapabilitySet } = await import('@auxx/lib/permissions/capabilities/capability-set')
const { recordRouter } = await import('./record')

const FORBIDDEN = { cause: { name: 'ForbiddenError', statusCode: 403 } }

const RESOURCES = [
  { id: ARTICLE_DEF, entityDefinitionId: ARTICLE_DEF, apiSlug: 'articles', entityType: 'article' },
  { id: 'kb', entityDefinitionId: 'kb', apiSlug: 'knowledge-bases', entityType: 'kb' },
]

/**
 * A real `CapabilitySet` for a member at `records: level`.
 *
 * `records: None` is the configuration this plan is about: a member who holds
 * `knowledgeBase: Edit` and nothing on Records is refused every generic write on
 * an article by the def gate (`ENTITY_WRITE_KEYS` has no `article` entry, so
 * `canEditEntity('article')` resolves to `PermissionKey.recordsEdit`), and the
 * `_access` stamp is the only thing that can give it back.
 */
function member(level: Level) {
  return new CapabilitySet(
    new Set(expandLevelsToKeys({ [Area.records]: level })),
    {},
    'USER',
    'full',
    (id) => id,
    new Set<string>(),
    (id) => id
  )
}

function caller(capabilities: unknown) {
  return recordRouter.createCaller({
    db: {},
    headers: new Headers(),
    capabilities,
    session: { organizationId: ORG_ID, userId: USER_ID, user: { id: USER_ID } },
  } as never)
}

beforeEach(() => {
  vi.clearAllMocks()
  handler.getByIds.mockResolvedValue({})
  handler.listFiltered.mockResolvedValue({ ids: [], total: 0, hasMore: false })
  cache.getCachedResources.mockResolvedValue(RESOURCES)
})

describe('the read arm admits `article` and hands the def straight through', () => {
  it('does NOT refuse `article` — the records-table surface depends on it (§4.1)', async () => {
    handler.listFiltered.mockResolvedValue({ ids: [VISIBLE_ARTICLE], total: 1, hasMore: false })

    const result = await caller(member(Level.Full)).listFiltered({
      entityDefinitionId: 'article',
      limit: 100,
    })

    expect(result.ids).toEqual([VISIBLE_ARTICLE])
    expect(handler.listFiltered).toHaveBeenCalledWith(
      expect.objectContaining({ entityDefinitionId: 'article' })
    )
  })

  it('still REFUSES `kb` on the same procedure — the contrast that makes the choice deliberate', async () => {
    // `kb` and `dataset` can be refused because they have a dedicated router and
    // no records-table surface. `article` cannot. If this ever starts passing,
    // the leak the guard's own comment predicts is back.
    await expect(
      caller(member(Level.Full)).listFiltered({ entityDefinitionId: 'kb', limit: 100 })
    ).rejects.toMatchObject(FORBIDDEN)
  })

  it('reports the narrowed `total` verbatim — no re-count at the seam', async () => {
    // The v3/02 property: `total` must describe the VISIBLE set, and the router
    // must not "helpfully" substitute a different number.
    handler.listFiltered.mockResolvedValue({ ids: [VISIBLE_ARTICLE], total: 1, hasMore: false })

    const result = await caller(member(Level.Full)).listFiltered({
      entityDefinitionId: 'article',
      limit: 100,
    })

    expect(result.total).toBe(1)
  })
})

describe('hydration — non-enumeration survives the seam', () => {
  it('a dropped article leaves NO key behind', async () => {
    // The lib layer returns only the admitted row. The router must not backfill
    // the requested-but-absent id with `null` — the caller must not be able to
    // tell "does not exist" from "exists and is not yours".
    handler.getByIds.mockResolvedValue({
      [`${ARTICLE_DEF}:${VISIBLE_ARTICLE}`]: { _access: 'edit' },
    })

    const result = await caller(member(Level.Full)).getByIds({
      items: [`${ARTICLE_DEF}:${VISIBLE_ARTICLE}`, `${ARTICLE_DEF}:${HIDDEN_ARTICLE}`],
    })

    expect(Object.keys(result)).toEqual([`${ARTICLE_DEF}:${VISIBLE_ARTICLE}`])
    expect(`${ARTICLE_DEF}:${HIDDEN_ARTICLE}` in result).toBe(false)
  })
})

describe('the per-row write gate — a 403 stays a 403', () => {
  it('refuses with 403 (not 500) when the article came back with NO stamp', async () => {
    // "Missing stamp ⇒ deny" is the rule, and the status matters: a flattened
    // 500 reads as a bug and the access-request lane keys off the code.
    handler.getByIds.mockResolvedValue({ [`${ARTICLE_DEF}:${HIDDEN_ARTICLE}`]: {} })

    await expect(
      caller(member(Level.Read)).delete({ recordId: `${ARTICLE_DEF}:${HIDDEN_ARTICLE}` })
    ).rejects.toMatchObject(FORBIDDEN)
    expect(handler.delete).not.toHaveBeenCalled()
  })

  it('refuses with 403 when the article was dropped from the read entirely', async () => {
    handler.getByIds.mockResolvedValue({})

    await expect(
      caller(member(Level.Read)).delete({ recordId: `${ARTICLE_DEF}:${HIDDEN_ARTICLE}` })
    ).rejects.toMatchObject(FORBIDDEN)
  })

  it('ALLOWS the write once the stamp exists — this is P2’s point, not a side effect', async () => {
    // A `records: Full` member is def-allowed, so the stamp is never read. The
    // case that matters is the def-DENIED one below; this pins that the seam
    // does not refuse a legitimately stamped article row.
    handler.getByIds.mockResolvedValue({
      [`${ARTICLE_DEF}:${VISIBLE_ARTICLE}`]: { _access: 'admin' },
    })

    await caller(member(Level.Read)).delete({ recordId: `${ARTICLE_DEF}:${VISIBLE_ARTICLE}` })

    expect(handler.delete).toHaveBeenCalledTimes(1)
  })
})
