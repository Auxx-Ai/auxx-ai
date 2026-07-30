// apps/web/src/app/api/kopilot/stream/agent-access.test.ts

import { ResourcePermission } from '@auxx/database/enums'
import {
  Area,
  expandLevelsToKeys,
  FeatureKey,
  Level,
  PermissionKey,
  type PermissionKey as PermissionKeyType,
} from '@auxx/lib/permissions/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * **The live authorization hole this file closes.**
 *
 * `POST /api/kopilot/stream` authenticated with `auth.api.getSession` alone and
 * read NO capabilities, while every `agent.*` tRPC procedure requires
 * `agents.manage`. `agentId` arrives verbatim on the request body, so any
 * authenticated member could chat with any agent in the org — including agents
 * they cannot see in the UI. The only agent-side check was
 * `buildDmTriggerContext`, which tests the ORG-WIDE `dmEnabled` toggle, not the
 * caller.
 *
 * Behavioral: the real handler is invoked and driven end to end, with a REAL
 * `CapabilitySet` handed back by `getCapabilities`. `withAgentRunLog` is the
 * observed side effect — it wraps the whole turn, so "was it called?" is
 * exactly "did this request get past the gate into the run?".
 *
 * Two halves are tested separately on purpose: a NEW session is authorized from
 * `body.agentId` before the stream opens (plain 403), while a CONTINUATION turn
 * restores its agent from the SESSION ROW and is authorized inside the stream
 * (`turn-error` / `forbidden`). Deleting either arm reopens the hole.
 *
 * **Permissions v2 item 4 (plan 25 §4.2) then made the gate agent-ID-AWARE.**
 * The coarse rung dropped from `agents.manage` to the new `agents.view` (chat is
 * USE, not authoring), and `assertViewInstance('agent', id)` joined it on the
 * resolved id. Three things below exist only for that:
 *  - a member at `agents: Full` restricted from ONE agent is refused it;
 *  - a member at `agents: None` holding ONE explicit grant reaches exactly it;
 *  - a SLUG in `body.agentId` is resolved to the real `Agent.id` before the
 *    assert, or the row lookup misses and the area level lets them straight in.
 * The status code is asserted on every denial, not merely "it didn't run": the
 * `assert*Instance` helpers THROW `AuxxError`, and this is an App Router handler
 * with no `auxxErrorMiddleware` to map it — an escaping throw is a 500.
 */

const {
  getCapabilities,
  getSession,
  hasFeature,
  getCachedAgentById,
  getAllCachedAgents,
  createSession,
  getSessionById,
  runTurn,
  isAdminOrOwner,
} = vi.hoisted(() => ({
  getCapabilities: vi.fn(),
  getSession: vi.fn(),
  hasFeature: vi.fn(),
  getCachedAgentById: vi.fn(),
  /**
   * `resolveAgentId`'s only input — the org agents cache. Returning a row with
   * BOTH an id and a slug is what makes the "addressed by slug" case meaningful:
   * a resolver that handed the raw input straight through would look up a
   * `ResourceAccess` row keyed on the slug, find none, and fall back to the area
   * level.
   */
  getAllCachedAgents: vi.fn(),
  createSession: vi.fn(),
  getSessionById: vi.fn(),
  /**
   * Stands in for `withAgentRunLog`, which wraps the entire turn. It
   * deliberately does NOT invoke the wrapped `runPath` — reaching it at all is
   * the proof the gate let the caller through, and running the real engine here
   * would buy nothing.
   */
  runTurn: vi.fn(async () => undefined),
  isAdminOrOwner: vi.fn(async () => false),
}))

vi.mock('@auxx/database', () => ({ database: {}, schema: {} }))

vi.mock('@auxx/logger', () => ({
  createScopedLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}))

