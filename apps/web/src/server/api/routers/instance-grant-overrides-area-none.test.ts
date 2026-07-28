// apps/web/src/server/api/routers/instance-grant-overrides-area-none.test.ts

import { ResourcePermission } from '@auxx/database/enums'
import { Area, expandLevelsToKeys, Level } from '@auxx/lib/permissions/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Plan 25 §2 at the router layer — **an explicit instance grant overrides the
 * area-`None` short-circuit**.
 *
 * The live bug this pins (hit by the user 2026-07-27, immediately after #1345):
 * a member whose profile composes `workflows: None` was granted instance `read`
 * on ONE workflow, and the grant was inert. `effectiveInstanceLevel` returned
 * `undefined` at the area gate BEFORE it ever consulted the row, so the only
 * workaround was raising the profile to `workflows: Read` — which, because
 * `workflow` is `baselineAtCreate: false`, grants read on EVERY workflow. There
 * was no way to say "no workflows except this one".
 *
 * Four properties, asserted for all three router families (`workflow`,
 * `dataset`, `dashboard`) so the rule is uniform across `baselineAtCreate`:
 *  1. area `None` + an explicit `view` grant ⇒ the read procedure SUCCEEDS and
 *     the instance APPEARS in `list`;
 *  2. area `None` + NO row ⇒ still denied, and `list` is empty (fail-closed —
 *     the load-bearing regression risk);
 *  3. area `None` + an explicit `'none'` restriction ⇒ denied, absent from list;
 *  4. OWNER unaffected.
 *
 * Plus the hole the type-blind front-door waiver could have opened: a
 * `workflows: None` member holding a grant reaches `permissionProcedure`'s Read
 * rung, but must NOT reach the Manage rung that fronts `create` — which has no
 * instance to assert on.
 *
 * `list` is the half that silently contradicts the gate when it is missed: a
 * member can open a workflow whose row grants them `view` while `list` hands
 * them an empty page. The list mocks therefore honour the ids the router passes
 * rather than ignoring them.
 *
 * Behavioral: the REAL routers are driven through a tRPC caller with a REAL
 * `CapabilitySet`; the services are the observed side effect.
 */

/** The one instance each family shares with our member, plus an unshared sibling. */
const SHARED = 'inst_shared00000000000000'
const OTHER = 'inst_other000000000000000'

const { workflowService, datasetService, dashboards, searchService, featureService } = vi.hoisted(
  () => {
    const shared = 'inst_shared00000000000000'
    const other = 'inst_other000000000000000'
    const orgIds = [shared, other]
    /** Apply the router's id filter exactly as the real query layers do. */
    const narrow = (filters: {
      excludeIds?: readonly string[]
      includeIds?: readonly string[]
    }) => {
      const excluded = new Set(filters.excludeIds ?? [])
      const included = filters.includeIds?.length ? new Set(filters.includeIds) : null
      return orgIds.filter((id) => !excluded.has(id) && (included === null || included.has(id)))
    }
    return {
      workflowService: {
        getAll: vi.fn(
          async (
            _organizationId: string,
            filters: {
              limit: number
              offset: number
              excludeIds?: readonly string[]
              includeIds?: readonly string[]
            }
          ) => {
            const visible = narrow(filters)
            return {
              workflows: visible.map((id) => ({ id })),
              total: visible.length,
              hasMore: false,
            }
          }
        ),
        getById: vi.fn(async (id: string) => ({ id })),
        create: vi.fn(async () => ({ id: 'wf_new' })),
      },
      datasetService: {
        list: vi.fn(
          async (
            _organizationId: string,
            filters: { excludeIds?: readonly string[]; includeIds?: readonly string[] }
          ) => {
            const visible = narrow(filters)
            return {
              datasets: visible.map((id) => ({ id })),
              totalCount: visible.length,
              hasMore: false,
            }
          }
        ),
        getById: vi.fn(async (id: string) => ({ id })),
      },
      dashboards: {
        listDashboards: vi.fn(async () => ({
          isErr: () => false,
          value: orgIds.map((id) => ({ id, name: id })),
        })),
        getDashboard: vi.fn(async (_db: unknown, _org: string, by: { id?: string }) => ({
          isErr: () => false,
          value: { id: by.id ?? shared },
        })),
      },
      searchService: { search: vi.fn(async () => ({ results: [], total: 0 })) },
      featureService: { requireAccess: vi.fn(async () => undefined) },
    }
  }
)

vi.mock('@auxx/lib/workflows', () => ({
  WorkflowService: class {
    getAll = workflowService.getAll
    getById = workflowService.getById
    create = workflowService.create
  },
  WorkflowVersionService: class {},
  WorkflowStatsService: class {},
  WorkflowExecutionService: class {},
  assertWorkflowAppNotSystemOwned: vi.fn(async () => undefined),
  assertWorkflowRunNotSystemOwned: vi.fn(async () => 'inst_shared00000000000000'),
  getWorkflowRunCreatorId: vi.fn(async () => null),
  buildTemplateWorkflowData: vi.fn(async () => ({})),
  toWorkflowAppResponse: (app: unknown) => app,
  WORKFLOW_TRIGGER_TYPE_VALUES: ['manual', 'form', 'scheduled'] as const,
  checkEntityReadiness: vi.fn(async () => ({ ready: true })),
  listFileTemplates: vi.fn(() => []),
}))

vi.mock('@auxx/lib/datasets', () => ({
  DatasetService: class {
    list = datasetService.list
    getById = datasetService.getById
  },
  SearchService: searchService,
}))

vi.mock('@auxx/lib/dashboards', async () => {
  const { z } = await import('zod')
  const passthrough = z.object({}).passthrough()
  return {
    listDashboards: dashboards.listDashboards,
    getDashboard: dashboards.getDashboard,
    loadDashboardRow: vi.fn(async () => ({ isErr: () => false, value: { id: SHARED } })),
    archiveDashboard: vi.fn(),
    createDashboard: vi.fn(),
    deleteVersion: vi.fn(),
    discardDashboardDraft: vi.fn(),
    duplicateDashboard: vi.fn(),
    getVersion: vi.fn(),
    listVersions: vi.fn(),
    publishDashboard: vi.fn(),
    renameVersion: vi.fn(),
    restoreVersion: vi.fn(),
    saveDraft: vi.fn(),
    updateDashboard: vi.fn(),
    chartQueryInputSchema: passthrough,
    draftLayoutDocSchema: passthrough,
    globalFiltersSchema: passthrough,
  }
})

// `dashboard.ts` pulls the aggregate engine, which transitively reaches the
// dataset/vector stack — irrelevant here and unresolvable under vitest.
vi.mock('@auxx/lib/resources/aggregate', () => ({
  buildAggregateQueryForWidget: vi.fn(() => ({})),
  resolveDateRangePreset: vi.fn(() => undefined),
  runAggregate: vi.fn(async () => ({ rows: [] })),
  runKpi: vi.fn(async () => ({ value: 0 })),
  trendSpecForWidget: vi.fn(() => undefined),
}))

vi.mock('@auxx/lib/workflow-engine', () => ({
  triggerManualResourceWorkflow: vi.fn(),
  triggerManualResourceWorkflowBulk: vi.fn(),
}))

vi.mock('@auxx/services/workflows', () => ({
  getWorkflowAppsByTrigger: vi.fn(async () => ({ isErr: () => false, value: [] })),
}))

vi.mock('@auxx/services/workflow-templates', () => ({
  getAllTemplates: vi.fn(async () => ({ isErr: () => false, value: [] })),
  getTemplateById: vi.fn(async () => ({ isErr: () => false, value: null })),
}))

vi.mock('~/server/api/workflow-template-resolver', () => ({
  resolveTemplateById: vi.fn(async () => null),
}))

vi.mock('~/server/api/audit-context', () => ({
  recordAuditFromCtx: vi.fn(async () => undefined),
}))

vi.mock('@auxx/lib/demo', () => ({
  DemoGuard: { requireNotDemo: vi.fn(async () => undefined) },
}))

vi.mock('@auxx/lib/cache', () => ({
  getCachedWorkflowAppCount: vi.fn(async () => 0),
  getAppCache: () => ({ getOrRecompute: vi.fn(async () => ({})) }),
  getUserCache: () => ({ get: vi.fn(async () => ({ preferredTimezone: 'UTC' })) }),
  onCacheEvent: vi.fn(async () => undefined),
}))

// The `@auxx/lib/permissions` barrel reaches redis/db at import time and hangs
// under vitest — hand the routers the real registry plus a stub feature service.
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

/**
 * Mirrors the REAL `permissionProcedure` gate from `trpc.ts`, including the plan
 * 25 §2 waiver — without it, `workflow.getById` would 403 at the front door for
 * exactly the member this file is about, and every case below would pass for the
 * wrong reason. Only the plan-AND and the `getCapabilities` read are dropped
 * (ctx already carries the set).
 */
vi.mock('~/server/api/trpc', async () => {
  const { initTRPC } = await import('@trpc/server')
  const t = initTRPC.context<Record<string, unknown>>().create()
  const { INSTANCE_ACCESS_VIEW_KEYS } = await import(
    '@auxx/lib/permissions/capabilities/instance-access'
  )
  return {
    createTRPCRouter: t.router,
    capabilityProcedure: t.procedure,
    protectedProcedure: t.procedure,
    permissionProcedure: (key: string) =>
      t.procedure.use(({ ctx, next }) => {
        const capabilities = (
          ctx as {
            capabilities: { assert: (k: string) => void; hasAnyInstanceGrant: () => boolean }
          }
        ).capabilities
        const waived =
          INSTANCE_ACCESS_VIEW_KEYS.has(key as never) && capabilities.hasAnyInstanceGrant()
        if (!waived) capabilities.assert(key)
        return next()
      }),
    notDemo:
      () =>
      ({ next }: { next: () => unknown }) =>
        next(),
  }
})

// Deep paths on purpose — the barrel hangs under vitest.
const { CapabilitySet } = await import('@auxx/lib/permissions/capabilities/capability-set')
const { workflowRouter } = await import('./workflow')
const { datasetRouter } = await import('./dataset')
const { dashboardRouter } = await import('./dashboard')

const ORG_ID = 'org_cuid000000000000000000000'
const USER_ID = 'usr_cuid000000000000000000000'

/** AuxxError, wrapped by tRPC as `cause` (the app's middleware maps it to 403). */
const FORBIDDEN = { cause: { name: 'ForbiddenError', statusCode: 403 } }

/**
 * A real `CapabilitySet` for a member whose profile composes `area` to a level,
 * carrying whatever explicit instance rows are given. `rows: {}` models the
 * "granted nothing" member; `role: 'OWNER'` the recovery bypass.
 */
function caps(opts: {
  area: Area
  areaLevel?: Level
  rows?: Record<string, ResourcePermission>
  role?: 'MEMBER' | 'OWNER'
}) {
  const rows = opts.rows ?? {}
  return new CapabilitySet(
    new Set(expandLevelsToKeys({ [opts.area]: opts.areaLevel ?? Level.None })),
    {},
    opts.role ?? 'MEMBER',
    'full',
    undefined,
    undefined,
    undefined,
    rows,
    new Set(Object.keys(rows))
  )
}

const SESSION = {
  organizationId: ORG_ID,
  userId: USER_ID,
  isSuperAdmin: false,
  user: { id: USER_ID, defaultOrganizationId: ORG_ID, email: 'a@b.c', name: 'A' },
}

type Caps = InstanceType<typeof CapabilitySet>

const wf = (capabilities: Caps) =>
  workflowRouter.createCaller({ db: {}, capabilities, session: SESSION } as never)
const ds = (capabilities: Caps) =>
  datasetRouter.createCaller({ db: {}, capabilities, session: SESSION } as never)
const dash = (capabilities: Caps) =>
  dashboardRouter.createCaller({ db: {}, capabilities, session: SESSION } as never)

/**
 * One row per instance-access family: the area it composes against, how to read
 * ONE instance, and how to list them. `dashboard` is `baselineAtCreate: true`
 * and the other two are `false`, so running the same cases over all three proves
 * the rule does not depend on that flag.
 */
const FAMILIES = [
  {
    name: 'workflow',
    area: Area.workflows,
    read: (c: Caps, id: string) => wf(c).getById({ id }),
    list: async (c: Caps) => (await wf(c).list({ limit: 50, offset: 0 })).workflows,
  },
  {
    name: 'dataset',
    area: Area.datasets,
    read: (c: Caps, id: string) => ds(c).getById({ id }),
    list: async (c: Caps) => (await ds(c).list({ page: 1, limit: 50 })).datasets,
  },
  {
    name: 'dashboard',
    area: Area.dashboards,
    read: (c: Caps, id: string) => dash(c).get({ id }),
    list: (c: Caps) => dash(c).list(),
  },
] as const

const ids = (rows: Array<{ id: string }>) => rows.map((r) => r.id)

beforeEach(() => {
  workflowService.getAll.mockClear()
  workflowService.getById.mockClear()
  workflowService.create.mockClear()
  datasetService.list.mockClear()
  datasetService.getById.mockClear()
  dashboards.listDashboards.mockClear()
  dashboards.getDashboard.mockClear()
})

describe.each(FAMILIES)('$name — an explicit grant overrides the area-None floor (plan 25 §2)', ({
  area,
  read,
  list,
}) => {
  it('THE REPRO: area None + an explicit `view` grant can read the instance', async () => {
    const c = caps({ area, rows: { [SHARED]: ResourcePermission.view } })
    await expect(read(c, SHARED)).resolves.toBeDefined()
  })

  it('THE REPRO, list half: the granted instance APPEARS, alone', async () => {
    // The half that silently contradicts the gate when missed — an empty page
    // for an instance the member can demonstrably open.
    const c = caps({ area, rows: { [SHARED]: ResourcePermission.view } })
    expect(ids(await list(c))).toEqual([SHARED])
  })

  it('area None + NO row is still denied (fail-closed)', async () => {
    const c = caps({ area, rows: {} })
    await expect(read(c, SHARED)).rejects.toMatchObject(FORBIDDEN)
    expect(await list(c)).toEqual([])
  })

  it('area None + a grant does NOT open the instances with no row of their own', async () => {
    // The other fail-closed half: the flip must not turn a closed area into an
    // open one for everything else in the org.
    const c = caps({ area, rows: { [SHARED]: ResourcePermission.view } })
    await expect(read(c, OTHER)).rejects.toMatchObject(FORBIDDEN)
    expect(ids(await list(c))).not.toContain(OTHER)
  })

  it('area None + an explicit `none` restriction is denied', async () => {
    const c = caps({ area, rows: { [SHARED]: ResourcePermission.none } })
    await expect(read(c, SHARED)).rejects.toMatchObject(FORBIDDEN)
    expect(await list(c)).toEqual([])
  })

  it('OWNER is unaffected — reads and lists everything despite a `none` row', async () => {
    // `areaLevel: Full` because `composeUserCapabilities` short-circuits OWNER
    // to every key (§0.10) — a key-less OWNER is not a state the composition
    // can produce, and `permissionProcedure`'s coarse assert is key-based with
    // no role bypass.
    const c = caps({
      area,
      areaLevel: Level.Full,
      rows: { [SHARED]: ResourcePermission.none },
      role: 'OWNER',
    })
    await expect(read(c, SHARED)).resolves.toBeDefined()
    expect(ids(await list(c))).toEqual([SHARED, OTHER])
  })
})

describe('the front-door waiver is scoped to the Read rung (no create hole)', () => {
  const granted = () => caps({ area: Area.workflows, rows: { [SHARED]: ResourcePermission.admin } })

  it('a `workflows: None` member holding an admin grant reaches the Read-rung procedure', async () => {
    // `permissionProcedure(workflowsView)` waives its coarse assert, and
    // `assertViewInstance` then lets them through on their own row.
    await expect(wf(granted()).getById({ id: SHARED })).resolves.toBeDefined()
  })

  it('…but is still refused `create`, which sits on the Manage rung', async () => {
    // `create` has NO instance to assert on, so the coarse rung is the only
    // gate. Widening the waiver past the Read rung would hand every grant
    // holder the ability to create workflows in an area they compose to None.
    await expect(wf(granted()).create({ name: 'x', enabled: false })).rejects.toMatchObject(
      FORBIDDEN
    )
    expect(workflowService.create).not.toHaveBeenCalled()
  })

  it('a member with NO grant at all is still refused the Read-rung procedure', async () => {
    await expect(
      wf(caps({ area: Area.workflows, rows: {} })).getById({ id: SHARED })
    ).rejects.toMatchObject(FORBIDDEN)
  })

  it('a member holding ONLY an explicit `none` row is refused too', async () => {
    // These two are the safety argument for the waiver's looseness, not a test
    // OF it: the waiver grants nothing, so widening it (e.g.
    // `hasAnyInstanceGrant` returning true unconditionally) changes NO router
    // outcome — `assertViewInstance` denies the same callers either way. The
    // waiver's own inputs are pinned as unit assertions in
    // `packages/lib/.../capability-set-instance.test.ts`, which is the only
    // place a widening can be caught.
    await expect(
      wf(caps({ area: Area.workflows, rows: { [OTHER]: ResourcePermission.none } })).getById({
        id: SHARED,
      })
    ).rejects.toMatchObject(FORBIDDEN)
  })
})

describe('the list filter and the gate agree (the two cannot drift)', () => {
  it('workflow.list hands the query an ALLOW-LIST when the area is closed', async () => {
    await wf(caps({ area: Area.workflows, rows: { [SHARED]: ResourcePermission.view } })).list({
      limit: 50,
      offset: 0,
    })
    const filters = workflowService.getAll.mock.calls[0]?.[1] as {
      includeIds?: string[]
      excludeIds?: string[]
    }
    expect(filters.includeIds).toEqual([SHARED])
    expect(filters.excludeIds).toBeUndefined()
  })

  it('workflow.list does not query at all when nothing is visible', async () => {
    const result = await wf(caps({ area: Area.workflows, rows: {} })).list({
      limit: 50,
      offset: 0,
    })
    expect(result).toEqual({ workflows: [], total: 0, hasMore: false })
    expect(workflowService.getAll).not.toHaveBeenCalled()
  })

  it('dataset.list hands the query an ALLOW-LIST when the area is closed', async () => {
    await ds(caps({ area: Area.datasets, rows: { [SHARED]: ResourcePermission.edit } })).list({
      page: 1,
      limit: 50,
    })
    const filters = datasetService.list.mock.calls[0]?.[1] as {
      includeIds?: string[]
      excludeIds?: string[]
    }
    expect(filters.includeIds).toEqual([SHARED])
    expect(filters.excludeIds).toBeUndefined()
  })

  it('an OPEN area still uses the exclusion form, not the allow-list', async () => {
    // The regime that must not change: a member with the area open sees
    // everything except their explicitly-restricted instances.
    await wf(
      caps({
        area: Area.workflows,
        areaLevel: Level.Full,
        rows: { [SHARED]: ResourcePermission.none },
      })
    ).list({ limit: 50, offset: 0 })
    const filters = workflowService.getAll.mock.calls[0]?.[1] as {
      includeIds?: string[]
      excludeIds?: string[]
    }
    expect(filters.excludeIds).toEqual([SHARED])
    expect(filters.includeIds).toBeUndefined()
  })
})
