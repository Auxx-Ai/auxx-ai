// apps/web/src/server/api/routers/dataset-instance-access.test.ts

import type { ResourcePermission } from '@auxx/database/enums'
import { Area, expandLevelsToKeys, Level } from '@auxx/lib/permissions/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Plan 24 §A.4's dataset half, at the router layer: **`edit` must not reach
 * settings / archive / delete** (those are `assertAdminInstance`), `view` must not
 * reach the one edit-level mutation (`updateMetrics`), and the reads — including
 * `testSearchConfig`, downgraded from admin to view by §A.2.2 — must stay open at
 * `view`.
 *
 * `ctx.capabilities` is a real {@link CapabilitySet}, so these fail if an assert
 * is deleted or weakened (edit→view, admin→edit). `DatasetService` is the
 * observed side effect: "did the write get through?".
 */

const { datasetService, searchService, featureService, onCacheEvent, listFixture } = vi.hoisted(
  () => {
    /** The org's datasets, as the query sees them. Mutated per test. */
    const listFixture: { ids: string[] } = { ids: [] }
    return {
      listFixture,
      datasetService: {
        create: vi.fn(async () => ({ id: 'dset_new' })),
        getById: vi.fn(async () => ({ id: 'dset_1' })),
        getStats: vi.fn(async () => ({ documentCount: 0 })),
        /**
         * Stands in for `DatasetService.list`, reproducing the ONE property
         * `list`'s contract rests on: `excludeIds` is applied with the other
         * predicates and **before** the slice (the real service pushes it into
         * the where-clause shared by the `findMany` and the `count()`), so
         * `totalCount`/`hasMore` describe the filtered set. A mock that ignored
         * `excludeIds` would let a router that stopped passing it still pass.
         */
        list: vi.fn(
          async (
            _organizationId: string,
            filters: { excludeIds?: readonly string[] },
            pagination: { page: number; limit: number }
          ) => {
            const excluded = new Set(filters.excludeIds ?? [])
            const visible = listFixture.ids.filter((id) => !excluded.has(id))
            const offset = (pagination.page - 1) * pagination.limit
            const page = visible.slice(offset, offset + pagination.limit)
            return {
              datasets: page.map((id) => ({ id })),
              totalCount: visible.length,
              hasMore: visible.length > offset + page.length,
            }
          }
        ),
        update: vi.fn(async () => ({ id: 'dset_1' })),
        updateMetrics: vi.fn(async () => undefined),
        delete: vi.fn(async () => undefined),
      },
      searchService: {
        search: vi.fn(async () => ({
          results: [],
          total: 0,
          responseTime: 1,
          searchType: 'hybrid',
        })),
      },
      featureService: { requireAccess: vi.fn(async () => undefined) },
      onCacheEvent: vi.fn(async () => undefined),
    }
  }
)

vi.mock('@auxx/lib/datasets', () => ({
  DatasetService: class {
    create = datasetService.create
    getById = datasetService.getById
    getStats = datasetService.getStats
    list = datasetService.list
    update = datasetService.update
    updateMetrics = datasetService.updateMetrics
    delete = datasetService.delete
  },
  SearchService: searchService,
}))

vi.mock('@auxx/lib/cache', () => ({ onCacheEvent }))

// The `@auxx/lib/permissions` barrel reaches redis/db at import time and hangs
// under vitest — hand the router the real registry/feature enums it needs and a
// stub feature service (Layer-1 plan gating is not what this file is about).
vi.mock('@auxx/lib/permissions', async () => {
  const registry = await import('@auxx/lib/permissions/capabilities/registry')
  const types = await import('@auxx/lib/permissions/types')
  return {
    PermissionKey: registry.PermissionKey,
    FeatureKey: types.FeatureKey,
    FeaturePermissionService: class {
      requireAccess = featureService.requireAccess
      requireAccessAndLimit = featureService.requireAccess
    },
  }
})

vi.mock('~/server/api/trpc', async () => {
  const { initTRPC } = await import('@trpc/server')
  const t = initTRPC.context<Record<string, unknown>>().create()
  return { createTRPCRouter: t.router, capabilityProcedure: t.procedure }
})

// Deep path on purpose — see the note in `segment-instance-access.test.ts`.
const { CapabilitySet } = await import('@auxx/lib/permissions/capabilities/capability-set')
const { datasetRouter } = await import('./dataset')

const ORG_ID = 'org_cuid000000000000000000000'
const USER_ID = 'usr_cuid000000000000000000000'
const DATASET_ID = 'dset_cuid00000000000000000000'

/** AuxxError, wrapped by tRPC as `cause` (the app's middleware maps it to 403). */
const FORBIDDEN = { cause: { name: 'ForbiddenError', statusCode: 403 } }