// The `@auxx/lib/permissions` barrel hangs under vitest (get-capabilities,
// record-view-scope, overage-*), and it is exactly what this route imports, so
// it has to be stubbed wholesale. The enums come from the client subpath so the
// route asserts the REAL `agents.manage` / `agents` values.
vi.mock('@auxx/lib/permissions', async () => {
  const client = await import('@auxx/lib/permissions/client')
  return {
    FeatureKey: client.FeatureKey,
    PermissionKey: client.PermissionKey,
    getCapabilities,
    FeaturePermissionService: class {
      hasAccess = hasFeature
    },
  }
})

vi.mock('@auxx/lib/cache', () => ({
  getCachedAgentById,
  getAllCachedAgents,
  getCachedDefaultModel: vi.fn(async () => null),
}))

// NOT stubbed any more. `agent-instance-access` throws the real `NotFoundError`
// and `CapabilitySet.assertViewInstance` the real `ForbiddenError`, and the
// route's `error instanceof AuxxError` catch is what keeps those from escaping
// as a 500 — a hand-rolled stub class would make that catch pass vacuously.
// `@auxx/lib/errors` is a dependency-free leaf, so importing it is safe here.

vi.mock('@auxx/lib/members', () => ({ isAdminOrOwner }))

vi.mock('@auxx/lib/tiptap', () => ({ docToText: () => '' }))

vi.mock('@auxx/lib/agents', () => ({
  buildDmTriggerContext: vi.fn(() => ({
    triggerContext: { triggerId: 'trg_1', kind: 'dm', firedAt: new Date().toISOString() },
    triggerInstructions: null,
  })),
  filterToolsByToolsets: vi.fn((tools: unknown) => tools),
  resolveAgentConfig: vi.fn(async () => ({ knowledge: [] })),
  resolveAgentKnowledgeScope: vi.fn(async () => null),
}))

vi.mock('@auxx/lib/ai', () => ({
  UsageTrackingService: class {
    trackUsageBatch = vi.fn(async () => undefined)
  },
}))

vi.mock('@auxx/lib/ai/agent-framework', () => ({
  AgentEngine: class {},
  cleanDomainStateForModelSwitch: vi.fn((s: unknown) => s),
  createCallModel: vi.fn(),
  enqueueAgentJob: vi.fn(async () => undefined),
  flattenMessagesForModelSwitch: vi.fn((m: unknown) => m),
  resolveAgentRunCapabilities: vi.fn(async () => null),
  subscribeToAgentEvents: vi.fn(),
  withAgentRunLog: runTurn,
  BUILDER_MODEL: { provider: 'anthropic', model: 'x' },
}))

vi.mock('@auxx/lib/ai/kopilot', () => ({
  createActorCapabilities: vi.fn(),
  createAgentsBuilderCapabilities: vi.fn(),
  createAppCapabilities: vi.fn(),
  createCapabilityRegistry: vi.fn(),
  createEntityCapabilities: vi.fn(),
  createKbCapabilities: vi.fn(),
  createKbReadCapabilities: vi.fn(),
  createKnowledgeCapabilities: vi.fn(),
  createKopilotCapabilities: vi.fn(),
  createKopilotDomainConfig: vi.fn(),
  createMailCapabilities: vi.fn(),
  createRecordViewCapabilities: vi.fn(),
  createSuggestRepliesGlobalCapability: vi.fn(),
  createTaskCapabilities: vi.fn(),
  generateSessionTitle: vi.fn(async () => null),
  LAST_CONTEXT_KEY: '_lastContext',
  LAST_PAGE_KEY: '_lastPage',
  resolveContinuationSurface: vi.fn(
    ({ requestPage, requestContext }: { requestPage?: string; requestContext?: unknown }) => ({
      page: requestPage,
      context: requestContext,
    })
  ),
}))

vi.mock('@auxx/lib/ai/kopilot/capabilities', () => ({
  createLearnedKbCapabilities: vi.fn(),
  createToolDepsFactory: vi.fn(),
}))

vi.mock('@auxx/lib/ai/mcp', () => ({ createMcpCapabilities: vi.fn() }))

