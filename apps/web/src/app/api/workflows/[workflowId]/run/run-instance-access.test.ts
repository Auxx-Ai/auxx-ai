// apps/web/src/app/api/workflows/[workflowId]/run/run-instance-access.test.ts

import { ResourcePermission } from '@auxx/database/enums'
import { Area, expandLevelsToKeys, Level } from '@auxx/lib/permissions/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Plan 30 §2.4 — **the live privilege hole this slice closed.**
 *
 * This SSE test-run route authenticated with `auth.api.getSession` and read NO
 * capabilities at all, while its tRPC sibling `workflow.test` required
 * `workflowsManage`. Any authenticated member could POST here and test-execute
 * any workflow in their org, or DELETE to stop any run. Both handlers now resolve
 * the caller's {@link CapabilitySet} and require instance `edit` on the workflow
 * the request resolves to (test-running is an authoring action).
 *
 * Behavioral: the real handlers are invoked, and `getCapabilities` hands back a
 * REAL `CapabilitySet`. `WorkflowExecutionService` is the observed side effect —
 * "did the run actually start?" is the whole assertion. Deleting either
 * `canEditInstance` check reopens the hole and fails a case here.
 */

const { getCapabilities, getSession, executionService, guards } = vi.hoisted(() => ({
  getCapabilities: vi.fn(),
  getSession: vi.fn(),
  executionService: {
    createRun: vi.fn(async () => {
      // Deliberately throws: the handler's `start()` runs eagerly, and letting it
      // proceed would install a 15s heartbeat interval and an open SSE
      // controller. Reaching this call at all is the proof the gate let the
      // caller through; the handler catches it and closes the stream.
      throw new Error('stop after the capability gate')
    }),
    stopWorkflowRun: vi.fn(async () => ({ stopped: true })),
    executeWorkflowAsync: vi.fn(async () => undefined),
  },
  guards: {
    version: vi.fn(async () => 'wf_cuid0000000000000000000'),
    run: vi.fn(async () => 'wf_cuid0000000000000000000'),
    /**
     * `getWorkflowRunCreatorId` — who STARTED the run. Defaults to somebody
     * else, so the pre-existing "instance `view` is refused" case keeps meaning
     * "someone else's run".
     */
    runCreator: vi.fn(async () => 'usr_someoneelse0000000000000' as string | null),
  },
}))

vi.mock('@auxx/database', async () => (await import('~/test/database-mock')).mockAuxxDatabase())

// The `@auxx/lib/permissions` barrel hangs under vitest (get-capabilities,
// record-view-scope, overage-*) — which is exactly the module this route
// imports, so it has to be stubbed rather than partially mocked.
vi.mock('@auxx/lib/permissions', () => ({ getCapabilities }))

vi.mock('@auxx/lib/workflows', () => ({
  assertWorkflowVersionNotSystemOwned: guards.version,
  assertWorkflowRunNotSystemOwned: guards.run,
  getWorkflowRunCreatorId: guards.runCreator,
  WorkflowExecutionService: class {
    createRun = executionService.createRun
    stopWorkflowRun = executionService.stopWorkflowRun
    executeWorkflowAsync = executionService.executeWorkflowAsync
  },
}))

vi.mock('@auxx/lib/workflow-engine', () => ({
  RedisWorkflowExecutionReporter: class {},
  WorkflowEventType: {
    RUN_CREATED: 'run.created',
    ERROR: 'error',
    WORKFLOW_FINISHED: 'workflow.finished',
    WORKFLOW_FAILED: 'workflow.failed',
    WORKFLOW_CANCELLED: 'workflow.cancelled',
  },
}))

vi.mock('@auxx/lib/workflow-engine/utils/serialization', () => ({
  safeJsonStringify: (v: unknown) => JSON.stringify(v),
}))

vi.mock('@auxx/redis', () => ({
  RedisEventRouter: {
    getInstance: () => ({
      subscribeToWorkflowEvents: vi.fn(async () => 'handler_1'),
      unsubscribe: vi.fn(async () => undefined),
    }),
  },
}))

vi.mock('next/headers', () => ({ headers: async () => new Headers() }))
vi.mock('~/auth/server', () => ({ auth: { api: { getSession } } }))

// Deep path on purpose — see the note in `segment-instance-access.test.ts`.
const { CapabilitySet } = await import('@auxx/lib/permissions/capabilities/capability-set')
const { permissionToRung } = await import('@auxx/lib/permissions/capabilities/rung')
const { POST, DELETE } = await import('./route')

const ORG_ID = 'org_cuid000000000000000000000'
const USER_ID = 'usr_cuid000000000000000000000'
const WF_ID = 'wf_cuid0000000000000000000'
/** A `Workflow.id` (a version/draft) — what this route's path segment carries. */
const VERSION_ID = 'wfv_cuid000000000000000000'
const RUN_ID = 'run_cuid000000000000000000'

const AREA_LEVEL_OF: Record<ResourcePermission, Level> = {
  [ResourcePermission.none]: Level.None,
  [ResourcePermission.view]: Level.Read,
  [ResourcePermission.edit]: Level.Edit,
  [ResourcePermission.admin]: Level.Full,
}

