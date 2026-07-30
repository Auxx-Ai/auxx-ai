// apps/web/src/app/api/eval/run/[runId]/events/agent-access.test.ts

import { ResourcePermission } from '@auxx/database/enums'
import {
  Area,
  expandLevelsToKeys,
  Level,
  type PermissionKey,
  PermissionKey as PermissionKeyEnum,
} from '@auxx/lib/permissions/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The eval SSE recovery route authenticated with `auth.api.getSession` and
 * scoped the run by organization, but read no capabilities — so any
 * authenticated member could replay any eval run's full trace (agent messages,
 * tool calls, assertion verdicts) while every `eval.*` tRPC procedure sits
 * behind a capability gate.
 *
 * Behavioral: the real handler runs, with a REAL `CapabilitySet`. The DB read
 * is the observed side effect — the coarse gate must land ahead of it.
 *
 * **The fake distinguishes tables on purpose.** The original version stubbed
 * `from()` as a table-blind passthrough, so every query in the handler returned
 * the same row. That made all four tests pass against a handler that never ran
 * its per-agent check at all: the run row carried no `caseId`, so it always took
 * the orphan branch. A fake that models the return value but not the REQUEST
 * cannot fail on the request — the same lesson `grantee-access.test.ts` records
 * for `fakeDb`'s invisible WHERE clause.
 */

const { getCapabilities, getSession, selectFrom } = vi.hoisted(() => ({
  getCapabilities: vi.fn(),
  getSession: vi.fn(),
  // table name -> rows. Set per test; an unset table yields [].
  selectFrom: vi.fn((_table: string) => [] as unknown[]),
}))

vi.mock('@auxx/database', () => ({
  database: {
    select: () => ({
      from: (table: string) => ({ where: () => ({ limit: async () => selectFrom(table) }) }),
    }),
  },
  schema: {
    EvalRun: { id: 'id', organizationId: 'organizationId' },
    EvalCase: { id: 'id', organizationId: 'organizationId', agentId: 'agentId' },
    EvalSuiteRun: { id: 'id', organizationId: 'organizationId', agentId: 'agentId' },
  },
}))

vi.mock('drizzle-orm', () => ({ and: vi.fn(), eq: vi.fn() }))

vi.mock('@auxx/logger', () => ({
  createScopedLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}))

// The barrel hangs under vitest — stub it, keep the enums real via /client.
vi.mock('@auxx/lib/permissions', () => ({ getCapabilities }))

vi.mock('@auxx/redis', () => ({
  RedisEventRouter: {
    getInstance: () => ({ subscribe: vi.fn(async () => 'h1'), unsubscribe: vi.fn() }),
  },
}))

vi.mock('next/headers', () => ({ headers: async () => new Headers() }))
vi.mock('~/auth/server', () => ({ auth: { api: { getSession } } }))

const { CapabilitySet } = await import('@auxx/lib/permissions/capabilities/capability-set')
const { permissionToRung } = await import('@auxx/lib/permissions/capabilities/rung')
const { GET } = await import('./route')

const ORG_ID = 'org_cuid000000000000000000000'
const USER_ID = 'usr_cuid000000000000000000000'
const RUN_ID = 'evr_cuid000000000000000000000'
const CASE_ID = 'evc_cuid000000000000000000000'
const SUITE_RUN_ID = 'esr_cuid000000000000000000000'
const AGENT_ID = 'agt_cuid000000000000000000000'

/**
 * @param agentsLevel the member's composed `Area.agents` level
 * @param instance an explicit `ResourceAccess` row on {@link AGENT_ID}, or none.
 *   `instanceAccess` is keyed by bare instance id and `restrictedInstanceIds`
 *   marks which ids carry an explicit row — both are needed, or the row is
 *   invisible to `effectiveInstanceLevel`.
 *
 *   The row is stated as a `ResourcePermission` and converted to a `Rung` on the
 *   way in: permissions v3 split the two axes, and `instanceAccess` takes rungs.
 *   A bare `view` in a rung slot evaluates to NO access — it fails exactly the
 *   explicit-grant cases while the `none` and area-level ones keep passing.
 */
function signedIn(agentsLevel: Level, instance?: ResourcePermission) {
  getSession.mockResolvedValue({ user: { id: USER_ID, defaultOrganizationId: ORG_ID } })
  // Item 5b: a grant that reaches `view` synthesizes the area's Read rung into
  // `instanceDerivedKeys`, which is what lets a member composing `agents: None`
  // past a coarse `agents.view` front door at all. `computeUserCapabilities`
  // does this in production, so a harness that omits it would report a 403 the
  // real system never returns.
  const derived =
    instance !== undefined && instance !== ResourcePermission.none
      ? new Set([PermissionKeyEnum.agentsView])
      : new Set<PermissionKey>()
  getCapabilities.mockResolvedValue(
    new CapabilitySet(
      new Set(expandLevelsToKeys({ [Area.agents]: agentsLevel }) as PermissionKey[]),
      {},
      'MEMBER',
      'full',
      (id) => id,
      new Set(),
      (id) => id,
      instance === undefined ? {} : { [AGENT_ID]: permissionToRung(instance) },
      instance === undefined ? new Set() : new Set([AGENT_ID]),
      {},
      derived
    )
  )
}

