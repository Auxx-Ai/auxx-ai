// apps/web/src/server/api/routers/workflow-arm-webhook-test.test.ts

import { ResourcePermission } from '@auxx/database/enums'
import { Area, expandLevelsToKeys, Level, PermissionKey } from '@auxx/lib/permissions/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * `workflow.armWebhookTest` — the authenticated half of the webhook draft-test
 * pair.
 *
 * Arming opens a TTL'd window during which the ANONYMOUS
 * `/api/workflows/<id>/webhook?test=true` route will resolve and answer from the
 * org's unpublished draft graph. That is a delegation of authoring authority to
 * an unauthenticated caller, so it sits at instance `edit` — the same tier as
 * `workflow.test` and the SSE `/api/workflows/[workflowId]/run` route, and NOT
 * the `view` tier that merely "may run it".
 *
 * Behavioural: the real router is driven through a tRPC caller with a REAL
 * `CapabilitySet`, and the real `armWebhookTestWindow` runs against a fake
 * Redis. The written key is the observed side effect.
 */

const { redis, getRedisClient, workflowService, guards, featureService, appRows } = vi.hoisted(
  () => {
    const store = new Map<string, string>()
    const client = {
      store,
      set: vi.fn(async (key: string, value: string, ..._args: unknown[]) => {
        store.set(key, value)
        return 'OK'
      }),
      exists: vi.fn(async (key: string) => (store.has(key) ? 1 : 0)),
    }
    return {
      redis: client,
      getRedisClient: vi.fn(async () => client),
      /** Rows `db.select()...limit(1)` hands back — empty models "not in this org". */
      appRows: { value: [{ id: 'wf_cuid0000000000000000000' }] as { id: string }[] },
      workflowService: { test: vi.fn(async () => ({ success: true })) },
      guards: { app: vi.fn(async () => undefined) },
      featureService: { requireAccess: vi.fn(async () => undefined) },
    }
  }
)

vi.mock('@auxx/redis', () => ({ getRedisClient }))

// Real drizzle columns come back undefined under vitest, and `eq()` on them is
// not worth the setup — the router's org predicate is exercised through the
// rows the fake query builder returns, not through generated SQL.
vi.mock('@auxx/database', async () =>
  (await import('~/test/database-mock')).mockAuxxDatabase({
    schema: {
      WorkflowApp: { id: 'WorkflowApp.id', organizationId: 'WorkflowApp.organizationId' },
    },
  })
)

vi.mock('@auxx/lib/workflows', () => ({
  WorkflowService: class {
    test = workflowService.test
  },
  WorkflowVersionService: class {},
  WorkflowStatsService: class {},
  WorkflowExecutionService: class {},
  assertWorkflowAppNotSystemOwned: guards.app,
  assertWorkflowRunNotSystemOwned: vi.fn(async () => 'wf_cuid0000000000000000000'),
  getWorkflowRunCreatorId: vi.fn(async () => null),
  buildTemplateWorkflowData: vi.fn(async () => ({})),
  toWorkflowAppResponse: (app: unknown) => app,
  WORKFLOW_TRIGGER_TYPE_VALUES: ['manual', 'form', 'scheduled'] as const,
  checkEntityReadiness: vi.fn(async () => ({ ready: true })),
  listFileTemplates: vi.fn(() => []),
}))

vi.mock('@auxx/lib/workflow-engine', () => ({
  triggerManualResourceWorkflow: vi.fn(),
  triggerManualResourceWorkflowBulk: vi.fn(),
}))

vi.mock('@auxx/services/workflows', () => ({ getWorkflowAppsByTrigger: vi.fn(async () => []) }))
vi.mock('@auxx/lib/workflow-templates', () => ({
  getAllTemplates: vi.fn(async () => ({ isErr: () => false, value: [] })),
  getTemplateById: vi.fn(async () => ({ isErr: () => false, value: null })),
}))

vi.mock('@auxx/lib/cache', () => ({
  getCachedWorkflowAppCount: vi.fn(async () => 0),
  getAppCache: () => ({ getOrRecompute: vi.fn(async () => ({})) }),
}))

vi.mock('@auxx/lib/demo', () => ({ DemoGuard: { requireNotDemo: vi.fn(async () => undefined) } }))
vi.mock('~/server/api/audit-context', () => ({ recordAuditFromCtx: vi.fn(async () => undefined) }))
vi.mock('~/server/api/workflow-template-resolver', () => ({
  resolveTemplateById: vi.fn(async () => null),
}))

// The `@auxx/lib/permissions` barrel reaches redis/db at import time and hangs
// under vitest — see `dataset-instance-access.test.ts`. Real registry, stub
// feature service.
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

/** Mirrors the real `permissionProcedure` gate — a plain `capabilities.assert(key)`. */
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
const { webhookTestArmKey, WEBHOOK_TEST_WINDOW_TTL_SECONDS } = await import(
  '~/server/lib/webhook-test-window'
)
const { workflowRouter } = await import('./workflow')

const ORG_ID = 'org_cuid000000000000000000000'
const USER_ID = 'usr_cuid000000000000000000000'
const WF_ID = 'wf_cuid0000000000000000000'

/** AuxxError, wrapped by tRPC as `cause` (the app's middleware maps it to 403). */
const FORBIDDEN = { cause: { name: 'ForbiddenError', statusCode: 403 } }

