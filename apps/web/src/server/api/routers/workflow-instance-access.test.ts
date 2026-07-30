// apps/web/src/server/api/routers/workflow-instance-access.test.ts

import type { ResourcePermission } from '@auxx/database/enums'
import { Area, expandLevelsToKeys, Level, PermissionKey } from '@auxx/lib/permissions/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Plan 30 §7 at the router layer — per-workflow instance access.
 *
 * Three things this file exists to pin, in order of how easy they are to break:
 *  1. **`view` may RUN.** `triggerManualResource(Bulk)` succeeds for a member
 *     holding only instance `view` (user decision 2026-07-27). Every other
 *     resource in the instance-access family treats "run/write" as Edit; this one
 *     deliberately does not.
 *  2. **`update`'s field-presence escalation.** One fat mutation serves the
 *     canvas auto-save (Edit) and the settings/access panels (Full), so the tier
 *     is decided by which KEYS the payload carries
 *     (`ADMIN_ONLY_UPDATE_FIELDS`), not by the procedure.
 *  3. **`list` / `getManualWorkflows` FILTER, never assert** — they render
 *     passively inside other screens, where a 403 is a broken page.
 *
 * Behavioral, not source-text: the real router module is imported and driven
 * through a tRPC caller, and `ctx.capabilities` is a **real** {@link CapabilitySet}
 * (the shipped assert methods). The `permissionProcedure` stand-in runs the real
 * `capabilities.assert(key)`, so the coarse rung on the builder is under test
 * too — `create`'s `workflowsManage` gate lives there, not in the body.
 *
 * Deleting or weakening any assert makes a case here fail, because the mocked
 * `WorkflowService` / trigger functions are the observed side effect.
 */

const {
  workflowService,
  versionService,
  statsService,
  executionService,
  guards,
  listFixture,
  triggerManual,
  triggerManualBulk,
  getWorkflowAppsByTrigger,
  featureService,
  recordAuditFromCtx,
} = vi.hoisted(() => {
  /**
   * The org's workflows, as the query sees them. Mutated per test.
   */
  const listFixture: { ids: string[] } = { ids: ['wf_cuid0000000000000000000'] }
  return {
    listFixture,
    workflowService: {
      /**
       * Stands in for `WorkflowService.getAll` → the cached-list accessor,
       * reproducing the ONE property `list`'s contract rests on: the access
       * filter is applied with the other predicates and **before** the slice,
       * so `total`/`hasMore` describe the filtered set. A mock that ignored
       * `excludeIds`/`includeIds` would let a router that stopped passing them
       * still pass. Empty arrays mean "not set" on both, exactly as the real
       * accessor treats them.
       */
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
          const excluded = new Set(filters.excludeIds ?? [])
          const included = filters.includeIds?.length ? new Set(filters.includeIds) : null
          const visible = listFixture.ids.filter(
            (id) => !excluded.has(id) && (included === null || included.has(id))
          )
          const page = visible.slice(filters.offset, filters.offset + filters.limit)
          return {
            workflows: page.map((id) => ({ id })),
            total: visible.length,
            hasMore: filters.offset + page.length < visible.length,
          }
        }
      ),
      getById: vi.fn(async () => ({ id: 'wf_cuid0000000000000000000' })),
      create: vi.fn(async () => ({ id: 'wf_new' })),
      createForResource: vi.fn(async () => ({ id: 'wf_new' })),
      update: vi.fn(async () => ({ id: 'wf_cuid0000000000000000000' })),
      delete: vi.fn(async () => ({ success: true })),
      duplicate: vi.fn(async () => ({ id: 'wf_copy' })),
      test: vi.fn(async () => ({ success: true })),
    },
    versionService: {
      publish: vi.fn(async () => ({ id: 'ver_1' })),
      getVersions: vi.fn(async () => []),
      getVersionById: vi.fn(async () => ({ id: 'ver_1' })),
      deleteVersion: vi.fn(async () => ({ success: true })),
      renameVersion: vi.fn(async () => ({ id: 'ver_1' })),
    },
    statsService: {
      getStats: vi.fn(async () => ({ total: 0 })),
      getDetailedStats: vi.fn(async () => ({ series: [] })),
    },
    executionService: {
      stopWorkflowRun: vi.fn(async () => ({ success: true })),
      runSingleNode: vi.fn(async () => ({ output: {} })),
      getWorkflowRun: vi.fn(async () => ({ id: 'run_1' })),
      listWorkflowRuns: vi.fn(async () => ({ runs: [], nextCursor: null })),
    },
    guards: {
      app: vi.fn(async () => undefined),
      run: vi.fn(async () => 'wf_cuid0000000000000000000'),
      /**
       * `getWorkflowRunCreatorId` — who STARTED the run. Defaults to somebody
       * else, so every pre-existing "stopWorkflowRun is refused at instance view"
       * case keeps meaning "someone else's run".
       */
      runCreator: vi.fn(async () => 'usr_someoneelse0000000000000' as string | null),
    },
    triggerManual: vi.fn(async () => ({ isErr: () => false, value: { runId: 'run_1' } })),
    triggerManualBulk: vi.fn(async () => ({ isErr: () => false, value: { triggered: 1 } })),
    getWorkflowAppsByTrigger: vi.fn(async () => ({
      isErr: () => false,
      value: [] as { workflowApp: { id: string; name: string; description: string | null } }[],
    })),
    featureService: { requireAccess: vi.fn(async () => undefined) },
    recordAuditFromCtx: vi.fn(async () => undefined),
  }
})