/** A real `CapabilitySet` holding `permission` on {@link DATASET_ID} via an explicit row. */
function capabilitiesFor(
  permission: ResourcePermission,
  instances: Record<string, ResourcePermission> = { [DATASET_ID]: permission }
) {
  const areaLevel = {
    ['none']: Level.None,
    ['read']: Level.Read,
    ['edit']: Level.Edit,
    ['admin']: Level.Full,
  }[permission]
  return new CapabilitySet(
    new Set(expandLevelsToKeys({ [Area.datasets]: areaLevel })),
    {},
    'MEMBER',
    'full',
    undefined,
    undefined,
    undefined,
    instances,
    new Set(Object.keys(instances))
  )
}

function caller(capabilities: InstanceType<typeof CapabilitySet>) {
  return datasetRouter.createCaller({
    db: {},
    capabilities,
    session: {
      organizationId: ORG_ID,
      userId: USER_ID,
      user: { id: USER_ID, defaultOrganizationId: ORG_ID },
    },
  } as any)
}

/** Settings-class mutations: Full only (`assertAdminInstance`). */
const ADMIN_ONLY = [
  [
    'update',
    (c: ReturnType<typeof caller>) => c.update({ id: DATASET_ID, data: { name: 'x' } }),
    'update',
  ],
  ['archive', (c: ReturnType<typeof caller>) => c.archive({ id: DATASET_ID }), 'update'],
  ['delete', (c: ReturnType<typeof caller>) => c.delete({ id: DATASET_ID }), 'delete'],
] as const

beforeEach(() => {
  for (const fn of Object.values(datasetService)) fn.mockClear()
  searchService.search.mockClear()
})

describe('dataset router — `edit` does not reach settings/archive/delete (plan 24 §A.4)', () => {
  it.each(ADMIN_ONLY)('%s is refused at instance edit', async (_name, call, serviceFn) => {
    await expect(call(caller(capabilitiesFor('edit')))).rejects.toMatchObject(FORBIDDEN)
    expect(datasetService[serviceFn]).not.toHaveBeenCalled()
  })

  it.each(ADMIN_ONLY)('%s is refused at instance view', async (_name, call, serviceFn) => {
    await expect(call(caller(capabilitiesFor('read')))).rejects.toMatchObject(FORBIDDEN)
    expect(datasetService[serviceFn]).not.toHaveBeenCalled()
  })

  it.each(ADMIN_ONLY)('%s succeeds at instance admin', async (_name, call, serviceFn) => {
    await expect(call(caller(capabilitiesFor('admin')))).resolves.toBeDefined()
    expect(datasetService[serviceFn]).toHaveBeenCalledTimes(1)
  })

  it('creating a dataset needs the coarse datasets Full rung, not instance edit', async () => {
    await expect(
      caller(capabilitiesFor('edit')).create({
        name: 'New',
        vectorDbType: 'POSTGRESQL',
      })
    ).rejects.toMatchObject(FORBIDDEN)
    expect(datasetService.create).not.toHaveBeenCalled()
  })
})

describe('dataset router — the edit rung', () => {
  it('updateMetrics (content churn, not settings) succeeds at instance edit', async () => {
    await expect(
      caller(capabilitiesFor('edit')).updateMetrics({ id: DATASET_ID })
    ).resolves.toEqual({ success: true })
    expect(datasetService.updateMetrics).toHaveBeenCalledTimes(1)
  })

  it('updateMetrics is refused at instance view', async () => {
    await expect(
      caller(capabilitiesFor('read')).updateMetrics({ id: DATASET_ID })
    ).rejects.toMatchObject(FORBIDDEN)
    expect(datasetService.updateMetrics).not.toHaveBeenCalled()
  })
})

describe('dataset router — reads stay open at instance view', () => {
  it('getById and getStats succeed at view', async () => {
    const c = caller(capabilitiesFor('read'))
    await expect(c.getById({ id: DATASET_ID })).resolves.toBeDefined()
    await expect(c.getStats({ id: DATASET_ID })).resolves.toBeDefined()
  })

  it('testSearchConfig is a READ (§A.2.2 downgrade) — reachable at instance view', async () => {
    await expect(
      caller(capabilitiesFor('read')).testSearchConfig({
        datasetId: DATASET_ID,
        testQuery: 'hello',
        searchConfig: {},
      })
    ).resolves.toMatchObject({ success: true })
    expect(searchService.search).toHaveBeenCalledTimes(1)
  })

  it('testSearchConfig is still refused with the instance restricted to none', async () => {
    await expect(
      caller(capabilitiesFor('read', { [DATASET_ID]: 'none' })).testSearchConfig({
        datasetId: DATASET_ID,
        testQuery: 'hello',
        searchConfig: {},
      })
    ).rejects.toMatchObject(FORBIDDEN)
    expect(searchService.search).not.toHaveBeenCalled()
  })

  it('getById is refused with the instance restricted to none', async () => {
    await expect(
      caller(capabilitiesFor('read', { [DATASET_ID]: 'none' })).getById({ id: DATASET_ID })
    ).rejects.toMatchObject(FORBIDDEN)
    expect(datasetService.getById).not.toHaveBeenCalled()
  })
})

