// apps/web/src/app/api/workflows/[workflowId]/webhook/events/webhook-events-instance-access.test.ts

import { ResourcePermission } from '@auxx/database/enums'
import { Area, expandLevelsToKeys, Level } from '@auxx/lib/permissions/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Plan 32, the `createSsePollRoute` instance of the class — the webhook
 * test-capture replay.
 *
 * Its `authorize` returned true for **any** org member whose
 * `defaultOrganizationId` matched the workflow's org, then streamed every
 * captured inbound webhook payload (method, headers, query, **body** of real
 * external calls) off `webhook:test:<workflowId>:events`. Since plan 30 shipped
 * per-workflow instance access, org membership is the wrong bar: a member
 * restricted from this workflow, or composing `workflows: None`, still got the
 * stream.
 *
 * Behavioral: the REAL route (the real `createSsePollRoute` factory, the real
 * `authorize`) runs with a REAL `CapabilitySet`. The Redis `lrange` is the
 * observed side effect — "did the captured payloads actually get read?" is the
 * whole assertion.
 */

const { getCapabilities, getSession, findFirst, getRedisClient, lrange, eq, and } = vi.hoisted(
  () => ({
    getCapabilities: vi.fn(),
    getSession: vi.fn(),
    findFirst: vi.fn(),
    getRedisClient: vi.fn(),
    lrange: vi.fn(),
    eq: vi.fn((a: unknown, b: unknown) => ({ op: 'eq', a, b })),
    and: vi.fn((...parts: unknown[]) => ({ op: 'and', parts })),
  })
)

vi.mock('@auxx/database', async () =>
  (await import('~/test/database-mock')).mockAuxxDatabase({
    database: { query: { WorkflowApp: { findFirst } } },
    WorkflowApp: { id: 'WorkflowApp.id', organizationId: 'WorkflowApp.organizationId' },
  })
)

vi.mock('drizzle-orm', () => ({ and, eq }))

// The `@auxx/lib/permissions` barrel HANGS under vitest (get-capabilities,
// record-view-scope, overage-*) — stub it, keep the enums real via `/client`.
vi.mock('@auxx/lib/permissions', () => ({ getCapabilities }))

vi.mock('@auxx/redis', () => ({ getRedisClient }))

vi.mock('next/headers', () => ({ headers: async () => new Headers() }))
vi.mock('~/auth/server', () => ({ auth: { api: { getSession } } }))

// Deep path on purpose — the barrel hangs (see above).
const { CapabilitySet } = await import('@auxx/lib/permissions/capabilities/capability-set')
const { GET } = await import('./route')

const ORG_ID = 'org_cuid000000000000000000000'
const USER_ID = 'usr_cuid000000000000000000000'
/** A `WorkflowApp.id` — this route's segment IS the instance-access key. */
const WF_ID = 'wf_cuid0000000000000000000'

const AREA_LEVEL_OF: Record<ResourcePermission, Level> = {
  [ResourcePermission.none]: Level.None,
  [ResourcePermission.view]: Level.Read,
  [ResourcePermission.edit]: Level.Edit,
  [ResourcePermission.admin]: Level.Full,
}