vi.mock('@auxx/lib/workflows', () => ({
  WorkflowService: class {
    getAll = workflowService.getAll
    getById = workflowService.getById
    create = workflowService.create
    createForResource = workflowService.createForResource
    update = workflowService.update
    delete = workflowService.delete
    duplicate = workflowService.duplicate
    test = workflowService.test
  },
  WorkflowVersionService: class {
    publish = versionService.publish
    getVersions = versionService.getVersions
    getVersionById = versionService.getVersionById
    deleteVersion = versionService.deleteVersion
    renameVersion = versionService.renameVersion
  },
  WorkflowStatsService: class {
    getStats = statsService.getStats
    getDetailedStats = statsService.getDetailedStats
  },
  WorkflowExecutionService: class {
    stopWorkflowRun = executionService.stopWorkflowRun
    runSingleNode = executionService.runSingleNode
    getWorkflowRun = executionService.getWorkflowRun
    listWorkflowRuns = executionService.listWorkflowRuns
  },
  assertWorkflowAppNotSystemOwned: guards.app,
  assertWorkflowRunNotSystemOwned: guards.run,
  getWorkflowRunCreatorId: guards.runCreator,
  buildTemplateWorkflowData: vi.fn(async () => ({})),
  toWorkflowAppResponse: (app: unknown) => app,
  // Only the shape matters — these feed a `z.enum()` on inputs the tests don't set.
  WORKFLOW_TRIGGER_TYPE_VALUES: ['manual', 'form', 'scheduled'] as const,
  // `workflow-templates.ts` (mounted as the `templates` sub-router) pulls these.
  checkEntityReadiness: vi.fn(async () => ({ ready: true })),
  listFileTemplates: vi.fn(() => []),
}))

vi.mock('@auxx/lib/workflow-engine', () => ({
  triggerManualResourceWorkflow: triggerManual,
  triggerManualResourceWorkflowBulk: triggerManualBulk,
}))

vi.mock('@auxx/services/workflows', () => ({ getWorkflowAppsByTrigger }))
vi.mock('@auxx/services/workflow-templates', () => ({
  getAllTemplates: vi.fn(async () => ({ isErr: () => false, value: [] })),
  getTemplateById: vi.fn(async () => ({ isErr: () => false, value: null })),
}))

vi.mock('@auxx/lib/cache', () => ({
  getCachedWorkflowAppCount: vi.fn(async () => 0),
  getAppCache: () => ({ getOrRecompute: vi.fn(async () => ({})) }),
}))

vi.mock('@auxx/lib/demo', () => ({
  DemoGuard: { requireNotDemo: vi.fn(async () => undefined) },
}))

vi.mock('~/server/api/audit-context', () => ({ recordAuditFromCtx }))
vi.mock('~/server/api/workflow-template-resolver', () => ({
  resolveTemplateById: vi.fn(async () => null),
}))

// See the note in `dataset-instance-access.test.ts` — the `@auxx/lib/permissions`
// barrel reaches redis/db at import time and hangs under vitest. Hand back the
// real registry plus a stub feature service (Layer-1 plan gating is not what
// this file is about).
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
 * The `permissionProcedure` stand-in mirrors the REAL builder's gate: a plain
 * `capabilities.assert(key)`. There is no waiver any more (handoff item 5b) —
 * a `workflows: None` member holding one explicit grant now genuinely HOLDS
 * `workflowsView`, because `composeUserCapabilities` derives that Read rung from
 * their instance grants. Kept in lockstep with `trpc.ts`; only the plan-AND and
 * the `getCapabilities` read are dropped, since ctx carries the set already.
 *
 * So the coarse rung on the procedure builder is under test alongside the
 * per-instance asserts in the bodies. (The dataset/KB files couldn't do this —
 * their routers assert coarse keys inline.) Dropping
 * `permissionProcedure(workflowsManage)` from `create` fails a case below.
 */
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
    // The real one blocks demo orgs; irrelevant to capability gating, and it
    // runs downstream of the assert either way.
    notDemo:
      () =>
      ({ next }: { next: () => unknown }) =>
        next(),
  }
})

// Deep path on purpose — see the note in `segment-instance-access.test.ts`.
const { CapabilitySet } = await import('@auxx/lib/permissions/capabilities/capability-set')
const { workflowRouter } = await import('./workflow')

const ORG_ID = 'org_cuid000000000000000000000'
const USER_ID = 'usr_cuid000000000000000000000'
const WF_ID = 'wf_cuid0000000000000000000'
const RUN_ID = 'run_cuid000000000000000000'
const VERSION_ID = 'ver_cuid000000000000000000'
const RECORD_ID = 'contact:rec_cuid00000000000000'

/** AuxxError, wrapped by tRPC as `cause` (the app's middleware maps it to 403). */
const FORBIDDEN = { cause: { name: 'ForbiddenError', statusCode: 403 } }

const AREA_LEVEL_OF: Record<ResourcePermission, Level> = {
  ['none']: Level.None,
  ['read']: Level.Read,
  ['edit']: Level.Edit,
  ['admin']: Level.Full,
}

/**
 * A real `CapabilitySet` for a MEMBER holding `permission` on {@link WF_ID} via
 * an explicit `ResourceAccess` instance row (what the share dialog writes).
 *
 * `areaPermission` defaults to `permission` so the coarse `workflows` rungs stay
 * consistent with the instance row; pass it separately to exercise the two
 * independently (e.g. a member sitting at area `Full` but restricted on one
 * workflow). `instances: {}` models a workflow with NO row at all — the
 * `baselineAtCreate: false` fallback to the area level (plan 30 §3).
 */
