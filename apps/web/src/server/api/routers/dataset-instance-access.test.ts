// apps/web/src/server/api/routers/dataset-instance-access.test.ts

import { ResourcePermission } from '@auxx/database/enums'
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

const { datasetService, searchService, featureService, onCacheEvent } = vi.hoisted(() => ({
  datasetService: {
    create: vi.fn(async () => ({ id: 'dset_new' })),
    getById: vi.fn(async () => ({ id: 'dset_1' })),
    getStats: vi.fn(async () => ({ documentCount: 0 })),
    list: vi.fn(async () => ({ datasets: [], totalCount: 0, hasMore: false })),
    update: vi.fn(async () => ({ id: 'dset_1' })),
    updateMetrics: vi.fn(async () => undefined),
    delete: vi.fn(async () => undefined),
  },
  searchService: {
    search: vi.fn(async () => ({ results: [], total: 0, responseTime: 1, searchType: 'hybrid' })),
  },
  featureService: { requireAccess: vi.fn(async () => undefined) },
  onCacheEvent: vi.fn(async () => undefined),
}))

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
    [ResourcePermission.none]: Level.None,
    [ResourcePermission.view]: Level.Read,
    [ResourcePermission.edit]: Level.Edit,
    [ResourcePermission.admin]: Level.Full,
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
    await expect(call(caller(capabilitiesFor(ResourcePermission.edit)))).rejects.toMatchObject(
      FORBIDDEN
    )
    expect(datasetService[serviceFn]).not.toHaveBeenCalled()
  })

  it.each(ADMIN_ONLY)('%s is refused at instance view', async (_name, call, serviceFn) => {
    await expect(call(caller(capabilitiesFor(ResourcePermission.view)))).rejects.toMatchObject(
      FORBIDDEN
    )
    expect(datasetService[serviceFn]).not.toHaveBeenCalled()
  })

  it.each(ADMIN_ONLY)('%s succeeds at instance admin', async (_name, call, serviceFn) => {
    await expect(call(caller(capabilitiesFor(ResourcePermission.admin)))).resolves.toBeDefined()
    expect(datasetService[serviceFn]).toHaveBeenCalledTimes(1)
  })

  it('creating a dataset needs the coarse datasets Full rung, not instance edit', async () => {
    await expect(
      caller(capabilitiesFor(ResourcePermission.edit)).create({
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
      caller(capabilitiesFor(ResourcePermission.edit)).updateMetrics({ id: DATASET_ID })
    ).resolves.toEqual({ success: true })
    expect(datasetService.updateMetrics).toHaveBeenCalledTimes(1)
  })

  it('updateMetrics is refused at instance view', async () => {
    await expect(
      caller(capabilitiesFor(ResourcePermission.view)).updateMetrics({ id: DATASET_ID })
    ).rejects.toMatchObject(FORBIDDEN)
    expect(datasetService.updateMetrics).not.toHaveBeenCalled()
  })
})

describe('dataset router — reads stay open at instance view', () => {
  it('getById and getStats succeed at view', async () => {
    const c = caller(capabilitiesFor(ResourcePermission.view))
    await expect(c.getById({ id: DATASET_ID })).resolves.toBeDefined()
    await expect(c.getStats({ id: DATASET_ID })).resolves.toBeDefined()
  })

  it('testSearchConfig is a READ (§A.2.2 downgrade) — reachable at instance view', async () => {
    await expect(
      caller(capabilitiesFor(ResourcePermission.view)).testSearchConfig({
        datasetId: DATASET_ID,
        testQuery: 'hello',
        searchConfig: {},
      })
    ).resolves.toMatchObject({ success: true })
    expect(searchService.search).toHaveBeenCalledTimes(1)
  })

  it('testSearchConfig is still refused with the instance restricted to none', async () => {
    await expect(
      caller(
        capabilitiesFor(ResourcePermission.view, { [DATASET_ID]: ResourcePermission.none })
      ).testSearchConfig({ datasetId: DATASET_ID, testQuery: 'hello', searchConfig: {} })
    ).rejects.toMatchObject(FORBIDDEN)
    expect(searchService.search).not.toHaveBeenCalled()
  })

  it('getById is refused with the instance restricted to none', async () => {
    await expect(
      caller(
        capabilitiesFor(ResourcePermission.view, { [DATASET_ID]: ResourcePermission.none })
      ).getById({ id: DATASET_ID })
    ).rejects.toMatchObject(FORBIDDEN)
    expect(datasetService.getById).not.toHaveBeenCalled()
  })
})

describe('dataset router — list drops instances the member may not view', () => {
  it('filters restricted datasets out of the page instead of 403ing the whole list', async () => {
    const RESTRICTED = 'dset_restrictedcuid0000000000'
    datasetService.list.mockResolvedValueOnce({
      datasets: [{ id: DATASET_ID }, { id: RESTRICTED }],
      totalCount: 2,
      hasMore: false,
    } as any)

    const result = await caller(
      capabilitiesFor(ResourcePermission.view, {
        [DATASET_ID]: ResourcePermission.view,
        [RESTRICTED]: ResourcePermission.none,
      })
    ).list({})

    expect(result.datasets).toEqual([{ id: DATASET_ID }])
    // The unfiltered count is deliberately preserved by the router — assert what
    // it actually returns so a future change to that contract is visible.
    expect(result.totalCount).toBe(2)
  })
})