/** A real `CapabilitySet` holding `permission` on {@link WF_ID} via an explicit row. */
function capabilitiesFor(permission: ResourcePermission, areaLevel = AREA_LEVEL_OF[permission]) {
  const instances = { [WF_ID]: permission }
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

/** A real `CapabilitySet` with NO instance rows anywhere — the absent-row fallback. */
function areaOnly(level: Level) {
  return new CapabilitySet(
    new Set(expandLevelsToKeys({ [Area.workflows]: level })),
    {},
    'MEMBER',
    'full'
  )
}

function signedIn(capabilities: InstanceType<typeof CapabilitySet>) {
  getSession.mockResolvedValue({
    user: { id: USER_ID, defaultOrganizationId: ORG_ID, isSuperAdmin: false },
  })
  getCapabilities.mockResolvedValue(capabilities)
}

const params = { params: Promise.resolve({ workflowId: WF_ID }) }

const request = (signal: AbortSignal) => ({ headers: new Headers(), signal }) as never

/**
 * Reads the first SSE chunk, lets `start()` finish its Redis catch-up, then
 * aborts so neither the poll nor the heartbeat interval leaks into the next test.
 */
async function firstChunk(res: Response, controller: AbortController) {
  const reader = res.body?.getReader()
  if (!reader) throw new Error('no body')
  const { value } = await reader.read()
  await new Promise((resolve) => setTimeout(resolve, 0))
  controller.abort()
  await reader.cancel()
  // `createSsePollRoute` enqueues plain strings, not encoded bytes.
  return typeof value === 'string' ? value : new TextDecoder().decode(value)
}

beforeEach(() => {
  getSession.mockReset()
  getCapabilities.mockReset()
  findFirst.mockReset().mockResolvedValue({ id: WF_ID, ownerType: null })
  lrange.mockReset().mockResolvedValue([])
  getRedisClient.mockReset().mockResolvedValue({ lrange })
  eq.mockClear()
  and.mockClear()
})

describe('GET /api/workflows/[workflowId]/webhook/events — the captured-payload replay', () => {
  it('401s without a session, before any DB or capability read', async () => {
    getSession.mockResolvedValue(null)
    const res = await GET(request(new AbortController().signal), params)
    expect(res.status).toBe(401)
    expect(findFirst).not.toHaveBeenCalled()
    expect(getCapabilities).not.toHaveBeenCalled()
    expect(getRedisClient).not.toHaveBeenCalled()
  })

  it('403s a member composing `workflows: None`, without reading the payloads', async () => {
    signedIn(areaOnly(Level.None))
    const res = await GET(request(new AbortController().signal), params)
    expect(res.status).toBe(403)
    expect(getCapabilities).toHaveBeenCalledWith(USER_ID, ORG_ID)
    expect(getRedisClient).not.toHaveBeenCalled()
    expect(lrange).not.toHaveBeenCalled()
  })

  it('403s a member holding an explicit `none` restriction on this workflow', async () => {
    // THE case this fix exists for: the area is wide open (Full), and only the
    // per-instance `none` row stands between the caller and the payloads. Before
    // the fix, org membership alone got them the full stream.
    signedIn(capabilitiesFor(ResourcePermission.none, Level.Full))
    const res = await GET(request(new AbortController().signal), params)
    expect(res.status).toBe(403)
    expect(getRedisClient).not.toHaveBeenCalled()
    expect(lrange).not.toHaveBeenCalled()
  })

  it('403s a member holding only instance `view` — capturing test payloads is Edit', async () => {
    // The tier decision: this buffer is written only in test mode and read only by
    // the builder's webhook panel, whose "Test Webhook" button is disabled for a
    // `view`-without-`edit` holder (`useReadOnly()` → `instanceReadOnly`).
    signedIn(capabilitiesFor(ResourcePermission.view))
    const res = await GET(request(new AbortController().signal), params)
    expect(res.status).toBe(403)
    expect(getRedisClient).not.toHaveBeenCalled()
    expect(lrange).not.toHaveBeenCalled()
  })

  it('streams the captured payloads for a member holding instance `edit`', async () => {
    signedIn(capabilitiesFor(ResourcePermission.edit))
    const controller = new AbortController()
    const res = await GET(request(controller.signal), params)
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toBe('text/event-stream')
    expect(await firstChunk(res, controller)).toContain('event: connected')
    expect(lrange).toHaveBeenCalledWith(`webhook:test:${WF_ID}:events`, 0, 49)
  })

  it('streams for an instance `admin` holder', async () => {
    signedIn(capabilitiesFor(ResourcePermission.admin))
    const controller = new AbortController()
    const res = await GET(request(controller.signal), params)
    expect(res.status).toBe(200)
    await firstChunk(res, controller)
    expect(lrange).toHaveBeenCalledTimes(1)
  })

  it('streams for a row-less workflow at the area Edit rung (baselineAtCreate: false)', async () => {
    // Workflows are org-shared by default (plan 30 §3): with no `ResourceAccess`
    // row anywhere, the absent-row fallback IS the area level.
    signedIn(areaOnly(Level.Edit))
    const controller = new AbortController()
    const res = await GET(request(controller.signal), params)
    expect(res.status).toBe(200)
    await firstChunk(res, controller)
    expect(lrange).toHaveBeenCalledTimes(1)
  })

  it('403s a row-less workflow at the area Read rung', async () => {
    // Same absent-row fallback, one rung lower — proves the gate reads `edit`,
    // not `view`, on the org-shared default path too.
    signedIn(areaOnly(Level.Read))
    const res = await GET(request(new AbortController().signal), params)
    expect(res.status).toBe(403)
    expect(getRedisClient).not.toHaveBeenCalled()
  })

  it('403s a foreign-org or absent workflow id before any capability read', async () => {
    // The lookup is org-scoped, so another org's `WorkflowApp.id` is `undefined`
    // here too — identical to one that never existed, and identical (403) to one
    // the caller is restricted from. `createSsePollRoute` has no 404 path, so
    // workflow ids stay unprobeable across orgs.
    signedIn(capabilitiesFor(ResourcePermission.admin))
    findFirst.mockResolvedValue(undefined)
    const res = await GET(request(new AbortController().signal), params)
    expect(res.status).toBe(403)
    expect(getCapabilities).not.toHaveBeenCalled()
    expect(getRedisClient).not.toHaveBeenCalled()
  })

  it('403s a system-owned workflow even for an instance `admin`', async () => {
    // Sequences compile to hidden `WorkflowApp` rows (plan §3.4) that must stay
    // unaddressable by org users regardless of workflow access.
    signedIn(capabilitiesFor(ResourcePermission.admin))
    findFirst.mockResolvedValue({ id: WF_ID, ownerType: 'sequence' })
    const res = await GET(request(new AbortController().signal), params)
    expect(res.status).toBe(403)
    expect(getCapabilities).not.toHaveBeenCalled()
    expect(getRedisClient).not.toHaveBeenCalled()
  })

  it('scopes the workflow lookup to the caller organization', async () => {
    signedIn(capabilitiesFor(ResourcePermission.edit))
    const controller = new AbortController()
    const res = await GET(request(controller.signal), params)
    expect(res.status).toBe(200)
    expect(eq).toHaveBeenCalledWith('WorkflowApp.organizationId', ORG_ID)
    expect(eq).toHaveBeenCalledWith('WorkflowApp.id', WF_ID)
    await firstChunk(res, controller)
  })
})