function capabilitiesFor(
  permission: ResourcePermission,
  opts: {
    instances?: Record<string, ResourcePermission>
    areaPermission?: ResourcePermission
    role?: 'MEMBER' | 'OWNER'
    seatType?: 'full' | 'worker'
  } = {}
) {
  const instances = opts.instances ?? { [WF_ID]: permission }
  const seatType = opts.seatType ?? 'full'
  // Reproduce `composeUserCapabilities`' derived Read rung: any ≥`view` workflow
  // row synthesizes `workflowsView`, clamped away on a worker seat (workflows is
  // outside WORKER_AREAS). Without this a `workflows: None` grantee would 403 at
  // the coarse front door — the exact regression item 5b closes.
  const derived =
    seatType !== 'worker' && Object.values(instances).some((p) => p !== 'none' && p !== undefined)
      ? [PermissionKey.workflowsView]
      : []
  return new CapabilitySet(
    new Set(
      expandLevelsToKeys({ [Area.workflows]: AREA_LEVEL_OF[opts.areaPermission ?? permission] })
    ),
    {},
    opts.role ?? 'MEMBER',
    seatType,
    undefined,
    undefined,
    undefined,
    instances,
    new Set(Object.keys(instances)),
    undefined,
    new Set(derived)
  )
}

/**
 * Query-builder stand-in for the two share-token procedures, which touch the DB
 * directly (`db.query.WorkflowApp.findFirst` + `db.update(...).returning()`)
 * rather than going through a service.
 */
function fakeDb() {
  const returning = vi.fn(async () => [{ id: WF_ID, shareToken: 'share_x' }])
  const chain = {
    set: () => chain,
    where: () => chain,
    returning,
  } as unknown as { set: () => unknown; where: () => unknown; returning: typeof returning }
  return {
    query: { WorkflowApp: { findFirst: vi.fn(async () => ({ id: WF_ID })) } },
    update: () => chain,
  }
}

function caller(capabilities: InstanceType<typeof CapabilitySet>, db: unknown = fakeDb()) {
  return workflowRouter.createCaller({
    db,
    capabilities,
    session: {
      organizationId: ORG_ID,
      userId: USER_ID,
      isSuperAdmin: false,
      user: { id: USER_ID, defaultOrganizationId: ORG_ID, email: 'a@b.c', name: 'A' },
    },
  } as never)
}

type Caller = ReturnType<typeof caller>

/** View tier — everything a `view` holder may read (plan 30 §7). */
const VIEW_READS = [
  ['getById', (c: Caller) => c.getById({ id: WF_ID }), () => workflowService.getById],
  [
    'getStats',
    (c: Caller) => c.getStats({ workflowId: WF_ID, timeRange: '24h' }),
    () => statsService.getStats,
  ],
  [
    'getDetailedStats',
    (c: Caller) => c.getDetailedStats({ workflowId: WF_ID, timeRange: 'last7days' }),
    () => statsService.getDetailedStats,
  ],
  [
    'getVersions',
    (c: Caller) => c.getVersions({ workflowId: WF_ID }),
    () => versionService.getVersions,
  ],
  [
    'getVersionById',
    (c: Caller) => c.getVersionById({ workflowId: WF_ID, versionId: VERSION_ID }),
    () => versionService.getVersionById,
  ],
  [
    'getWorkflowRun',
    (c: Caller) => c.getWorkflowRun({ runId: RUN_ID }),
    () => executionService.getWorkflowRun,
  ],
  [
    'listWorkflowRuns',
    (c: Caller) => c.listWorkflowRuns({ workflowAppId: WF_ID, limit: 20 }),
    () => executionService.listWorkflowRuns,
  ],
] as const

/** Edit tier — authoring, publishing, run control, version management. */
const EDIT_LEVEL = [
  [
    'test',
    (c: Caller) =>
      c.test({
        workflowId: WF_ID,
        testData: {
          message: {
            subject: 's',
            textPlain: 't',
            from: { identifier: 'a@b.co', name: 'n' },
            isInbound: true,
          },
        },
      }),
    () => workflowService.test,
  ],
  ['publish', (c: Caller) => c.publish({ workflowId: WF_ID }), () => versionService.publish],
  [
    'deleteVersion',
    (c: Caller) => c.deleteVersion({ workflowId: WF_ID, versionId: VERSION_ID }),
    () => versionService.deleteVersion,
  ],
  [
    'renameVersion',
    (c: Caller) => c.renameVersion({ workflowId: WF_ID, versionId: VERSION_ID, title: 'v2' }),
    () => versionService.renameVersion,
  ],
  [
    'runSingleNode',
    (c: Caller) =>
      c.runSingleNode({ workflowAppId: WF_ID, workflowId: WF_ID, nodeId: 'n1', inputs: [] }),
    () => executionService.runSingleNode,
  ],
  [
    'stopWorkflowRun',
    (c: Caller) => c.stopWorkflowRun({ runId: RUN_ID }),
    () => executionService.stopWorkflowRun,
  ],
] as const

/** Admin tier — destroy the workflow, or open/close its ANONYMOUS surface. */
const ADMIN_ONLY = [
  ['delete', (c: Caller) => c.delete({ id: WF_ID }), () => workflowService.delete],
  ['generateShareToken', (c: Caller) => c.generateShareToken({ id: WF_ID }), null],
  ['revokeShareToken', (c: Caller) => c.revokeShareToken({ id: WF_ID }), null],
] as const

/**
 * Every `ADMIN_ONLY_UPDATE_FIELDS` key, with a value that is genuinely present.
 * `enabled: false` is deliberate — a falsy-but-defined value must still escalate,
 * which a `if (input[field])` check would miss.
 */