/** A real `CapabilitySet` holding `permission` on {@link WF_ID} via an explicit row. */
function capabilitiesFor(
  permission: ResourcePermission,
  extraInstances: Record<string, ResourcePermission> = {}
) {
  const instances = { [WF_ID]: permissionToRung(permission), ...extraInstances }
  return new CapabilitySet(
    new Set(expandLevelsToKeys({ [Area.workflows]: AREA_LEVEL_OF[permission] })),
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

function signedIn(permission: ResourcePermission, extra: Record<string, ResourcePermission> = {}) {
  getSession.mockResolvedValue({
    user: {
      id: USER_ID,
      defaultOrganizationId: ORG_ID,
      isSuperAdmin: false,
      email: 'a@b.co',
      name: 'A',
    },
  })
  getCapabilities.mockResolvedValue(capabilitiesFor(permission, extra))
}

/** The parent app a "belongs to another workflow" case resolves to. */
const OTHER_WF_ID = 'wf_othercuid0000000000000'
/** Somebody who is NOT the caller — the default `WorkflowRun.createdBy`. */
const OTHER_USER_ID = 'usr_someoneelse0000000000000'
/** The org system user, which every headless start writes as `createdBy`. */
const SYSTEM_USER_ID = 'usr_system00000000000000000'

const params = (workflowId: string) => ({ params: Promise.resolve({ workflowId }) })

function postRequest(body: Record<string, unknown> = {}) {
  return {
    json: async () => body,
    signal: new AbortController().signal,
    url: `http://localhost/api/workflows/${VERSION_ID}/run`,
  } as never
}

const deleteRequest = (runId?: string) =>
  ({
    url: `http://localhost/api/workflows/${VERSION_ID}/run${runId ? `?runId=${runId}` : ''}`,
  }) as never

beforeEach(() => {
  getSession.mockReset()
  getCapabilities.mockReset()
  executionService.createRun.mockClear()
  executionService.stopWorkflowRun.mockClear()
  guards.version.mockReset().mockResolvedValue(WF_ID)
  guards.run.mockReset().mockResolvedValue(WF_ID)
  guards.runCreator.mockReset().mockResolvedValue(OTHER_USER_ID)
})

describe('POST /api/workflows/[workflowId]/run — the §2.4 hole', () => {
  it('401s without a session', async () => {
    getSession.mockResolvedValue(null)
    const res = await POST(postRequest(), params(VERSION_ID))
    expect(res.status).toBe(401)
    expect(executionService.createRun).not.toHaveBeenCalled()
  })

  it('403s an authenticated member holding only instance `view` (the hole)', async () => {
    // THE regression: before this slice, any member with a session got a run.
    signedIn(ResourcePermission.view)
    const res = await POST(postRequest(), params(VERSION_ID))
    expect(res.status).toBe(403)
    expect(executionService.createRun).not.toHaveBeenCalled()
  })

  it('403s a member the workflow is restricted from entirely', async () => {
    signedIn(ResourcePermission.none)
    const res = await POST(postRequest(), params(VERSION_ID))
    expect(res.status).toBe(403)
    expect(executionService.createRun).not.toHaveBeenCalled()
  })

  it('lets an instance `edit` holder through to the run', async () => {
    signedIn(ResourcePermission.edit)
    const res = await POST(postRequest({ inputs: {}, mode: 'test' }), params(VERSION_ID))
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toBe('text/event-stream')
    expect(executionService.createRun).toHaveBeenCalledTimes(1)
    await res.body?.cancel()
  })

  it('a row-less workflow falls back to the AREA level (`baselineAtCreate: false`)', async () => {
    // No `ResourceAccess` row anywhere for this workflow — workflows are
    // org-shared by default (plan 30 §3), so a member at the `workflows` Edit
    // rung may test-run it. Dashboards, at `baselineAtCreate: true`, would deny.
    getSession.mockResolvedValue({
      user: { id: USER_ID, defaultOrganizationId: ORG_ID, isSuperAdmin: false },
    })
    getCapabilities.mockResolvedValue(
      new CapabilitySet(
        new Set(expandLevelsToKeys({ [Area.workflows]: Level.Edit })),
        {},
        'MEMBER',
        'full',
        undefined,
        undefined,
        undefined,
        {},
        new Set()
      )
    )
    const res = await POST(postRequest(), params(VERSION_ID))
    expect(res.status).toBe(200)
    expect(executionService.createRun).toHaveBeenCalledTimes(1)
    await res.body?.cancel()
  })

  it('gates on the PARENT app the version resolves to, not the path id', async () => {
    // The path carries a `Workflow.id`; the guard hands back its parent
    // `WorkflowApp.id`, and instance access is keyed on THAT. A member who
    // administers WF_ID must still be refused a version belonging to a workflow
    // they're restricted from. (The restriction has to be an explicit `none`
    // row: `baselineAtCreate: false` means a row-less workflow falls back to the
    // area level, which is Full here.)
    signedIn(ResourcePermission.admin, { [OTHER_WF_ID]: ResourcePermission.none })
    guards.version.mockResolvedValueOnce(OTHER_WF_ID)
    const res = await POST(postRequest(), params(VERSION_ID))
    expect(res.status).toBe(403)
    expect(executionService.createRun).not.toHaveBeenCalled()
  })

  it('404s an unknown version before any capability read', async () => {
    signedIn(ResourcePermission.admin)
    guards.version.mockResolvedValueOnce(undefined)
    const res = await POST(postRequest(), params(VERSION_ID))
    expect(res.status).toBe(404)
    expect(getCapabilities).not.toHaveBeenCalled()
  })

  it('403s a system-owned workflow (the guard throws) ahead of the capability read', async () => {
    signedIn(ResourcePermission.admin)
    guards.version.mockRejectedValueOnce(new Error('system-owned'))
    const res = await POST(postRequest(), params(VERSION_ID))
    expect(res.status).toBe(403)
    expect(getCapabilities).not.toHaveBeenCalled()
  })
})

describe('DELETE /api/workflows/[workflowId]/run — stopping someone else’s run', () => {
  it('401s without a session', async () => {
    getSession.mockResolvedValue(null)
    const res = await DELETE(deleteRequest(RUN_ID), params(VERSION_ID))
    expect(res.status).toBe(401)
    expect(executionService.stopWorkflowRun).not.toHaveBeenCalled()
  })

  it('400s without a runId', async () => {
    signedIn(ResourcePermission.admin)
    const res = await DELETE(deleteRequest(), params(VERSION_ID))
    expect(res.status).toBe(400)
  })

  it('403s an instance `view` holder stopping SOMEONE ELSE’s run', async () => {
    signedIn(ResourcePermission.view)
    const res = await DELETE(deleteRequest(RUN_ID), params(VERSION_ID))
    expect(res.status).toBe(403)
    expect(executionService.stopWorkflowRun).not.toHaveBeenCalled()
  })

  it('lets an instance `view` holder stop a run THEY started', async () => {
    // The corollary of "`view` means you may RUN it" (plan 30 §2): a member who
    // can start a run must be able to cancel the one they started.
    signedIn(ResourcePermission.view)
    guards.runCreator.mockResolvedValueOnce(USER_ID)
    const res = await DELETE(deleteRequest(RUN_ID), params(VERSION_ID))
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({ stopped: true })
    expect(executionService.stopWorkflowRun).toHaveBeenCalledTimes(1)
  })

  it('403s an instance `view` holder stopping a SYSTEM/headless run', async () => {
    // Schedules, record events, rules and webhooks run as the org's system user
    // — a real `User.id`, never the caller's — so the id comparison covers them
    // without a `'system'` sentinel.
    signedIn(ResourcePermission.view)
    guards.runCreator.mockResolvedValueOnce(SYSTEM_USER_ID)
    const res = await DELETE(deleteRequest(RUN_ID), params(VERSION_ID))
    expect(res.status).toBe(403)
    expect(executionService.stopWorkflowRun).not.toHaveBeenCalled()
  })

  it('403s an instance `view` holder stopping a run with NO owner', async () => {
    // `createdBy` is `ON DELETE SET NULL`, so a run outlives its creator's row.
    // `null` must never read as "mine".
    signedIn(ResourcePermission.view)
    guards.runCreator.mockResolvedValueOnce(null)
    const res = await DELETE(deleteRequest(RUN_ID), params(VERSION_ID))
    expect(res.status).toBe(403)
    expect(executionService.stopWorkflowRun).not.toHaveBeenCalled()
  })

  it('403s a member restricted from the workflow even for their OWN run', async () => {
    signedIn(ResourcePermission.none)
    guards.runCreator.mockResolvedValueOnce(USER_ID)
    const res = await DELETE(deleteRequest(RUN_ID), params(VERSION_ID))
    expect(res.status).toBe(403)
    expect(executionService.stopWorkflowRun).not.toHaveBeenCalled()
  })

  it('stops someone else’s run for an instance `edit` holder', async () => {
    signedIn(ResourcePermission.edit)
    const res = await DELETE(deleteRequest(RUN_ID), params(VERSION_ID))
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({ stopped: true })
    expect(executionService.stopWorkflowRun).toHaveBeenCalledTimes(1)
    // Ownership only matters at the `view` tier — `edit` must not pay the read.
    expect(guards.runCreator).not.toHaveBeenCalled()
  })

  it('gates on the RUN’s parent app, not the path id', async () => {
    signedIn(ResourcePermission.admin, { [OTHER_WF_ID]: ResourcePermission.none })
    guards.run.mockResolvedValueOnce(OTHER_WF_ID)
    const res = await DELETE(deleteRequest(RUN_ID), params(VERSION_ID))
    expect(res.status).toBe(403)
    expect(executionService.stopWorkflowRun).not.toHaveBeenCalled()
  })

  it('404s an unknown run before any capability read', async () => {
    signedIn(ResourcePermission.admin)
    guards.run.mockResolvedValueOnce(undefined)
    const res = await DELETE(deleteRequest(RUN_ID), params(VERSION_ID))
    expect(res.status).toBe(404)
    expect(getCapabilities).not.toHaveBeenCalled()
  })
})