vi.mock('@auxx/services', () => ({
  createSession,
  getSessionById,
  saveSessionMessages: vi.fn(async () => undefined),
  updateSessionDomainState: vi.fn(async () => undefined),
  updateSessionModelId: vi.fn(async () => undefined),
  updateSessionTitle: vi.fn(async () => undefined),
}))

vi.mock('./task-notification', () => ({ resolveTaskNotification: vi.fn() }))

vi.mock('next/headers', () => ({ headers: async () => new Headers() }))
vi.mock('~/auth/server', () => ({ auth: { api: { getSession } } }))

// Deep path on purpose — the barrel above is mocked, and it hangs under vitest.
const { CapabilitySet } = await import('@auxx/lib/permissions/capabilities/capability-set')
const { permissionToRung } = await import('@auxx/lib/permissions/capabilities/rung')
const { POST } = await import('./route')

const ORG_ID = 'org_cuid000000000000000000000'
const USER_ID = 'usr_cuid000000000000000000000'
const AGENT_ID = 'agt_cuid000000000000000000000'
const AGENT_SLUG = 'escalation-lead'
const SESSION_ID = 'ses_cuid000000000000000000000'

/**
 * A real `CapabilitySet` composed from one area level, exactly as the composer
 * does.
 *
 * `instances` adds explicit `ResourceAccess` instance rows (what the share
 * dialog writes) and, with them, the derived Read rung
 * `composeUserCapabilities` synthesizes for any member holding a ≥`view` grant —
 * without it an `agents: None` grantee would be refused at the coarse front door
 * and the `include` regime would be untestable.
 *
 * The rows are stated in the `ResourcePermission` vocabulary the share dialog
 * writes, and converted to `Rung`s on the way into `instanceAccess` — that
 * parameter is `Record<string, Rung>`, and permissions v3 split the two axes
 * apart. Handing it a bare `view` puts a non-rung in a rung slot, where it
 * evaluates to NO access and every "member holds an explicit grant" case fails
 * while the `none` and area-level ones keep passing.
 */
function capabilitiesWith(agentsLevel: Level, instances: Record<string, ResourcePermission> = {}) {
  const derived = Object.values(instances).some((p) => p !== ResourcePermission.none)
    ? [PermissionKey.agentsView]
    : []
  const instanceRungs = Object.fromEntries(
    Object.entries(instances).map(([id, permission]) => [id, permissionToRung(permission)])
  )
  return new CapabilitySet(
    new Set(expandLevelsToKeys({ [Area.agents]: agentsLevel }) as PermissionKeyType[]),
    {},
    'MEMBER',
    'full',
    undefined,
    undefined,
    undefined,
    instanceRungs,
    new Set(Object.keys(instances)),
    undefined,
    new Set(derived as PermissionKeyType[])
  )
}

/**
 * `Level.Full` is what `MEMBER_BASELINE_LEVELS[Area.agents]` seeds, so this is
 * the ordinary full-seat member. `Level.None` is the population the fix is FOR:
 * a restricted profile, or any worker seat (`agents` is absent from
 * `WORKER_AREAS`, so `SEAT_CEILINGS.worker` clamps it to None).
 */
function signedIn(agentsLevel: Level, instances: Record<string, ResourcePermission> = {}) {
  getSession.mockResolvedValue({
    user: { id: USER_ID, defaultOrganizationId: ORG_ID, isSuperAdmin: false },
  })
  getCapabilities.mockResolvedValue(capabilitiesWith(agentsLevel, instances))
}

/** The session row a continuation turn restores its agent from. */
function existingSession(agentId: string | null, type: 'kopilot' | 'builder' = 'kopilot') {
  getSessionById.mockResolvedValue({
    isErr: () => false,
    value: { messages: [], domainState: {}, modelId: null, agentId, type },
  })
}

function request(body: Record<string, unknown>) {
  return {
    json: async () => body,
    signal: new AbortController().signal,
    url: 'http://localhost/api/kopilot/stream',
  } as never
}