const ADMIN_UPDATE_PAYLOADS = [
  ['name', { name: 'Renamed' }],
  ['description', { description: 'A description' }],
  ['enabled', { enabled: false }],
  ['icon', { icon: { iconId: 'bolt', color: '#fff' } }],
  ['webEnabled', { webEnabled: true }],
  ['apiEnabled', { apiEnabled: true }],
  ['accessMode', { accessMode: 'public' as const }],
  ['config', { config: { title: 'Form' } }],
  ['rateLimit', { rateLimit: { enabled: true, maxRequests: 10, windowMs: 1000 } }],
] as const

const ALL_MOCKS = [
  ...Object.values(workflowService),
  ...Object.values(versionService),
  ...Object.values(statsService),
  ...Object.values(executionService),
  triggerManual,
  triggerManualBulk,
  getWorkflowAppsByTrigger,
  recordAuditFromCtx,
]

/** Somebody who is NOT the caller — the default `WorkflowRun.createdBy`. */
const OTHER_USER_ID = 'usr_someoneelse0000000000000'

beforeEach(() => {
  for (const fn of ALL_MOCKS) fn.mockClear()
  guards.app.mockClear()
  guards.run.mockClear()
  guards.run.mockResolvedValue(WF_ID)
  // `mockReset`, not `mockClear`: a `mockResolvedValueOnce` that a test QUEUES
  // but never consumes (the `edit` tier short-circuits before reading the
  // owner) would otherwise survive into the next test and shift every
  // subsequent once-value by one.
  guards.runCreator.mockReset()
  guards.runCreator.mockResolvedValue(OTHER_USER_ID)
  listFixture.ids = [WF_ID]
})

describe('workflow router — `view` may RUN it (plan 30 §2, the headline decision)', () => {
  it('triggerManualResource succeeds at instance view', async () => {
    await expect(
      caller(capabilitiesFor('read')).triggerManualResource({
        workflowAppId: WF_ID,
        recordId: RECORD_ID,
      })
    ).resolves.toEqual({ runId: 'run_1' })
    expect(triggerManual).toHaveBeenCalledTimes(1)
  })

  it('triggerManualResourceBulk succeeds at instance view', async () => {
    await expect(
      caller(capabilitiesFor('read')).triggerManualResourceBulk({
        workflowAppId: WF_ID,
        recordIds: [RECORD_ID, 'contact:rec_second00000000000'],
      })
    ).resolves.toEqual({ triggered: 1 })
    expect(triggerManualBulk).toHaveBeenCalledTimes(1)
  })

  it('both are refused for a workflow restricted to `none`', async () => {
    const caps = capabilitiesFor('none', {
      areaPermission: 'admin',
      instances: { [WF_ID]: 'none' },
    })
    await expect(
      caller(caps).triggerManualResource({ workflowAppId: WF_ID, recordId: RECORD_ID })
    ).rejects.toMatchObject(FORBIDDEN)
    await expect(
      caller(caps).triggerManualResourceBulk({ workflowAppId: WF_ID, recordIds: [RECORD_ID] })
    ).rejects.toMatchObject(FORBIDDEN)
    expect(triggerManual).not.toHaveBeenCalled()
    expect(triggerManualBulk).not.toHaveBeenCalled()
  })

  it('triggerManualResourceBulk asserts ONCE, not per record (plan 30 §2.2)', async () => {
    // The workflow is singular; only the records are plural. A per-record loop
    // would be N assert calls and N× the cost for a 100-record bulk.
    const caps = capabilitiesFor('read')
    const spy = vi.spyOn(caps, 'assertViewInstance')
    await caller(caps).triggerManualResourceBulk({
      workflowAppId: WF_ID,
      recordIds: [RECORD_ID, 'contact:rec_two000000000000000', 'contact:rec_three00000000000000'],
    })
    expect(spy).toHaveBeenCalledTimes(1)
    expect(spy).toHaveBeenCalledWith('workflow', WF_ID)
  })

  it('a WORKER seat cannot run a manual workflow (deliberate, plan 30 §8 item 1)', async () => {
    // `workflows` is absent from `WORKER_AREAS`, so `SEAT_CEILINGS.worker`
    // clamps the area to None — and `effectiveInstanceLevel` short-circuits
    // there before any instance row is consulted. Pinned so that adding
    // `Area.workflows` to `WORKER_AREAS` breaks a test rather than silently
    // changing seat semantics.
    const worker = new CapabilitySet(
      new Set(expandLevelsToKeys({ [Area.workflows]: Level.None })),
      {},
      'MEMBER',
      'worker',
      undefined,
      undefined,
      undefined,
      { [WF_ID]: 'admin' },
      new Set([WF_ID])
    )
    await expect(
      caller(worker).triggerManualResource({ workflowAppId: WF_ID, recordId: RECORD_ID })
    ).rejects.toMatchObject(FORBIDDEN)
    expect(triggerManual).not.toHaveBeenCalled()
  })
})

