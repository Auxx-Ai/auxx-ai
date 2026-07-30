// apps/web/src/server/api/routers/dataset-org-aggregate-scope.test.ts

import type { ResourcePermission } from '@auxx/database/enums'
import { Area, expandLevelsToKeys, Level, PermissionKey } from '@auxx/lib/permissions/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * **The item-5b coarse-key audit, at the router layer.**
 *
 * Synthesizing the area Read rung from a member's instance grants makes every
 * procedure that asserts that coarse key newly reachable by a single-instance
 * grantee. For instance-SCOPED procedures that is exactly the point. For
 * ORG-WIDE aggregates it is a data leak, and `dataset.ts` held the only two such
 * sites in the whole server tree:
 *
 *  - `getOrganizationStats` — counts, document totals and byte sizes over EVERY
 *    non-managed dataset in the org.
 *  - `getAvailableEmbeddingOptions` — org-level AI configuration, no dataset in
 *    the input at all.
 *
 * Both used `ctx.capabilities.assert(PermissionKey.datasetsView)`, which stopped
 * being a real boundary the moment that key became derivable from one share.
 * The fixes are different on purpose and this file pins both:
 *  1. stats is SCOPED — `instanceListScope('dataset')` narrows the aggregate to
 *     the datasets the member may open, so the tiles agree with the grid;
 *  2. embedding options is made INSTANCE-SCOPED — it takes a `datasetId` and
 *     asserts on it.
 *
 * Behavioral: the real router is driven through a tRPC caller with a real
 * `CapabilitySet`. The narrowing is observed through `drizzle-orm`'s
 * `inArray`/`notInArray`, which is where the router's scoping decision actually
 * lands — dropping the scope stops calling them and fails a case here.
 */

const { datasetService, featureService, inArraySpy, notInArraySpy } = vi.hoisted(() => ({
  datasetService: {
    getAvailableEmbeddingOptions: vi.fn(async () => ({ systemDefault: 'openai:text-embed-3' })),
  },
  featureService: { requireAccess: vi.fn(async () => undefined) },
  inArraySpy: vi.fn(),
  notInArraySpy: vi.fn(),
}))

vi.mock('drizzle-orm', async (importOriginal) => {
  const actual = await importOriginal<typeof import('drizzle-orm')>()
  return {
    ...actual,
    inArray: (...args: Parameters<typeof actual.inArray>) => {
      inArraySpy(...(args as unknown[]))
      return actual.inArray(...args)
    },
    notInArray: (...args: Parameters<typeof actual.notInArray>) => {
      notInArraySpy(...(args as unknown[]))
      return actual.notInArray(...args)
    },
  }
})

vi.mock('@auxx/lib/datasets', () => ({
  DatasetService: class {
    getAvailableEmbeddingOptions = datasetService.getAvailableEmbeddingOptions
  },
  SearchService: {},
}))

vi.mock('@auxx/lib/cache', () => ({ onCacheEvent: vi.fn(async () => undefined) }))

// The `@auxx/lib/permissions` barrel reaches redis/db at import time and hangs
// under vitest — hand the router the real registry plus a stub feature service.
vi.mock('@auxx/lib/permissions', async () => {
  const registry = await import('@auxx/lib/permissions/capabilities/registry')
  const types = await import('@auxx/lib/permissions/types')
  return {
    PermissionKey: registry.PermissionKey,
    FeatureKey: types.FeatureKey,
    FeaturePermissionService: class {
      requireAccess = featureService.requireAccess
      requireAccessAndLimit = featureService.requireAccess
      requireLimit = featureService.requireAccess
    },
  }
})

vi.mock('~/server/api/trpc', async () => {
  const { initTRPC } = await import('@trpc/server')
  const t = initTRPC.context<Record<string, unknown>>().create()
  return {
    createTRPCRouter: t.router,
    capabilityProcedure: t.procedure,
    protectedProcedure: t.procedure,
    permissionProcedure: (key: string) =>
      t.procedure.use(({ ctx, next }) => {
        ;(ctx as { capabilities: { assert: (k: string) => void } }).capabilities.assert(key)
        return next()
      }),
    notDemo:
      () =>
      ({ next }: { next: () => unknown }) =>
        next(),
  }
})

// Deep path on purpose — the permissions barrel hangs under vitest.
const { CapabilitySet } = await import('@auxx/lib/permissions/capabilities/capability-set')
const { datasetRouter } = await import('./dataset')

const ORG_ID = 'org_cuid000000000000000000000'
const USER_ID = 'usr_cuid000000000000000000000'
const SHARED = 'ds_shared0000000000000000'
const OTHER = 'ds_other00000000000000000'

/** AuxxError, wrapped by tRPC as `cause` (the app's middleware maps it to 403). */
const FORBIDDEN = { cause: { name: 'ForbiddenError', statusCode: 403 } }

/**
 * A real `CapabilitySet`, composed the way `composeUserCapabilities` does it:
 * any `≥view` dataset row synthesizes `datasets.view` into the DERIVED key set —
 * never into `keys`, which stays the area-level source of truth.
 */
function caps(opts: {
  areaLevel?: Level
  rows?: Record<string, ResourcePermission>
  role?: 'MEMBER' | 'OWNER'
}) {
  const rows = opts.rows ?? {}
  const derived = Object.values(rows).some((p) => p !== 'none') ? [PermissionKey.datasetsView] : []
  return new CapabilitySet(
    new Set(expandLevelsToKeys({ [Area.datasets]: opts.areaLevel ?? Level.None })),
    {},
    opts.role ?? 'MEMBER',
    'full',
    undefined,
    undefined,
    undefined,
    rows,
    new Set(Object.keys(rows)),
    undefined,
    new Set(derived)
  )
}