beforeEach(() => {
  getSession.mockReset()
  getCapabilities.mockReset()
  getCachedAgentById.mockReset().mockResolvedValue({ id: AGENT_ID, dmEnabled: true })
  getAllCachedAgents.mockReset().mockResolvedValue([{ id: AGENT_ID, slug: AGENT_SLUG }])
  getSessionById.mockReset()
  createSession.mockReset().mockResolvedValue({
    isErr: () => false,
    value: { id: SESSION_ID, type: 'kopilot', createdAt: new Date() },
  })
  runTurn.mockReset().mockResolvedValue(undefined)
  isAdminOrOwner.mockReset().mockResolvedValue(false)
  // Every feature on by default; individual tests close the ones they test.
  hasFeature.mockReset().mockResolvedValue(true)
})

describe('POST /api/kopilot/stream — new session binds body.agentId', () => {
  it('401s without a session', async () => {
    getSession.mockResolvedValue(null)
    const res = await POST(request({ message: 'hi', agentId: AGENT_ID }))
    expect(res.status).toBe(401)
    expect(createSession).not.toHaveBeenCalled()
  })

  it('lets an authorized member reach the agent', async () => {
    signedIn(Level.Full)
    const res = await POST(request({ message: 'hi', agentId: AGENT_ID }))
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toBe('text/event-stream')
    expect(createSession).toHaveBeenCalledTimes(1)
    expect(createSession.mock.calls[0]?.[0]).toMatchObject({ agentId: AGENT_ID })
    await res.text()
    expect(runTurn).toHaveBeenCalledTimes(1)
  })

  it('403s a member with the agents area shut — THE hole', async () => {
    // Before the fix this member got a full agent turn.
    signedIn(Level.None)
    const res = await POST(request({ message: 'hi', agentId: AGENT_ID }))
    expect(res.status).toBe(403)
    // Refused as plain HTTP, before the stream opens and before a session row
    // pointing at an unreachable agent is written.
    expect(res.headers.get('Content-Type')).not.toBe('text/event-stream')
    expect(createSession).not.toHaveBeenCalled()
    expect(runTurn).not.toHaveBeenCalled()
  })

  it('403s an unauthorized DM turn before the agent is ever read', async () => {
    // The DM path's only agent-side check was `dmEnabled` — an ORG-WIDE toggle.
    // The capability gate has to come first, or an unauthorized caller still
    // learns whether the agent exists and has DMs on.
    signedIn(Level.None)
    const res = await POST(
      request({ message: 'hi', agentId: AGENT_ID, triggerKind: 'dm', page: 'agents.dm' })
    )
    expect(res.status).toBe(403)
    expect(getCachedAgentById).not.toHaveBeenCalled()
    expect(createSession).not.toHaveBeenCalled()
  })

  it('403s an authorized member when the org has no agents feature', async () => {
    // The plan-AND every `permissionProcedure(agentsManage)` sibling runs. The
    // route's own FeatureKey.kopilot gate does not cover it.
    signedIn(Level.Full)
    hasFeature.mockImplementation(async (_org: string, key: string) => key !== FeatureKey.agents)
    const res = await POST(request({ message: 'hi', agentId: AGENT_ID }))
    expect(res.status).toBe(403)
    await expect(res.text()).resolves.toContain('plan')
    expect(createSession).not.toHaveBeenCalled()
  })

  it('still 403s on the kopilot feature gate ahead of everything', async () => {
    signedIn(Level.Full)
    hasFeature.mockImplementation(async (_org: string, key: string) => key !== FeatureKey.kopilot)
    const res = await POST(request({ message: 'hi', agentId: AGENT_ID }))
    expect(res.status).toBe(403)
    expect(getCapabilities).not.toHaveBeenCalled()
  })
})