const AREA_LEVEL_OF: Record<ResourcePermission, Level> = {
  [ResourcePermission.none]: Level.None,
  [ResourcePermission.view]: Level.Read,
  [ResourcePermission.edit]: Level.Edit,
  [ResourcePermission.admin]: Level.Full,
}

function capabilitiesFor(
  permission: ResourcePermission,
  opts: { instances?: Record<string, ResourcePermission>; areaPermission?: ResourcePermission } = {}
) {
  const instances = opts.instances ?? { [WF_ID]: permission }
  const derived = Object.values(instances).some((p) => p !== ResourcePermission.none)
    ? [PermissionKey.workflowsView]
    : []
  return new CapabilitySet(
    new Set(
      expandLevelsToKeys({ [Area.workflows]: AREA_LEVEL_OF[opts.areaPermission ?? permission] })
    ),
    {},
    'MEMBER',
    'full',
    undefined,
    undefined,
    undefined,
    instances,
    new Set(Object.keys(instances)),
    undefined,
    new Set(derived)
  )
}

/** `db.select().from().where().limit()` — resolves to {@link appRows}. */
function fakeDb() {
  const chain: Record<string, unknown> = {}
  chain.select = () => chain
  chain.from = () => chain
  chain.where = () => chain
  chain.limit = async () => appRows.value
  return chain
}

function caller(capabilities: InstanceType<typeof CapabilitySet>) {
  return workflowRouter.createCaller({
    db: fakeDb(),
    capabilities,
    session: {
      organizationId: ORG_ID,
      userId: USER_ID,
      isSuperAdmin: false,
      user: { id: USER_ID, defaultOrganizationId: ORG_ID, email: 'a@b.c', name: 'A' },
    },
  } as never)
}

beforeEach(() => {
  redis.store.clear()
  redis.set.mockClear()
  guards.app.mockClear().mockResolvedValue(undefined)
  appRows.value = [{ id: WF_ID }]
})

describe('workflow.armWebhookTest — instance `edit`', () => {
  it('arms the window for an instance `edit` holder', async () => {
    await expect(
      caller(capabilitiesFor(ResourcePermission.edit)).armWebhookTest({ workflowId: WF_ID })
    ).resolves.toEqual({ expiresInSeconds: WEBHOOK_TEST_WINDOW_TTL_SECONDS })
    expect(redis.store.get(webhookTestArmKey(WF_ID))).toBe('1')
  })

  it('refuses an instance `view` holder — `view` may RUN it, not open it up', async () => {
    // The tier claim under test: `view` is enough to trigger a workflow (plan 30
    // §2), but arming hands draft execution to anonymous callers, so it tracks
    // `workflow.test` at `edit`.
    await expect(
      caller(capabilitiesFor(ResourcePermission.view)).armWebhookTest({ workflowId: WF_ID })
    ).rejects.toMatchObject(FORBIDDEN)
    expect(redis.set).not.toHaveBeenCalled()
  })

  it('refuses a member restricted from the workflow entirely', async () => {
    await expect(
      caller(
        capabilitiesFor(ResourcePermission.none, {
          areaPermission: ResourcePermission.admin,
          instances: { [WF_ID]: ResourcePermission.none },
        })
      ).armWebhookTest({ workflowId: WF_ID })
    ).rejects.toMatchObject(FORBIDDEN)
    expect(redis.set).not.toHaveBeenCalled()
  })

  it('writes the arm key at the SHARED TTL, so it cannot drift from the event list', async () => {
    await caller(capabilitiesFor(ResourcePermission.edit)).armWebhookTest({ workflowId: WF_ID })
    expect(redis.set).toHaveBeenCalledWith(
      webhookTestArmKey(WF_ID),
      '1',
      'EX',
      WEBHOOK_TEST_WINDOW_TTL_SECONDS
    )
  })

  it('404s a workflow outside the caller’s org before arming', async () => {
    // `workflow` is `baselineAtCreate: false`, so a row-less (foreign) id falls
    // back to the caller's AREA level and would otherwise sail through the
    // instance assert — letting a member open a draft window on another org's
    // workflow.
    appRows.value = []
    await expect(
      caller(capabilitiesFor(ResourcePermission.admin, { instances: {} })).armWebhookTest({
        workflowId: 'wf_someotherorg000000000',
      })
    ).rejects.toMatchObject({ code: 'NOT_FOUND' })
    expect(redis.set).not.toHaveBeenCalled()
  })

  it('refuses a system-owned workflow', async () => {
    const { ForbiddenError } = await import('@auxx/lib/errors')
    guards.app.mockRejectedValueOnce(new ForbiddenError('system-owned'))
    await expect(
      caller(capabilitiesFor(ResourcePermission.admin)).armWebhookTest({ workflowId: WF_ID })
    ).rejects.toMatchObject(FORBIDDEN)
    expect(redis.set).not.toHaveBeenCalled()
  })

  it('a row-less workflow still needs the AREA at Edit', async () => {
    // No `ResourceAccess` row anywhere: the area level decides. Read is not enough.
    await expect(
      caller(capabilitiesFor(ResourcePermission.view, { instances: {} })).armWebhookTest({
        workflowId: WF_ID,
      })
    ).rejects.toMatchObject(FORBIDDEN)
    await expect(
      caller(capabilitiesFor(ResourcePermission.edit, { instances: {} })).armWebhookTest({
        workflowId: WF_ID,
      })
    ).resolves.toBeDefined()
  })
})