describe('workflow router — the view tier', () => {
  it.each(VIEW_READS)('%s succeeds at instance view', async (_name, call, mock) => {
    await expect(call(caller(capabilitiesFor('read')))).resolves.toBeDefined()
    expect(mock()).toHaveBeenCalledTimes(1)
  })

  it.each(
    VIEW_READS
  )('%s is refused for a workflow restricted to `none`', async (_n, call, mock) => {
    await expect(
      call(
        caller(
          capabilitiesFor('none', {
            areaPermission: 'admin',
            instances: { [WF_ID]: 'none' },
          })
        )
      )
    ).rejects.toMatchObject(FORBIDDEN)
    expect(mock()).not.toHaveBeenCalled()
  })

  it('getWorkflowRun gates on the run’s PARENT app, not the run id', async () => {
    // The guard resolves `WorkflowRun.id` → `WorkflowApp.id`; instance access is
    // keyed on the parent. Point the guard at an app the caller is restricted
    // from and the read must fail even though they administer WF_ID.
    const OTHER = 'wf_othercuid0000000000000'
    guards.run.mockResolvedValueOnce(OTHER)
    await expect(
      caller(
        capabilitiesFor('admin', {
          areaPermission: 'admin',
          instances: { [WF_ID]: 'admin', [OTHER]: 'none' },
        })
      ).getWorkflowRun({ runId: RUN_ID })
    ).rejects.toMatchObject(FORBIDDEN)
    expect(executionService.getWorkflowRun).not.toHaveBeenCalled()
  })

  it('an unknown run 404s before any capability decision leaks its existence', async () => {
    guards.run.mockResolvedValueOnce(undefined)
    await expect(
      caller(capabilitiesFor('admin')).getWorkflowRun({ runId: 'run_missing' })
    ).rejects.toMatchObject({ cause: undefined, code: 'NOT_FOUND' })
    expect(executionService.getWorkflowRun).not.toHaveBeenCalled()
  })
})

describe('workflow router — the edit tier', () => {
  it.each(EDIT_LEVEL)('%s succeeds at instance edit', async (_name, call, mock) => {
    await expect(call(caller(capabilitiesFor('edit')))).resolves.toBeDefined()
    expect(mock()).toHaveBeenCalledTimes(1)
  })

  it.each(EDIT_LEVEL)('%s is refused at instance view', async (_name, call, mock) => {
    await expect(call(caller(capabilitiesFor('read')))).rejects.toMatchObject(FORBIDDEN)
    expect(mock()).not.toHaveBeenCalled()
  })

  it('stopWorkflowRun at instance edit never reads the run’s owner', async () => {
    // Ownership only matters for the `view` tier; `edit` stops ANY run, so the
    // common path must not pay the extra query.
    await caller(capabilitiesFor('edit')).stopWorkflowRun({ runId: RUN_ID })
    expect(guards.runCreator).not.toHaveBeenCalled()
    expect(executionService.stopWorkflowRun).toHaveBeenCalledTimes(1)
  })

  it('stopWorkflowRun keys on the run’s PARENT app', async () => {
    const OTHER = 'wf_othercuid0000000000000'
    guards.run.mockResolvedValueOnce(OTHER)
    await expect(
      caller(
        capabilitiesFor('admin', {
          areaPermission: 'admin',
          instances: { [WF_ID]: 'admin', [OTHER]: 'read' },
        })
      ).stopWorkflowRun({ runId: RUN_ID })
    ).rejects.toMatchObject(FORBIDDEN)
    expect(executionService.stopWorkflowRun).not.toHaveBeenCalled()
  })
})

/**
 * The corollary of "`view` means you may RUN it": a `view` holder who started a
 * run may cancel it. Anything else — someone else's run, an unowned run, a
 * system/headless run — needs `edit`.
 */
describe('workflow router — a `view` holder may stop a run THEY started', () => {
  /** The org system user, which every headless start writes as `createdBy`. */
  const SYSTEM_USER_ID = 'usr_system00000000000000000'

  it('stops the run when the caller started it', async () => {
    guards.runCreator.mockResolvedValueOnce(USER_ID)
    await expect(
      caller(capabilitiesFor('read')).stopWorkflowRun({ runId: RUN_ID })
    ).resolves.toBeDefined()
    expect(executionService.stopWorkflowRun).toHaveBeenCalledTimes(1)
  })

  it('refuses someone else’s run', async () => {
    guards.runCreator.mockResolvedValueOnce(OTHER_USER_ID)
    await expect(
      caller(capabilitiesFor('read')).stopWorkflowRun({ runId: RUN_ID })
    ).rejects.toMatchObject(FORBIDDEN)
    expect(executionService.stopWorkflowRun).not.toHaveBeenCalled()
  })

  it('an instance `edit` holder stops someone else’s run', async () => {
    // Default owner (someone else) — `edit` never reads it, which is the point.
    await expect(
      caller(capabilitiesFor('edit')).stopWorkflowRun({ runId: RUN_ID })
    ).resolves.toBeDefined()
    expect(executionService.stopWorkflowRun).toHaveBeenCalledTimes(1)
  })

  it('refuses a SYSTEM/headless run the caller did not start', async () => {
    // Schedules, record events, rules and webhooks all run as the org's system
    // user — a real `User.id`, never the caller's — so the same id comparison
    // covers them without a `'system'` sentinel. A `view` holder must not be
    // able to cancel the org's automation.
    guards.runCreator.mockResolvedValueOnce(SYSTEM_USER_ID)
    await expect(
      caller(capabilitiesFor('read')).stopWorkflowRun({ runId: RUN_ID })
    ).rejects.toMatchObject(FORBIDDEN)
    expect(executionService.stopWorkflowRun).not.toHaveBeenCalled()
  })

  it('refuses a run with NO owner', async () => {
    // `WorkflowRun.createdBy` is `ON DELETE SET NULL`, so a run outlives its
    // creator's `User` row. An unowned run belongs to nobody and therefore needs
    // `edit` — `null` must never read as "mine".
    guards.runCreator.mockResolvedValueOnce(null)
    await expect(
      caller(capabilitiesFor('read')).stopWorkflowRun({ runId: RUN_ID })
    ).rejects.toMatchObject(FORBIDDEN)
    expect(executionService.stopWorkflowRun).not.toHaveBeenCalled()
  })

  it('ownership does NOT rescue a member restricted from the workflow', async () => {
    // Starting a run then losing access must not leave a hole: `none` on the
    // workflow denies the stop even for the run's own author.
    guards.runCreator.mockResolvedValueOnce(USER_ID)
    await expect(
      caller(
        capabilitiesFor('none', {
          areaPermission: 'admin',
          instances: { [WF_ID]: 'none' },
        })
      ).stopWorkflowRun({ runId: RUN_ID })
    ).rejects.toMatchObject(FORBIDDEN)
    expect(executionService.stopWorkflowRun).not.toHaveBeenCalled()
  })
})