describe('POST /api/kopilot/stream — continuation turns restore the agent from the session row', () => {
  it('refuses turn 2 on a session whose agent the caller cannot access', async () => {
    // THE subtle half. `body.agentId` is ignored on an existing session, so a
    // body-only check would let every turn after the first through — including
    // on a session hijacked (or legitimately created) before the caller's
    // profile was tightened.
    signedIn(Level.None)
    existingSession(AGENT_ID)
    const res = await POST(request({ message: 'again', sessionId: SESSION_ID }))
    // The stream is already open by the time the agent is known, so the refusal
    // uses the route's own SSE error shape rather than an HTTP status.
    expect(res.status).toBe(200)
    const body = await res.text()
    expect(body).toContain('turn-error')
    expect(body).toContain('forbidden')
    expect(runTurn).not.toHaveBeenCalled()
  })

  it('refuses a DM continuation before re-reading the agent', async () => {
    signedIn(Level.None)
    existingSession(AGENT_ID)
    const res = await POST(request({ message: 'again', sessionId: SESSION_ID, triggerKind: 'dm' }))
    const body = await res.text()
    expect(body).toContain('forbidden')
    expect(getCachedAgentById).not.toHaveBeenCalled()
    expect(runTurn).not.toHaveBeenCalled()
  })

  it('lets an authorized member continue an agent session', async () => {
    signedIn(Level.Full)
    existingSession(AGENT_ID)
    const res = await POST(request({ message: 'again', sessionId: SESSION_ID }))
    const body = await res.text()
    expect(body).not.toContain('forbidden')
    expect(runTurn).toHaveBeenCalledTimes(1)
  })

  it('ignores a stale body.agentId on a session that has no agent', async () => {
    // `agentId` is documented as ignored on existing sessions. A stale value
    // left on the client must not deny a plain-Kopilot turn it has no effect
    // on — which is why the pre-stream gate is scoped to new sessions.
    signedIn(Level.None)
    existingSession(null)
    const res = await POST(request({ message: 'again', sessionId: SESSION_ID, agentId: AGENT_ID }))
    expect(res.status).toBe(200)
    const body = await res.text()
    expect(body).not.toContain('forbidden')
    expect(runTurn).toHaveBeenCalledTimes(1)
  })
})

describe('POST /api/kopilot/stream — sessions with no agent in play', () => {
  it('runs a plain Kopilot session for a member with the agents area shut', async () => {
    // The gate must not leak onto master Kopilot: the `agents` area fronts the
    // agent feature, and plain Kopilot is the human alone.
    signedIn(Level.None)
    const res = await POST(request({ message: 'hi' }))
    expect(res.status).toBe(200)
    const body = await res.text()
    expect(body).not.toContain('forbidden')
    expect(createSession).toHaveBeenCalledTimes(1)
    expect(createSession.mock.calls[0]?.[0]).toMatchObject({ agentId: null })
    expect(runTurn).toHaveBeenCalledTimes(1)
    // No agent in play → the route reads no capabilities at all.
    expect(getCapabilities).not.toHaveBeenCalled()
  })

  it('runs a plain Kopilot session on an org with no agents feature', async () => {
    signedIn(Level.Full)
    hasFeature.mockImplementation(async (_org: string, key: string) => key !== FeatureKey.agents)
    const res = await POST(request({ message: 'hi' }))
    expect(res.status).toBe(200)
    await res.text()
    expect(runTurn).toHaveBeenCalledTimes(1)
  })

  it('continues an agent-less session without a capability read', async () => {
    signedIn(Level.None)
    existingSession(null)
    const res = await POST(request({ message: 'again', sessionId: SESSION_ID }))
    await res.text()
    expect(runTurn).toHaveBeenCalledTimes(1)
    expect(getCapabilities).not.toHaveBeenCalled()
  })
})