const SESSION = {
  organizationId: ORG_ID,
  userId: USER_ID,
  isSuperAdmin: false,
  user: { id: USER_ID, defaultOrganizationId: ORG_ID, email: 'a@b.c', name: 'A' },
}

type Caps = InstanceType<typeof CapabilitySet>

/**
 * Query-builder stand-in for `getOrganizationStats`' four raw drizzle reads.
 * `selects` counts how many aggregate queries were issued, so "returned zeros
 * WITHOUT touching the DB" is an observable outcome rather than an inference.
 */
function fakeDb() {
  const selects = { count: 0 }
  // `where()` is both awaitable (the three scalar reads) and `.groupBy()`-able
  // (the status histogram), which is exactly what a drizzle builder is. Built as
  // a Promise with `groupBy` hung off it rather than a hand-rolled thenable.
  const where = () =>
    Object.assign(Promise.resolve([{ totalCount: 7, docSum: 42, sizeSum: 1024 }]), {
      groupBy: async () => [] as unknown[],
    })
  const chain = { from: () => chain, where } as { from: () => unknown; where: typeof where }
  return {
    selects,
    db: {
      select: () => {
        selects.count += 1
        return chain
      },
    },
  }
}

function caller(capabilities: Caps, db: unknown = fakeDb().db) {
  return datasetRouter.createCaller({ db, capabilities, session: SESSION } as never)
}

beforeEach(() => {
  inArraySpy.mockReset()
  notInArraySpy.mockReset()
  datasetService.getAvailableEmbeddingOptions.mockClear()
})

describe('dataset.getOrganizationStats — the org-wide aggregate is SCOPED, not coarse-gated', () => {
  it('narrows to an ALLOW-LIST for a member whose only access is one shared dataset', async () => {
    // THE LEAK THIS CLOSES. Before item 5b this member held no `datasets.view`
    // and got a 403; after it they hold the derived key, so without the scope
    // they would have received counts and byte sizes for every dataset in the
    // org — including the ones they cannot open.
    await caller(caps({ rows: { [SHARED]: 'read' } })).getOrganizationStats()
    expect(inArraySpy).toHaveBeenCalled()
    expect(inArraySpy.mock.calls[0]?.[1]).toEqual([SHARED])
    // An allow-list is the whole filter — nothing is expressed as an exclusion.
    expect(notInArraySpy).not.toHaveBeenCalled()
  })

  it('returns zeros WITHOUT querying when the member may see no dataset at all', async () => {
    const { db, selects } = fakeDb()
    const stats = await caller(caps({ rows: {} }), db).getOrganizationStats()
    expect(stats).toEqual({ total: 0, byStatus: {}, totalDocuments: 0, totalSize: 0n })
    expect(selects.count).toBe(0)
  })

  it('excludes the restricted datasets for a member with the area open', async () => {
    await caller(caps({ areaLevel: Level.Read, rows: { [OTHER]: 'none' } })).getOrganizationStats()
    expect(notInArraySpy.mock.calls[0]?.[1]).toEqual([OTHER])
    expect(inArraySpy).not.toHaveBeenCalled()
  })

  it('does not narrow at all for an unrestricted org', async () => {
    await caller(caps({ areaLevel: Level.Full })).getOrganizationStats()
    expect(inArraySpy).not.toHaveBeenCalled()
    expect(notInArraySpy).not.toHaveBeenCalled()
  })

  it('OWNER sees everything, unnarrowed', async () => {
    await caller(caps({ role: 'OWNER', rows: { [OTHER]: 'none' } })).getOrganizationStats()
    expect(inArraySpy).not.toHaveBeenCalled()
    expect(notInArraySpy).not.toHaveBeenCalled()
  })
})

describe('dataset.getAvailableEmbeddingOptions — instance-scoped, not coarse-gated', () => {
  it('succeeds for the dataset the member was actually granted', async () => {
    await expect(
      caller(caps({ rows: { [SHARED]: 'read' } })).getAvailableEmbeddingOptions({
        datasetId: SHARED,
      })
    ).resolves.toEqual({ systemDefault: 'openai:text-embed-3' })
    expect(datasetService.getAvailableEmbeddingOptions).toHaveBeenCalledTimes(1)
  })

  it('is refused for a dataset the member was NOT granted, despite the derived key', async () => {
    // The member holds `datasets.view` (derived from the SHARED grant) — the
    // exact caller the old coarse assert would have waved through.
    const member = caps({ rows: { [SHARED]: 'read' } })
    expect(member.can(PermissionKey.datasetsView)).toBe(true)
    await expect(
      caller(member).getAvailableEmbeddingOptions({ datasetId: OTHER })
    ).rejects.toMatchObject(FORBIDDEN)
    expect(datasetService.getAvailableEmbeddingOptions).not.toHaveBeenCalled()
  })

  it('is refused for a dataset restricted to `none`', async () => {
    await expect(
      caller(
        caps({ areaLevel: Level.Full, rows: { [OTHER]: 'none' } })
      ).getAvailableEmbeddingOptions({ datasetId: OTHER })
    ).rejects.toMatchObject(FORBIDDEN)
    expect(datasetService.getAvailableEmbeddingOptions).not.toHaveBeenCalled()
  })
})