describe('workflow router — the admin tier', () => {
  it.each(ADMIN_ONLY)('%s is refused at instance edit', async (_name, call, mock) => {
    await expect(call(caller(capabilitiesFor('edit')))).rejects.toMatchObject(FORBIDDEN)
    if (mock) expect(mock()).not.toHaveBeenCalled()
  })

  it.each(ADMIN_ONLY)('%s is refused at instance view', async (_name, call, mock) => {
    await expect(call(caller(capabilitiesFor('read')))).rejects.toMatchObject(FORBIDDEN)
    if (mock) expect(mock()).not.toHaveBeenCalled()
  })

  it.each(ADMIN_ONLY)('%s succeeds at instance admin', async (_name, call, mock) => {
    await expect(call(caller(capabilitiesFor('admin')))).resolves.toBeDefined()
    if (mock) expect(mock()).toHaveBeenCalledTimes(1)
  })
})

describe('workflow router — `update` escalates on field PRESENCE (plan 30 §4)', () => {
  it('a plain layout/graph save succeeds at instance edit', async () => {
    await expect(
      caller(capabilitiesFor('edit')).update({
        id: WF_ID,
        graph: { nodes: [], edges: [] },
      })
    ).resolves.toBeDefined()
    expect(workflowService.update).toHaveBeenCalledTimes(1)
  })

  it('the other authoring fields stay on the edit rung', async () => {
    await expect(
      caller(capabilitiesFor('edit')).update({
        id: WF_ID,
        graph: { nodes: [], edges: [] },
        envVars: [{ id: 'e1', name: 'KEY', value: 'v', type: 'string' }],
        variables: [],
        entityDefinitionId: 'edef_1',
      })
    ).resolves.toBeDefined()
    expect(workflowService.update).toHaveBeenCalledTimes(1)
  })

  it('is refused at instance view even for a pure graph save', async () => {
    await expect(
      caller(capabilitiesFor('read')).update({
        id: WF_ID,
        graph: { nodes: [], edges: [] },
      })
    ).rejects.toMatchObject(FORBIDDEN)
    expect(workflowService.update).not.toHaveBeenCalled()
  })

  it.each(
    ADMIN_UPDATE_PAYLOADS
  )('carrying `%s` escalates the save to Full — refused at instance edit', async (_field, payload) => {
    await expect(
      caller(capabilitiesFor('edit')).update({
        id: WF_ID,
        graph: { nodes: [], edges: [] },
        ...payload,
      })
    ).rejects.toMatchObject(FORBIDDEN)
    expect(workflowService.update).not.toHaveBeenCalled()
  })

  it.each(
    ADMIN_UPDATE_PAYLOADS
  )('carrying `%s` succeeds at instance admin', async (_f, payload) => {
    await expect(
      caller(capabilitiesFor('admin')).update({ id: WF_ID, ...payload })
    ).resolves.toBeDefined()
    expect(workflowService.update).toHaveBeenCalledTimes(1)
  })

  it('an admin field present but explicitly `undefined` does NOT escalate', async () => {
    // The escalation test is `input[field] !== undefined`, so `{ name: undefined }`
    // stays on the edit rung. That is NOT a hole: `WorkflowService.update` guards
    // every one of these fields with the SAME `!== undefined` check (plus a
    // truthiness check on `name`), so an undefined key can't change anything
    // either. Pinned because the two checks must stay in lockstep — if the
    // service ever starts writing `undefined` through, this test is the tripwire
    // that says the router's check has to become key-presence-based
    // (`field in input`).
    await expect(
      caller(capabilitiesFor('edit')).update({
        id: WF_ID,
        graph: { nodes: [], edges: [] },
        name: undefined,
        enabled: undefined,
        webEnabled: undefined,
      })
    ).resolves.toBeDefined()
    expect(workflowService.update).toHaveBeenCalledTimes(1)
    const written = workflowService.update.mock.calls[0]?.[1] as Record<string, unknown>
    expect(written.name).toBeUndefined()
    expect(written.enabled).toBeUndefined()
    expect(written.webEnabled).toBeUndefined()
  })

  it('a settings save is refused at instance view too', async () => {
    await expect(
      caller(capabilitiesFor('read')).update({ id: WF_ID, name: 'Renamed' })
    ).rejects.toMatchObject(FORBIDDEN)
    expect(workflowService.update).not.toHaveBeenCalled()
  })
})

