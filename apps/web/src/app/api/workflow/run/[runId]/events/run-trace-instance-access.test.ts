// apps/web/src/app/api/workflow/run/[runId]/events/run-trace-instance-access.test.ts

import { ResourcePermission } from '@auxx/database/enums'
import { Area, expandLevelsToKeys, Level } from '@auxx/lib/permissions/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Plan 30 §2.4, third instance of the class — the run-TRACE SSE route.
 *
 * `#1345` closed the hole on `/api/workflows/[workflowId]/run` (POST test-run,
 * DELETE stop) and missed this sibling. It authenticated with
 * `auth.api.getSession` alone and read NO capabilities, then streamed every
 * `WorkflowNodeExecution` for the run — node **inputs and outputs** — so any
 * authenticated org member could replay any run's full trace, including runs of
 * a workflow they hold an explicit `none` restriction on. Its tRPC sibling
 * `workflow.getWorkflowRun` sits behind `permissionProcedure(workflowsView)` +
 * `assertViewInstance`.
 *
 * Behavioral: the real handler runs with a REAL `CapabilitySet`. The DB reads
 * are the observed side effect — the gate must land ahead of them, so an
 * unauthorized caller cannot even probe run state.
 */

const { getCapabilities, getSession, guardRun, select, runLimit, nodeOrderBy, eq, and } =
  vi.hoisted(() => ({
    getCapabilities: vi.fn(),
    getSession: vi.fn(),
    guardRun: vi.fn(),
    runLimit: vi.fn(),
    nodeOrderBy: vi.fn(),
    select: vi.fn(),
    eq: vi.fn((a: unknown, b: unknown) => ({ op: 'eq', a, b })),
    and: vi.fn((...parts: unknown[]) => ({ op: 'and', parts })),
  }))

vi.mock('@auxx/database', async () =>
  (await import('~/test/database-mock')).mockAuxxDatabase({
    database: { select },
    schema: {
      WorkflowRun: { id: 'WorkflowRun.id', organizationId: 'WorkflowRun.organizationId' },
      WorkflowNodeExecution: {
        workflowRunId: 'WorkflowNodeExecution.workflowRunId',
        organizationId: 'WorkflowNodeExecution.organizationId',
        createdAt: 'WorkflowNodeExecution.createdAt',
      },
    },
  })
)

vi.mock('drizzle-orm', () => ({ and, eq, asc: vi.fn((c: unknown) => c) }))

// The `@auxx/lib/permissions` barrel HANGS under vitest (get-capabilities,
// record-view-scope, overage-*) — stub it, keep the enums real via `/client`.
vi.mock('@auxx/lib/permissions', () => ({ getCapabilities }))
vi.mock('@auxx/lib/workflows', () => ({ assertWorkflowRunNotSystemOwned: guardRun }))
vi.mock('@auxx/lib/workflow-engine', () => ({
  safeJsonStringify: (v: unknown) => JSON.stringify(v),
}))

vi.mock('@auxx/logger', async () => (await import('~/test/logger-mock')).mockAuxxLogger())

vi.mock('@auxx/redis', () => ({
  createDedicatedClient: vi.fn(async () => ({
    subscribe: vi.fn(async () => undefined),
    unsubscribe: vi.fn(async () => undefined),
    quit: vi.fn(async () => undefined),
    on: vi.fn(),
    removeListener: vi.fn(),
  })),
}))

vi.mock('next/headers', () => ({ headers: async () => new Headers() }))
vi.mock('~/auth/server', () => ({ auth: { api: { getSession } } }))

// Deep path on purpose — the barrel hangs (see above).
const { CapabilitySet } = await import('@auxx/lib/permissions/capabilities/capability-set')
const { permissionToRung } = await import('@auxx/lib/permissions/capabilities/rung')
const { GET } = await import('./route')

const ORG_ID = 'org_cuid000000000000000000000'
const USER_ID = 'usr_cuid000000000000000000000'
const RUN_ID = 'run_cuid000000000000000000'
/** The run's parent `WorkflowApp.id` — what instance access keys on. */
const WF_ID = 'wf_cuid0000000000000000000'

const AREA_LEVEL_OF: Record<ResourcePermission, Level> = {
  [ResourcePermission.none]: Level.None,
  [ResourcePermission.view]: Level.Read,
  [ResourcePermission.edit]: Level.Edit,
  [ResourcePermission.admin]: Level.Full,
}