describe('POST /api/kopilot/stream — builder sessions', () => {
  it('lets an authorized member open a builder session', async () => {
    signedIn(Level.Full)
    const res = await POST(request({ message: 'build', agentId: AGENT_ID, sessionType: 'builder' }))
    expect(res.status).toBe(200)
    expect(createSession.mock.calls[0]?.[0]).toMatchObject({
      agentId: AGENT_ID,
      type: 'builder',
    })
    await res.text()
    expect(runTurn).toHaveBeenCalledTimes(1)
  })

  it('403s a builder session for a member with the agents area shut', async () => {
    // Deliberate: a builder session's agent is the SUBJECT OF EDITING, and
    // `view` is the floor for touching it at all (each authoring tool re-asserts
    // its own Edit/Full rung). The page hosting it is already capability-gated
    // client-side, so no legitimate session loses anything.
    signedIn(Level.None)
    const res = await POST(request({ message: 'build', agentId: AGENT_ID, sessionType: 'builder' }))
    expect(res.status).toBe(403)
    expect(createSession).not.toHaveBeenCalled()
  })

  it('refuses a builder CONTINUATION turn too', async () => {
    signedIn(Level.None)
    existingSession(AGENT_ID, 'builder')
    const res = await POST(request({ message: 'build', sessionId: SESSION_ID }))
    const body = await res.text()
    expect(body).toContain('forbidden')
    expect(runTurn).not.toHaveBeenCalled()
  })
})

describe('POST /api/kopilot/stream — the coarse rung is agents.view, not agents.manage', () => {
  it('a member at agents: Read may chat', async () => {
    // The re-point (permissions v2 item 4). Chatting is USING the agent; under
    // the old `agentsManage` gate this member — the ordinary read-only seat the
    // View rung was created for — got a 403.
    signedIn(Level.Read)
    const res = await POST(request({ message: 'hi', agentId: AGENT_ID }))
    expect(res.status).toBe(200)
    await res.text()
    expect(runTurn).toHaveBeenCalledTimes(1)
  })

  it('a member at agents: Edit may chat', async () => {
    signedIn(Level.Edit)
    const res = await POST(request({ message: 'hi', agentId: AGENT_ID }))
    expect(res.status).toBe(200)
    await res.text()
    expect(runTurn).toHaveBeenCalledTimes(1)
  })
})