const request = () =>
  ({
    headers: new Headers(),
    nextUrl: new URL(`http://localhost/api/eval/run/${RUN_ID}/events`),
    signal: new AbortController().signal,
  }) as never

const params = { params: Promise.resolve({ runId: RUN_ID }) }

/**
 * Wire the three tables the handler reads.
 *
 * `caseAgentId` and `suiteAgentId` are INDEPENDENT so the case→suite fallback
 * can actually be exercised. An earlier version drove both from one flag, which
 * meant the "falls back to the suite run" test never took the suite branch at
 * all — deleting that branch outright left the whole file green.
 */
function withRun(
  opts: {
    caseId?: string | null
    suiteRunId?: string | null
    caseAgentId?: string | null
    suiteAgentId?: string | null
  } = {}
) {
  const {
    caseId = CASE_ID,
    suiteRunId = SUITE_RUN_ID,
    caseAgentId = AGENT_ID,
    suiteAgentId = AGENT_ID,
  } = opts
  selectFrom.mockImplementation((table: unknown) => {
    // The mocked `schema` entries are objects; identify them by reference.
    if (table === mockedSchema.EvalRun) {
      return [{ id: RUN_ID, status: 'passed', trace: [], assertionResults: [], caseId, suiteRunId }]
    }
    if (table === mockedSchema.EvalCase) return caseAgentId ? [{ agentId: caseAgentId }] : []
    if (table === mockedSchema.EvalSuiteRun) return suiteAgentId ? [{ agentId: suiteAgentId }] : []
    return []
  })
}

const { schema: mockedSchema } = await import('@auxx/database')

beforeEach(() => {
  getSession.mockReset()
  getCapabilities.mockReset()
  selectFrom.mockReset()
  withRun()
})

describe('GET /api/eval/run/[runId]/events — coarse gate', () => {
  it('401s without a session', async () => {
    getSession.mockResolvedValue(null)
    const res = await GET(request(), params)
    expect(res.status).toBe(401)
    expect(selectFrom).not.toHaveBeenCalled()
  })

  it('403s a member without agents.view before touching the run', async () => {
    signedIn(Level.None)
    const res = await GET(request(), params)
    expect(res.status).toBe(403)
    // The gate must precede the DB read — otherwise existence is still probeable.
    expect(selectFrom).not.toHaveBeenCalled()
  })

  it('404s an unknown run for an authorized member', async () => {
    signedIn(Level.Full)
    selectFrom.mockImplementation(() => [])
    const res = await GET(request(), params)
    expect(res.status).toBe(404)
  })
})

describe('GET /api/eval/run/[runId]/events — per-agent access', () => {
  it('streams a run whose agent the member may view', async () => {
    signedIn(Level.Read)
    const res = await GET(request(), params)
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toBe('text/event-stream')
    expect(await res.text()).toContain('connected')
  })

  it('403s a member restricted on THAT agent, even holding the whole area', async () => {
    // The exact bypass the per-instance check exists for: `agents: Full` is the
    // top rung, and an explicit `none` row must still win.
    signedIn(Level.Full, ResourcePermission.none)
    const res = await GET(request(), params)
    expect(res.status).toBe(403)
  })

  it('streams for a member with agents: None plus an explicit grant on that agent', async () => {
    // Plan 25 §2: an explicit instance row outranks a closed area floor.
    signedIn(Level.None, ResourcePermission.view)
    const res = await GET(request(), params)
    expect(res.status).toBe(200)
  })

  it('falls back to the SUITE RUN when the case no longer names an agent', async () => {
    // `EvalCase.agentId` is nullable and the case row itself may be gone; the
    // suite run still knows which agent ran. This must resolve to a real agent
    // — not to the orphan branch — so a restriction on that agent still binds.
    withRun({ caseAgentId: null, suiteAgentId: AGENT_ID })
    signedIn(Level.Full, ResourcePermission.none)
    expect((await GET(request(), params)).status).toBe(403)
    signedIn(Level.None, ResourcePermission.view)
    expect((await GET(request(), params)).status).toBe(200)
  })

  it('requires the top rung for an orphaned run with no agent to judge', async () => {
    withRun({ caseId: null, suiteRunId: null, caseAgentId: null, suiteAgentId: null })
    signedIn(Level.Edit)
    expect((await GET(request(), params)).status).toBe(403)
    signedIn(Level.Full)
    expect((await GET(request(), params)).status).toBe(200)
  })
})