/** A real `CapabilitySet` holding `permission` on {@link WF_ID} via an explicit row. */
function capabilitiesFor(permission: ResourcePermission, areaLevel = AREA_LEVEL_OF[permission]) {
  const instances = { [WF_ID]: permissionToRung(permission) }
  return new CapabilitySet(
    new Set(expandLevelsToKeys({ [Area.workflows]: areaLevel })),
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

function signedIn(capabilities: InstanceType<typeof CapabilitySet>) {
  getSession.mockResolvedValue({
    user: { id: USER_ID, defaultOrganizationId: ORG_ID, isSuperAdmin: false },
  })
  getCapabilities.mockResolvedValue(capabilities)
}

const request = () =>
  ({
    headers: new Headers(),
    signal: new AbortController().signal,
  }) as never

const params = { params: Promise.resolve({ runId: RUN_ID }) }

const runRow = {
  id: RUN_ID,
  organizationId: ORG_ID,
  workflowId: 'wfv_cuid000000000000000000',
  status: 'RUNNING',
  outputs: {},
  elapsedTime: 0,
  totalTokens: 0,
  totalSteps: 0,
  createdAt: new Date('2026-07-27T00:00:00.000Z'),
  finishedAt: null,
}

/** Reads the first SSE chunk, then cancels so no heartbeat interval leaks. */
async function firstChunk(res: Response) {
  const reader = res.body?.getReader()
  if (!reader) throw new Error('no body')
  const { value } = await reader.read()
  await reader.cancel()
  return new TextDecoder().decode(value)
}

beforeEach(() => {
  getSession.mockReset()
  getCapabilities.mockReset()
  guardRun.mockReset().mockResolvedValue(WF_ID)
  runLimit.mockReset().mockResolvedValue([runRow])
  nodeOrderBy.mockReset().mockResolvedValue([])
  eq.mockClear()
  and.mockClear()
  select.mockReset().mockReturnValue({
    from: () => ({ where: () => ({ limit: runLimit, orderBy: nodeOrderBy }) }),
  })
})

describe('GET /api/workflow/run/[runId]/events — the run-trace hole', () => {
  it('401s without a session, before any capability or DB read', async () => {
    getSession.mockResolvedValue(null)
    const res = await GET(request(), params)
    expect(res.status).toBe(401)
    expect(getCapabilities).not.toHaveBeenCalled()
    expect(select).not.toHaveBeenCalled()
  })

  it('403s a member composing `workflows: None`, before the DB reads', async () => {
    signedIn(
      new CapabilitySet(
        new Set(expandLevelsToKeys({ [Area.workflows]: Level.None })),
        {},
        'MEMBER',
        'full'
      )
    )
    const res = await GET(request(), params)
    expect(res.status).toBe(403)
    // The gate must precede the reads — otherwise run state is still probeable.
    expect(select).not.toHaveBeenCalled()
  })

  it('403s a member holding an explicit `none` restriction on the workflow', async () => {
    // THE case this fix exists for: the area is wide open (Full), and only the
    // per-instance `none` row stands between the caller and the trace. Before
    // the fix this member got the full stream.
    signedIn(capabilitiesFor(ResourcePermission.none, Level.Full))
    const res = await GET(request(), params)
    expect(res.status).toBe(403)
    expect(select).not.toHaveBeenCalled()
  })

  it('streams the trace for a member holding instance `view`', async () => {
    signedIn(capabilitiesFor(ResourcePermission.view))
    const res = await GET(request(), params)
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toBe('text/event-stream')
    expect(select).toHaveBeenCalledTimes(2)
    expect(await firstChunk(res)).toContain('event: connected')
  })

  it('streams for a row-less workflow at the area Read rung (baselineAtCreate: false)', async () => {
    // Workflows are org-shared by default (plan 30 §3): with no `ResourceAccess`
    // row anywhere, the absent-row fallback IS the area level.
    signedIn(
      new CapabilitySet(
        new Set(expandLevelsToKeys({ [Area.workflows]: Level.Read })),
        {},
        'MEMBER',
        'full'
      )
    )
    const res = await GET(request(), params)
    expect(res.status).toBe(200)
    await firstChunk(res)
  })

  it('404s an absent run without reading capabilities or run state', async () => {
    // The guard is org-scoped, so another org's run id is `undefined` here too —
    // identical to a run that never existed. Run ids are not probeable across orgs.
    signedIn(capabilitiesFor(ResourcePermission.admin))
    guardRun.mockResolvedValue(undefined)
    const res = await GET(request(), params)
    expect(res.status).toBe(404)
    expect(getCapabilities).not.toHaveBeenCalled()
    expect(select).not.toHaveBeenCalled()
  })

  it('403s a system-owned run (the guard throws)', async () => {
    signedIn(capabilitiesFor(ResourcePermission.admin))
    guardRun.mockRejectedValue(new Error('system-owned'))
    const res = await GET(request(), params)
    expect(res.status).toBe(403)
    expect(select).not.toHaveBeenCalled()
  })

  it('404s when the run row vanished between the guard and the read', async () => {
    signedIn(capabilitiesFor(ResourcePermission.admin))
    runLimit.mockResolvedValue([])
    const res = await GET(request(), params)
    expect(res.status).toBe(404)
    // The node-execution read must not happen for a run we could not load.
    expect(nodeOrderBy).not.toHaveBeenCalled()
  })

  it('scopes the node-execution read by organization (latent IDOR)', async () => {
    // It filtered on `workflowRunId` ALONE — no org scope at all — so a run id
    // leaking across org boundaries would have handed over another org's trace.
    signedIn(capabilitiesFor(ResourcePermission.view))
    const res = await GET(request(), params)
    expect(res.status).toBe(200)
    expect(eq).toHaveBeenCalledWith('WorkflowNodeExecution.organizationId', ORG_ID)
    await firstChunk(res)
  })
})