describe('workflow router — creating is the coarse `workflowsManage` rung', () => {
  it('create is refused for a member at the workflows Edit rung', async () => {
    await expect(
      caller(capabilitiesFor('edit')).create({ name: 'New', enabled: false })
    ).rejects.toMatchObject(FORBIDDEN)
    expect(workflowService.create).not.toHaveBeenCalled()
  })

  it('createForResource is refused for a member at the workflows Edit rung', async () => {
    await expect(
      caller(capabilitiesFor('edit')).createForResource({
        entityDefinitionId: 'edef_1',
      })
    ).rejects.toMatchObject(FORBIDDEN)
    expect(workflowService.createForResource).not.toHaveBeenCalled()
  })

  it('create succeeds once the member holds workflows Full', async () => {
    await expect(
      caller(capabilitiesFor('admin')).create({ name: 'New', enabled: false })
    ).resolves.toBeDefined()
    expect(workflowService.create).toHaveBeenCalledTimes(1)
  })

  it('duplicate needs the coarse Full rung even with instance admin on the source', async () => {
    // Instance grants are not clamped to the area, so `admin` on WF_ID under a
    // workflows-Edit profile is reachable — it still must not create a workflow.
    await expect(
      caller(capabilitiesFor('admin', { areaPermission: 'edit' })).duplicate({
        id: WF_ID,
        name: 'Copy',
      })
    ).rejects.toMatchObject(FORBIDDEN)
    expect(workflowService.duplicate).not.toHaveBeenCalled()
  })

  it('duplicate also needs `view` on the SOURCE workflow', async () => {
    await expect(
      caller(
        capabilitiesFor('none', {
          areaPermission: 'admin',
          instances: { [WF_ID]: 'none' },
        })
      ).duplicate({ id: WF_ID, name: 'Copy' })
    ).rejects.toMatchObject(FORBIDDEN)
    expect(workflowService.duplicate).not.toHaveBeenCalled()
  })

  it('duplicate succeeds at coarse Full + `view` on the source (not `admin`)', async () => {
    await expect(
      caller(capabilitiesFor('read', { areaPermission: 'admin' })).duplicate({
        id: WF_ID,
        name: 'Copy',
      })
    ).resolves.toBeDefined()
    expect(workflowService.duplicate).toHaveBeenCalledTimes(1)
  })
})

describe('workflow router — list/getManualWorkflows FILTER, never assert (plan 30 §2.2)', () => {
  const RESTRICTED = 'wf_restrictedcuid00000000'

  /** A member who may view everything except {@link RESTRICTED}. */
  const restrictedFrom = (...ids: string[]) =>
    capabilitiesFor('read', {
      areaPermission: 'read',
      instances: {
        [WF_ID]: 'read',
        ...Object.fromEntries(ids.map((id) => [id, 'none'])),
      },
    })

  it('list drops a restricted workflow instead of 403ing the whole page', async () => {
    listFixture.ids = [WF_ID, RESTRICTED]
    const result = await caller(restrictedFrom(RESTRICTED)).list({ limit: 50, offset: 0 })
    expect(result.workflows).toEqual([{ id: WF_ID }])
  })

  it('the exclusion goes INTO the query, not over its result', async () => {
    listFixture.ids = [WF_ID, RESTRICTED]
    await caller(restrictedFrom(RESTRICTED)).list({ limit: 50, offset: 0 })
    expect(workflowService.getAll).toHaveBeenCalledTimes(1)
    const filters = workflowService.getAll.mock.calls[0]?.[1] as { excludeIds?: string[] }
    expect(filters.excludeIds).toContain(RESTRICTED)
  })

  it('total and hasMore describe the FILTERED set', async () => {
    // The contract this file used to pin the OTHER way round. Post-pagination
    // filtering reported the unfiltered `total` (6) and left `hasMore` speaking
    // for rows the caller can never receive.
    listFixture.ids = [WF_ID, RESTRICTED, 'wf_c', 'wf_d', 'wf_e', 'wf_f']
    const result = await caller(restrictedFrom(RESTRICTED, 'wf_e')).list({ limit: 2, offset: 0 })
    expect(result.total).toBe(4)
    expect(result.hasMore).toBe(true)
  })

  it('a full page stays full — excluded workflows do not eat page slots', async () => {
    listFixture.ids = [WF_ID, RESTRICTED, 'wf_c', 'wf_d']
    const result = await caller(restrictedFrom(RESTRICTED)).list({ limit: 2, offset: 0 })
    expect(result.workflows).toEqual([{ id: WF_ID }, { id: 'wf_c' }])
  })

  it('never returns an empty page alongside hasMore: true', async () => {
    // The pathology: with post-pagination filtering, page 2 sliced the two
    // restricted rows, dropped both, and still said `hasMore: true` against the
    // unfiltered total — an empty page telling the client to keep paging. Walk
    // every page and assert no page is both empty and "there's more".
    listFixture.ids = [WF_ID, RESTRICTED, 'wf_c', 'wf_d', 'wf_e', 'wf_f']
    const caps = restrictedFrom(RESTRICTED, 'wf_c')
    const seen: string[] = []
    for (let offset = 0; offset < 6; offset += 2) {
      const page = await caller(caps).list({ limit: 2, offset })
      expect(page.hasMore && page.workflows.length === 0).toBe(false)
      seen.push(...page.workflows.map((w: { id: string }) => w.id))
    }
    expect(seen).toEqual([WF_ID, 'wf_d', 'wf_e', 'wf_f'])
  })

  it('list returns an empty page (not a 403) for a member with workflows: None', async () => {
    const result = await caller(capabilitiesFor('none', { instances: {} })).list({
      limit: 50,
      offset: 0,
    })
    expect(result).toEqual({ workflows: [], total: 0, hasMore: false })
    // The area gate being shut denies every workflow, INCLUDING row-less ones —
    // the one denial an id exclusion cannot express. So the router must
    // short-circuit rather than hand the query an (incomplete) exclusion list.
    expect(workflowService.getAll).not.toHaveBeenCalled()
  })

  it('an unrestricted org pays nothing — the exclusion is empty', async () => {
    listFixture.ids = [WF_ID, 'wf_c']
    const result = await caller(capabilitiesFor('admin', { instances: {} })).list({
      limit: 50,
      offset: 0,
    })
    expect(result).toEqual({ workflows: [{ id: WF_ID }, { id: 'wf_c' }], total: 2, hasMore: false })
    const filters = workflowService.getAll.mock.calls[0]?.[1] as { excludeIds?: string[] }
    expect(filters.excludeIds).toEqual([])
  })

  it('getManualWorkflows drops restricted workflows from the Run dropdown', async () => {
    getWorkflowAppsByTrigger.mockResolvedValueOnce({
      isErr: () => false,
      value: [
        { workflowApp: { id: WF_ID, name: 'Visible', description: null } },
        { workflowApp: { id: RESTRICTED, name: 'Hidden', description: null } },
      ],
    })
    await expect(
      caller(
        capabilitiesFor('read', {
          areaPermission: 'read',
          instances: { [WF_ID]: 'read', [RESTRICTED]: 'none' },
        })
      ).getManualWorkflows({ entityDefinitionId: 'edef_1' })
    ).resolves.toEqual([{ id: WF_ID, name: 'Visible', description: null }])
  })

  it('getManualWorkflows returns [] (not a 403) for a member with workflows: None', async () => {
    getWorkflowAppsByTrigger.mockResolvedValueOnce({
      isErr: () => false,
      value: [{ workflowApp: { id: WF_ID, name: 'Visible', description: null } }],
    })
    await expect(
      caller(capabilitiesFor('none', { instances: {} })).getManualWorkflows({
        entityDefinitionId: 'edef_1',
      })
    ).resolves.toEqual([])
  })
})