describe('POST /api/kopilot/stream — per-agent instance access (plan 25 §4.2)', () => {
  const OTHER_AGENT_ID = 'agt_othercuid00000000000000'

  it('403s an agent restricted to `none` under an OPEN agents area', async () => {
    // The `exclude` regime: the member administers agents generally, and one
    // agent carries an explicit `none` row for them. The coarse rung passes, so
    // only the per-instance assert can refuse this.
    signedIn(Level.Full, { [AGENT_ID]: ResourcePermission.none })
    const res = await POST(request({ message: 'hi', agentId: AGENT_ID }))
    // The status code, not merely "it didn't run": `assertViewInstance` throws
    // `AuxxError`, and this route has no `auxxErrorMiddleware`. An uncaught
    // throw here is a 500 while still satisfying every `not.toHaveBeenCalled`.
    expect(res.status).toBe(403)
    expect(res.headers.get('Content-Type')).not.toBe('text/event-stream')
    expect(createSession).not.toHaveBeenCalled()
    expect(runTurn).not.toHaveBeenCalled()
  })

  it('lets the same member through to an agent they are NOT restricted from', async () => {
    signedIn(Level.Full, { [OTHER_AGENT_ID]: ResourcePermission.none })
    const res = await POST(request({ message: 'hi', agentId: AGENT_ID }))
    expect(res.status).toBe(200)
    await res.text()
    expect(runTurn).toHaveBeenCalledTimes(1)
  })

  it('a member at agents: None reaches exactly the ONE agent shared with them', async () => {
    // The `include` regime — an explicit instance row beats the closed area
    // floor (plan 25 §2), and the derived Read rung is what gets them past the
    // coarse gate to find out.
    signedIn(Level.None, { [AGENT_ID]: ResourcePermission.view })
    const res = await POST(request({ message: 'hi', agentId: AGENT_ID }))
    expect(res.status).toBe(200)
    await res.text()
    expect(runTurn).toHaveBeenCalledTimes(1)
  })

  it('and reaches nothing else', async () => {
    signedIn(Level.None, { [AGENT_ID]: ResourcePermission.view })
    getAllCachedAgents.mockResolvedValue([
      { id: AGENT_ID, slug: AGENT_SLUG },
      { id: OTHER_AGENT_ID, slug: 'other-agent' },
    ])
    const res = await POST(request({ message: 'hi', agentId: OTHER_AGENT_ID }))
    expect(res.status).toBe(403)
    expect(createSession).not.toHaveBeenCalled()
  })

  it('resolves a SLUG before asserting — a restricted agent stays restricted', async () => {
    // `agentId` arrives verbatim on the body and the agent detail page routes by
    // slug. `assertViewInstance('agent', 'escalation-lead')` finds no
    // `ResourceAccess` row (they key on `Agent.id`), falls back to the area
    // level — `Full` here — and hands the agent over. Only the resolve stops it.
    signedIn(Level.Full, { [AGENT_ID]: ResourcePermission.none })
    const res = await POST(request({ message: 'hi', agentId: AGENT_SLUG }))
    expect(res.status).toBe(403)
    expect(createSession).not.toHaveBeenCalled()
  })

  it('an agent id from another org is refused, not 500ed', async () => {
    // `resolveAgentId` throws `NotFoundError` — an `AuxxError` like any other,
    // and uncaught it would escape this handler as a 500. Collapsed into the
    // same denial as a restriction so the endpoint cannot be used to enumerate.
    signedIn(Level.Full)
    const res = await POST(request({ message: 'hi', agentId: 'agt_fromanotherorg0000000000' }))
    expect(res.status).toBe(403)
    expect(createSession).not.toHaveBeenCalled()
  })

  it('refuses a CONTINUATION turn on a restricted agent', async () => {
    // The half that matters after turn 1: `sessionAgentId` comes off the session
    // ROW, so a member restricted from an agent AFTER the session was opened
    // must lose it on the next send.
    signedIn(Level.Full, { [AGENT_ID]: ResourcePermission.none })
    existingSession(AGENT_ID)
    const res = await POST(request({ message: 'again', sessionId: SESSION_ID }))
    const body = await res.text()
    expect(body).toContain('turn-error')
    expect(body).toContain('forbidden')
    expect(runTurn).not.toHaveBeenCalled()
  })

  it('the plan gate still fires ahead of the instance check', async () => {
    // FeatureKey.agents is Layer 1 and outranks any Layer-2 grant: an org
    // without the feature gets the plan message even for an agent the member
    // holds an explicit `admin` row on.
    signedIn(Level.Full, { [AGENT_ID]: ResourcePermission.admin })
    hasFeature.mockImplementation(async (_org: string, key: string) => key !== FeatureKey.agents)
    const res = await POST(request({ message: 'hi', agentId: AGENT_ID }))
    expect(res.status).toBe(403)
    await expect(res.text()).resolves.toContain('plan')
    expect(getAllCachedAgents).not.toHaveBeenCalled()
    expect(createSession).not.toHaveBeenCalled()
  })

  it('an OWNER keeps every agent, restriction row or not', async () => {
    // §0.10 recovery guarantee — nothing authored on an agent can lock the last
    // owner out of the chat that would let them undo it.
    getSession.mockResolvedValue({
      user: { id: USER_ID, defaultOrganizationId: ORG_ID, isSuperAdmin: false },
    })
    getCapabilities.mockResolvedValue(
      new CapabilitySet(
        new Set(expandLevelsToKeys({ [Area.agents]: Level.Full }) as PermissionKeyType[]),
        {},
        'OWNER',
        'full',
        undefined,
        undefined,
        undefined,
        { [AGENT_ID]: ResourcePermission.none },
        new Set([AGENT_ID])
      )
    )
    const res = await POST(request({ message: 'hi', agentId: AGENT_ID }))
    expect(res.status).toBe(200)
    await res.text()
    expect(runTurn).toHaveBeenCalledTimes(1)
  })
})