describe('dataset router — list excludes instances the member may not view', () => {
  const RESTRICTED = 'dset_restrictedcuid0000000000'
  const DSET_C = 'dset_ccuid000000000000000000'
  const DSET_D = 'dset_dcuid000000000000000000'
  const DSET_E = 'dset_ecuid000000000000000000'
  const DSET_F = 'dset_fcuid000000000000000000'
  const DSET_G = 'dset_gcuid000000000000000000'

  /** A member at datasets Read who may view everything except `ids`. */
  const restrictedFrom = (...ids: string[]) =>
    capabilitiesFor('read', {
      [DATASET_ID]: 'read',
      ...Object.fromEntries(ids.map((id) => [id, 'none'])),
    })

  it('drops a restricted dataset instead of 403ing the whole list', async () => {
    listFixture.ids = [DATASET_ID, RESTRICTED]
    const result = await caller(restrictedFrom(RESTRICTED)).list({})
    expect(result.datasets).toEqual([{ id: DATASET_ID }])
  })

  it('the exclusion goes INTO the query, not over its result', async () => {
    listFixture.ids = [DATASET_ID, RESTRICTED]
    await caller(restrictedFrom(RESTRICTED)).list({})
    expect(datasetService.list).toHaveBeenCalledTimes(1)
    const filters = datasetService.list.mock.calls[0]?.[1] as { excludeIds?: readonly string[] }
    expect(filters.excludeIds).toContain(RESTRICTED)
  })

  it('totalCount and hasMore describe the FILTERED set', async () => {
    // The contract this file used to pin the OTHER way round. Post-pagination
    // filtering reported the unfiltered `totalCount` (6) and left `hasMore`
    // speaking for rows the caller can never receive.
    listFixture.ids = [DATASET_ID, RESTRICTED, DSET_C, DSET_D, DSET_E, DSET_F]
    const result = await caller(restrictedFrom(RESTRICTED, DSET_E)).list({ page: 1, limit: 2 })
    expect(result.totalCount).toBe(4)
    expect(result.hasMore).toBe(true)
  })

  it('a full page stays full — excluded datasets do not eat page slots', async () => {
    listFixture.ids = [DATASET_ID, RESTRICTED, DSET_C, DSET_D]
    const result = await caller(restrictedFrom(RESTRICTED)).list({ page: 1, limit: 2 })
    expect(result.datasets).toEqual([{ id: DATASET_ID }, { id: DSET_C }])
  })

  it('never returns an empty page alongside hasMore: true', async () => {
    // The pathology: with post-pagination filtering, page 2 sliced the two
    // adjacent restricted rows, dropped both, and still said `hasMore: true`
    // against the unfiltered total — an empty page telling the client to keep
    // paging. The two restricted ids sit in the same page slot on purpose. Walk
    // every page and assert no page is both empty and "there's more".
    listFixture.ids = [DATASET_ID, DSET_C, DSET_D, DSET_E, DSET_F, DSET_G]
    const caps = restrictedFrom(DSET_D, DSET_E)
    const seen: string[] = []
    for (let page = 1; page <= 3; page++) {
      const result = await caller(caps).list({ page, limit: 2 })
      expect(result.hasMore && result.datasets.length === 0).toBe(false)
      seen.push(...result.datasets.map((d: { id: string }) => d.id))
    }
    expect(seen).toEqual([DATASET_ID, DSET_C, DSET_F, DSET_G])
  })

  it('returns an empty result for a member with datasets: None, without querying', async () => {
    listFixture.ids = [DATASET_ID, RESTRICTED]
    const result = await caller(capabilitiesFor('none', {})).list({})
    expect(result).toEqual({ datasets: [], totalCount: 0, hasMore: false })
    // The area gate being shut denies every dataset, INCLUDING row-less ones —
    // the one denial an id exclusion cannot express. So the router must
    // short-circuit rather than hand the query an (incomplete) exclusion list.
    expect(datasetService.list).not.toHaveBeenCalled()
  })

  it('an unrestricted org pays nothing — the exclusion is empty', async () => {
    listFixture.ids = [DATASET_ID, DSET_C]
    const result = await caller(capabilitiesFor('admin', {})).list({})
    expect(result).toEqual({
      datasets: [{ id: DATASET_ID }, { id: DSET_C }],
      totalCount: 2,
      hasMore: false,
    })
    const filters = datasetService.list.mock.calls[0]?.[1] as { excludeIds?: readonly string[] }
    expect(filters.excludeIds).toEqual([])
  })
})