describe('workflow router — `baselineAtCreate: false`: no row falls back to the AREA', () => {
  /** A member with NO instance rows at all — nothing is in `governingInstanceIds`. */
  const noRows = (areaPermission: ResourcePermission) =>
    capabilitiesFor(areaPermission, { areaPermission, instances: {} })

  it('area Read ⇒ the workflow opens and runs, but does not save', async () => {
    await expect(caller(noRows('read')).getById({ id: WF_ID })).resolves.toBeDefined()
    await expect(
      caller(noRows('read')).triggerManualResource({
        workflowAppId: WF_ID,
        recordId: RECORD_ID,
      })
    ).resolves.toBeDefined()
    await expect(
      caller(noRows('read')).update({ id: WF_ID, graph: { nodes: [], edges: [] } })
    ).rejects.toMatchObject(FORBIDDEN)
  })

  it('area Edit ⇒ saves and publishes, but does not delete', async () => {
    await expect(
      caller(noRows('edit')).update({ id: WF_ID, graph: { nodes: [], edges: [] } })
    ).resolves.toBeDefined()
    await expect(caller(noRows('edit')).publish({ workflowId: WF_ID })).resolves.toBeDefined()
    await expect(caller(noRows('edit')).delete({ id: WF_ID })).rejects.toMatchObject(FORBIDDEN)
  })

  it('area Full ⇒ everything, with no ResourceAccess row anywhere', async () => {
    await expect(caller(noRows('admin')).delete({ id: WF_ID })).resolves.toBeDefined()
  })

  it('area None ⇒ nothing, even though the workflow is org-shared', async () => {
    await expect(caller(noRows('none')).getById({ id: WF_ID })).rejects.toMatchObject(FORBIDDEN)
    expect(workflowService.getById).not.toHaveBeenCalled()
  })
})

describe('workflow router — `isPublic` is a separate axis (plan 30 §8 item 4)', () => {
  it('a public workflow grants a restricted member nothing', async () => {
    // The assert runs before the row is ever fetched, so `isPublic: true` cannot
    // reach the decision. Half (b) of the coexistence rule — that restricting to
    // `none` does NOT close the public URL — lives in `apps/api`'s
    // unauthenticated `/api/v1/workflows/public/:id`, which has no member and no
    // CapabilitySet, so it is not reachable from this router.
    workflowService.getById.mockResolvedValueOnce({ id: WF_ID, isPublic: true } as never)
    await expect(
      caller(
        capabilitiesFor('none', {
          areaPermission: 'admin',
          instances: { [WF_ID]: 'none' },
        })
      ).getById({ id: WF_ID })
    ).rejects.toMatchObject(FORBIDDEN)
    expect(workflowService.getById).not.toHaveBeenCalled()
  })

  it('the levers that DO close the public surface are all Full-rung', async () => {
    // `revokeShareToken` and `update({ webEnabled/apiEnabled/accessMode })` are
    // the only ways to shut the anonymous surface — an instance `edit` holder
    // reaches none of them, so they cannot mistake a restriction for a closure.
    const editor = capabilitiesFor('edit')
    await expect(caller(editor).revokeShareToken({ id: WF_ID })).rejects.toMatchObject(FORBIDDEN)
    await expect(
      caller(editor).update({ id: WF_ID, webEnabled: false, apiEnabled: false })
    ).rejects.toMatchObject(FORBIDDEN)
    expect(workflowService.update).not.toHaveBeenCalled()
  })
})

describe('workflow router — OWNER regression (plan 30 §7)', () => {
  it('short-circuits to admin on a workflow restricted to `none`', async () => {
    // §0.10 recovery guarantee: nothing authored on a workflow can lock the last
    // owner out of the workflow that would let them undo it.
    const owner = capabilitiesFor('admin', {
      role: 'OWNER',
      instances: { [WF_ID]: 'none' },
    })
    await expect(caller(owner).delete({ id: WF_ID })).resolves.toBeDefined()
    await expect(caller(owner).update({ id: WF_ID, name: 'Renamed' })).resolves.toBeDefined()
    expect(workflowService.delete).toHaveBeenCalledTimes(1)
  })
})
