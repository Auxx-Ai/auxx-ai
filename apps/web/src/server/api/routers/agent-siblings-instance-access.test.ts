// apps/web/src/server/api/routers/agent-siblings-instance-access.test.ts

import { ResourcePermission } from '@auxx/database/enums'
import { Area, expandLevelsToKeys, Level, PermissionKey } from '@auxx/lib/permissions/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Plan 25 §4.2 at the router layer, for the FOUR sibling routers that hang off
 * the agent detail page — `agent-trigger`, `agent-procedure`, `agent-toolset`,
 * `agent-scope`. `agent.ts` itself is covered separately.
 *
 * Four things this file exists to pin, in order of how easy they are to break:
 *
 *  1. **Trigger writes are `admin`, not `edit`** (user decision 2026-07-28). A
 *     trigger makes the agent act autonomously on its OWN credentials with no
 *     invoker to intersect against, so `create`/`update`/`delete`/`runNow` sit
 *     on the same rung as `runAsUserId`. Everything else about an agent that a
 *     builder touches is `edit`, which makes this the one rung a future refactor
 *     would "tidy" downwards — hence an explicit `it.each` proving an **edit
 *     holder is denied on all four**.
 *  2. **The three formerly-bare `protectedProcedure`s now deny.**
 *     `agentTrigger.list`, `agentTrigger.listRuns` and `agentProcedure.list` read
 *     NO capabilities at HEAD~ — closing them is a real hole, not a re-tier.
 *  3. **Indirect agent resolution.** Four procedures are keyed on a TRIGGER id
 *     and two on a procedure LINK id. Instance access lives on the agent, so each
 *     must resolve the owning agent BEFORE asserting; a test per procedure points
 *     the resolver at a *different* agent and requires the denial to follow it.
 *  4. **`assertAgentAccess` keys on the resolved `Agent.id`, never a slug.**
 *     Every input here is nominally an id, but `assertAgentAccess` accepts either
 *     — and asserting on a slug finds no `ResourceAccess` row, falls through to
 *     the area level, and hands over a restricted agent.
 *
 * Behavioral, not source-text: the real router modules are imported and driven
 * through tRPC callers, `ctx.capabilities` is a **real** `CapabilitySet` (the
 * shipped assert methods), and `~/server/lib/agent-instance-access` is the real
 * module resolving against a mocked org agents cache. The `permissionProcedure`
 * stand-in runs the real `capabilities.assert(key)`, so the coarse rung is under
 * test too — `agentToolset.listTools` moving off `agentsManage` onto `agentsView`
 * is proven by a case below, not by reading the source.
 *
 * Deleting or weakening any assert makes a case here fail, because the mocked
 * services are the observed side effect.
 */

const {
  triggerService,
  agentsFixture,
  linkFixture,
  getCachedAgentById,
  onCacheEvent,
  enqueueAgentJob,
  createSession,
  getOrgToolCatalog,
  updateAgentToolset,
  batchUpdateAgentToolsets,
  upsertAgentScopeRow,
  removeAgentScopeRow,
  procedures,
  featureService,
} = vi.hoisted(() => {
  const AGENT_ID = 'agt_cuid00000000000000000000'
  /** Which agent the mocked resolvers claim owns the trigger / the link. */
  const triggerFixture: { agentId: string | null } = { agentId: AGENT_ID }
  const linkFixture: { agentId: string | null } = { agentId: AGENT_ID }
  const row = (agentId: string) => ({
    id: 'trg_cuid00000000000000000000',
    agentId,
    organizationId: 'org_cuid000000000000000000000',
    kind: 'scheduled',
    enabled: true,
    triggerType: null,
    entityDefinitionId: null,
    eventType: null,
    triggerAppId: null,
    triggerAppTriggerId: null,
    triggerInstallationId: null,
    triggerConnectionId: null,
    triggerWebhookEndpointId: null,
    triggerTopic: null,
    config: {},
    instructions: null,
    lastFiredAt: null,
    lastErrorAt: null,
    lastError: null,
    createdById: 'usr_cuid000000000000000000000',
    createdAt: new Date(0),
    updatedAt: new Date(0),
  })
  return {
    linkFixture,
    agentsFixture: triggerFixture,
    triggerService: {
      /**
       * `getTrigger` is the ONLY thing standing between a trigger id and the
       * agent the assert keys on. Reading `triggerFixture` (rather than a fixed
       * row) is what lets a test say "this trigger actually belongs to a
       * different agent" and require the denial to follow it.
       */
      getTrigger: vi.fn(async () => (triggerFixture.agentId ? row(triggerFixture.agentId) : null)),
      listForAgent: vi.fn(async () => []),
      createTrigger: vi.fn(async () => row(triggerFixture.agentId ?? AGENT_ID)),
      updateTrigger: vi.fn(async () => row(triggerFixture.agentId ?? AGENT_ID)),
      deleteTrigger: vi.fn(async () => undefined),
    },
    getCachedAgentById: vi.fn(async (_org: string, id: string) => ({
      id,
      userId: 'usr_agentbackinguser00000000',
      archivedAt: null,
      modelId: 'gpt-x',
    })),
    onCacheEvent: vi.fn(async () => undefined),
    enqueueAgentJob: vi.fn(async () => undefined),
    createSession: vi.fn(async () => ({ isErr: () => false, value: { id: 'ses_1' } })),
    getOrgToolCatalog: vi.fn(async () => []),
    updateAgentToolset: vi.fn(async () => undefined),
    batchUpdateAgentToolsets: vi.fn(async () => undefined),
    upsertAgentScopeRow: vi.fn(async () => undefined),
    removeAgentScopeRow: vi.fn(async () => undefined),
    procedures: {
      listAgentProcedures: vi.fn(async () => ({ isErr: () => false, value: [] })),
      listProcedures: vi.fn(async () => ({ isErr: () => false, value: [] })),
      createProcedure: vi.fn(async () => ({ isErr: () => false, value: { id: 'prc_1' } })),
      attachProcedure: vi.fn(async () => ({ isErr: () => false, value: { id: 'lnk_1' } })),
      updateAgentProcedure: vi.fn(async () => ({
        isErr: () => false,
        value: { id: 'lnk_1', agentId: AGENT_ID },
      })),
      detachProcedure: vi.fn(async () => ({ isErr: () => false, value: AGENT_ID })),
      reconcileAgentProcedureMentions: vi.fn(async () => undefined),
    },
    featureService: { requireAccess: vi.fn(async () => undefined) },
  }
})

vi.mock('@auxx/lib/agents', () => ({
  AgentTriggerService: class {
    getTrigger = triggerService.getTrigger
    listForAgent = triggerService.listForAgent
    createTrigger = triggerService.createTrigger
    updateTrigger = triggerService.updateTrigger
    deleteTrigger = triggerService.deleteTrigger
  },
  getOrgToolCatalog,
  updateAgentToolset,
  batchUpdateAgentToolsets,
  upsertAgentScopeRow,
  removeAgentScopeRow,
  isKnowledgeScopeRecordId: () => true,
  ScopeRowImmutableError: class ScopeRowImmutableError extends Error {},
}))

vi.mock('@auxx/lib/agents/procedures', () => procedures)
vi.mock('@auxx/lib/ai/agent-framework', () => ({ enqueueAgentJob }))
vi.mock('@auxx/services', () => ({ createSession }))

/**
 * `getAllCachedAgents` is what `resolveAgentId` reads, so the id↔slug pair here
 * IS the resolution under test. `getCachedAgentById` is `runNow`'s own lookup,
 * downstream of the assert.
 */
vi.mock('@auxx/lib/cache', () => ({
  getAllCachedAgents: vi.fn(async () => [
    { id: 'agt_cuid00000000000000000000', slug: 'support-bot', archivedAt: null },
    { id: 'agt_othercuid0000000000000', slug: 'other-bot', archivedAt: null },
  ]),
  getCachedAgentById,
  onCacheEvent,
}))

/**
 * `agent-trigger`'s `listRuns` and `agent-procedure`'s link resolver are the two
 * places these routers touch Drizzle directly. `database` backs the former;
 * `ctx.db` (see {@link fakeDb}) backs the latter.
 */
vi.mock('@auxx/database', () => ({
  database: {
    select: () => ({
      from: () => ({
        where: () => ({ orderBy: () => ({ limit: async () => [] }) }),
      }),
    }),
  },
  schema: {
    AiAgentSession: {
      id: 'AiAgentSession.id',
      title: 'AiAgentSession.title',
      type: 'AiAgentSession.type',
      createdAt: 'AiAgentSession.createdAt',
      updatedAt: 'AiAgentSession.updatedAt',
      triggerContext: 'AiAgentSession.triggerContext',
      organizationId: 'AiAgentSession.organizationId',
      agentTriggerId: 'AiAgentSession.agentTriggerId',
    },
    AgentProcedure: {
      id: 'AgentProcedure.id',
      agentId: 'AgentProcedure.agentId',
      organizationId: 'AgentProcedure.organizationId',
    },
  },
}))

vi.mock('drizzle-orm', () => ({
  and: (...parts: unknown[]) => ({ op: 'and', parts }),
  desc: (a: unknown) => ({ op: 'desc', a }),
  eq: (a: unknown, b: unknown) => ({ op: 'eq', a, b }),
  lt: (a: unknown, b: unknown) => ({ op: 'lt', a, b }),
}))

vi.mock('@auxx/logger', () => ({
  createScopedLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}))

// The `@auxx/lib/permissions` barrel reaches redis/db at import time and hangs
// under vitest — hand back the real registry plus a stub feature service (the
// `agentProcedures` beta plan gate is not what this file is about).
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
 * `capabilities.assert(key)` (see `workflow-instance-access.test.ts` for the
 * full rationale). `protectedProcedure` is kept as a bare procedure so that a
 * regression BACK to `protectedProcedure` on any of the three formerly-open
 * reads still runs the body — and fails the denial cases below on the missing
 * instance assert rather than passing for the wrong reason.
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
  }
})

// Deep path on purpose — the barrel hangs (see above).
const { CapabilitySet } = await import('@auxx/lib/permissions/capabilities/capability-set')
const { agentTriggerRouter } = await import('./agent-trigger')
const { agentProcedureRouter } = await import('./agent-procedure')
const { agentToolsetRouter } = await import('./agent-toolset')
const { agentScopeRouter } = await import('./agent-scope')

const ORG_ID = 'org_cuid000000000000000000000'
const USER_ID = 'usr_cuid000000000000000000000'
const AGENT_ID = 'agt_cuid00000000000000000000'
const AGENT_SLUG = 'support-bot'
const OTHER_AGENT_ID = 'agt_othercuid0000000000000'
const TRIGGER_ID = 'trg_cuid00000000000000000000'
const LINK_ID = 'lnk_cuid00000000000000000000'
const RECORD_ID = 'kb:kb_cuid0000000000000000000'

/** AuxxError, wrapped by tRPC as `cause` (the app's middleware maps it to 403). */
const FORBIDDEN = { cause: { name: 'ForbiddenError', statusCode: 403 } }

const AREA_LEVEL_OF: Record<ResourcePermission, Level> = {
  [ResourcePermission.none]: Level.None,
  [ResourcePermission.view]: Level.Read,
  [ResourcePermission.edit]: Level.Edit,
  [ResourcePermission.admin]: Level.Full,
}

/**
 * A real `CapabilitySet` for a MEMBER holding `permission` on {@link AGENT_ID}
 * via an explicit `ResourceAccess` instance row (what the share dialog writes).
 *
 * `areaPermission` defaults to `permission` so the coarse `agents` rungs stay
 * consistent with the instance row; pass it separately to exercise the two
 * independently (the restriction case: area `Full`, one agent at `none`).
 * `instances: {}` models an agent with NO row at all — the
 * `baselineAtCreate: false` fallback to the area level.
 */
function capabilitiesFor(
  permission: ResourcePermission,
  opts: {
    instances?: Record<string, ResourcePermission>
    areaPermission?: ResourcePermission
    role?: 'MEMBER' | 'OWNER'
  } = {}
) {
  const instances = opts.instances ?? { [AGENT_ID]: permission }
  // Reproduce `composeUserCapabilities`' derived Read rung: any ≥`view` agent row
  // synthesizes `agentsView`, so an `agents: None` grantee doesn't 403 at the
  // coarse front door before the instance assert gets a say.
  const derived = Object.values(instances).some((p) => p !== ResourcePermission.none)
    ? [PermissionKey.agentsView]
    : []
  return new CapabilitySet(
    new Set(
      expandLevelsToKeys({ [Area.agents]: AREA_LEVEL_OF[opts.areaPermission ?? permission] })
    ),
    {},
    opts.role ?? 'MEMBER',
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

/** Area `Full` everywhere EXCEPT {@link AGENT_ID}, which is restricted to `none`. */
const restricted = () =>
  capabilitiesFor(ResourcePermission.none, {
    areaPermission: ResourcePermission.admin,
    instances: { [AGENT_ID]: ResourcePermission.none },
  })

/**
 * Query-builder stand-in for `agent-procedure`'s link → agent resolution, which
 * reads `ctx.db` directly. Driven by {@link linkFixture} so a test can point the
 * link at a different agent (or at nothing, for the 404 case).
 */
function fakeDb() {
  return {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => (linkFixture.agentId ? [{ agentId: linkFixture.agentId }] : []),
        }),
      }),
    }),
  }
}

function ctxFor(capabilities: InstanceType<typeof CapabilitySet>) {
  return {
    db: fakeDb(),
    capabilities,
    headers: new Headers(),
    session: {
      organizationId: ORG_ID,
      userId: USER_ID,
      isSuperAdmin: false,
      user: { id: USER_ID, defaultOrganizationId: ORG_ID, email: 'a@b.c', name: 'A' },
    },
  } as never
}

const triggerCaller = (c: InstanceType<typeof CapabilitySet>) =>
  agentTriggerRouter.createCaller(ctxFor(c))
const procedureCaller = (c: InstanceType<typeof CapabilitySet>) =>
  agentProcedureRouter.createCaller(ctxFor(c))
const toolsetCaller = (c: InstanceType<typeof CapabilitySet>) =>
  agentToolsetRouter.createCaller(ctxFor(c))
const scopeCaller = (c: InstanceType<typeof CapabilitySet>) =>
  agentScopeRouter.createCaller(ctxFor(c))

type Caps = InstanceType<typeof CapabilitySet>

/** The three reads that were bare `protectedProcedure` at HEAD~. */
const FORMERLY_OPEN_READS = [
  [
    'agentTrigger.list',
    (c: Caps) => triggerCaller(c).list({ agentId: AGENT_ID }),
    () => triggerService.listForAgent,
  ],
  ['agentTrigger.listRuns', (c: Caps) => triggerCaller(c).listRuns({ id: TRIGGER_ID }), null],
  [
    'agentProcedure.list',
    (c: Caps) => procedureCaller(c).list({ agentId: AGENT_ID }),
    () => procedures.listAgentProcedures,
  ],
] as const

/** The four trigger writes — `admin`, deliberately not `edit`. */
const TRIGGER_WRITES = [
  [
    'create',
    (c: Caps) =>
      triggerCaller(c).create({
        agentId: AGENT_ID,
        trigger: { kind: 'mention' },
      }),
    () => triggerService.createTrigger,
  ],
  [
    'update',
    (c: Caps) => triggerCaller(c).update({ id: TRIGGER_ID, enabled: false }),
    () => triggerService.updateTrigger,
  ],
  [
    'delete',
    (c: Caps) => triggerCaller(c).delete({ id: TRIGGER_ID }),
    () => triggerService.deleteTrigger,
  ],
  ['runNow', (c: Caps) => triggerCaller(c).runNow({ id: TRIGGER_ID }), () => enqueueAgentJob],
] as const

/** Everything that is authoring surface, and therefore `edit`. */
const EDIT_WRITES = [
  [
    'agentProcedure.createAndAttach',
    (c: Caps) => procedureCaller(c).createAndAttach({ agentId: AGENT_ID, name: 'P' }),
    () => procedures.createProcedure,
  ],
  [
    'agentProcedure.attach',
    (c: Caps) => procedureCaller(c).attach({ agentId: AGENT_ID, procedureId: 'prc_1' }),
    () => procedures.attachProcedure,
  ],
  [
    'agentProcedure.update',
    (c: Caps) => procedureCaller(c).update({ id: LINK_ID, enabled: true }),
    () => procedures.updateAgentProcedure,
  ],
  [
    'agentProcedure.detach',
    (c: Caps) => procedureCaller(c).detach({ id: LINK_ID }),
    () => procedures.detachProcedure,
  ],
  [
    'agentToolset.update',
    (c: Caps) => toolsetCaller(c).update({ agentId: AGENT_ID, slug: 'auxx', enabled: true }),
    () => updateAgentToolset,
  ],
  [
    'agentToolset.batchUpdate',
    (c: Caps) =>
      toolsetCaller(c).batchUpdate({
        agentId: AGENT_ID,
        toolsets: [{ slug: 'auxx', enabled: true }],
      }),
    () => batchUpdateAgentToolsets,
  ],
  [
    'agentScope.upsertRow',
    (c: Caps) =>
      scopeCaller(c).upsertRow({ agentId: AGENT_ID, recordId: RECORD_ID, mode: 'include_one' }),
    () => upsertAgentScopeRow,
  ],
  [
    'agentScope.removeRow',
    (c: Caps) => scopeCaller(c).removeRow({ agentId: AGENT_ID, recordId: RECORD_ID }),
    () => removeAgentScopeRow,
  ],
] as const

const ALL_MOCKS = [
  ...Object.values(triggerService),
  ...Object.values(procedures),
  getCachedAgentById,
  onCacheEvent,
  enqueueAgentJob,
  createSession,
  getOrgToolCatalog,
  updateAgentToolset,
  batchUpdateAgentToolsets,
  upsertAgentScopeRow,
  removeAgentScopeRow,
  featureService.requireAccess,
]

beforeEach(() => {
  // `mockReset` on the two resolvers, not `mockClear`: a `mockResolvedValueOnce`
  // a test QUEUES but never consumes (an assert short-circuits ahead of it)
  // would otherwise survive into the next test and shift every subsequent
  // once-value by one.
  for (const fn of ALL_MOCKS) fn.mockClear()
  agentsFixture.agentId = AGENT_ID
  linkFixture.agentId = AGENT_ID
})

describe('the three formerly-bare `protectedProcedure` reads', () => {
  it.each(
    FORMERLY_OPEN_READS
  )('%s denies a member restricted from the agent', async (_name, call, mock) => {
    await expect(call(restricted())).rejects.toMatchObject(FORBIDDEN)
    if (mock) expect(mock()).not.toHaveBeenCalled()
  })

  it.each(FORMERLY_OPEN_READS)('%s succeeds at instance view', async (_name, call, mock) => {
    await expect(call(capabilitiesFor(ResourcePermission.view))).resolves.toBeDefined()
    if (mock) expect(mock()).toHaveBeenCalledTimes(1)
  })

  it.each(
    FORMERLY_OPEN_READS
  )('%s denies a member at agents: None with no grants', async (_n, call, mock) => {
    // No instance row anywhere ⇒ the `baselineAtCreate: false` fallback IS the
    // area level, and the coarse `agentsView` gate is shut too.
    await expect(
      call(capabilitiesFor(ResourcePermission.none, { instances: {} }))
    ).rejects.toMatchObject(FORBIDDEN)
    if (mock) expect(mock()).not.toHaveBeenCalled()
  })
})

describe('agent triggers are the ADMIN rung (user decision 2026-07-28)', () => {
  it.each(
    TRIGGER_WRITES
  )('%s is DENIED for an instance `edit` holder', async (_name, call, mock) => {
    // The tier decision. A trigger runs the agent autonomously on its own
    // credentials, so authoring one is publishing-grade, not authoring-grade.
    // If this ever relaxes to `edit`, it must be a deliberate user decision —
    // not a refactor that made four procedures look like their neighbours.
    await expect(call(capabilitiesFor(ResourcePermission.edit))).rejects.toMatchObject(FORBIDDEN)
    expect(mock()).not.toHaveBeenCalled()
  })

  it.each(TRIGGER_WRITES)('%s is denied at instance view', async (_name, call, mock) => {
    await expect(call(capabilitiesFor(ResourcePermission.view))).rejects.toMatchObject(FORBIDDEN)
    expect(mock()).not.toHaveBeenCalled()
  })

  it.each(TRIGGER_WRITES)('%s succeeds at instance admin', async (_name, call, mock) => {
    await expect(call(capabilitiesFor(ResourcePermission.admin))).resolves.toBeDefined()
    expect(mock()).toHaveBeenCalledTimes(1)
  })

  it.each(
    TRIGGER_WRITES
  )('%s is denied for an agent restricted to `none`', async (_n, call, mock) => {
    await expect(call(restricted())).rejects.toMatchObject(FORBIDDEN)
    expect(mock()).not.toHaveBeenCalled()
  })

  it('runNow never reaches the agent lookup, let alone the queue, at instance edit', async () => {
    await expect(
      triggerCaller(capabilitiesFor(ResourcePermission.edit)).runNow({ id: TRIGGER_ID })
    ).rejects.toMatchObject(FORBIDDEN)
    expect(getCachedAgentById).not.toHaveBeenCalled()
    expect(createSession).not.toHaveBeenCalled()
    expect(enqueueAgentJob).not.toHaveBeenCalled()
  })
})

describe('procedures / toolsets / knowledge scope are the EDIT rung', () => {
  it.each(EDIT_WRITES)('%s succeeds at instance edit', async (_name, call, mock) => {
    await call(capabilitiesFor(ResourcePermission.edit))
    expect(mock()).toHaveBeenCalledTimes(1)
  })

  it.each(EDIT_WRITES)('%s is denied at instance view', async (_name, call, mock) => {
    await expect(call(capabilitiesFor(ResourcePermission.view))).rejects.toMatchObject(FORBIDDEN)
    expect(mock()).not.toHaveBeenCalled()
  })

  it.each(EDIT_WRITES)('%s is denied for an agent restricted to `none`', async (_n, call, mock) => {
    await expect(call(restricted())).rejects.toMatchObject(FORBIDDEN)
    expect(mock()).not.toHaveBeenCalled()
  })
})

/**
 * Six procedures never see an agent id. Each resolves one — via the trigger row
 * or the `AgentProcedure` link — and the assert must key on THAT agent. Pointing
 * the resolver at an agent the caller is restricted from is the only way to
 * prove the resolution actually happens: a router that skipped it and asserted
 * on, say, `input.id` would pass every other case in this file.
 */
describe('procedures that resolve the agent INDIRECTLY', () => {
  /** admin on AGENT_ID, restricted from OTHER_AGENT_ID. */
  const adminHereRestrictedThere = () =>
    capabilitiesFor(ResourcePermission.admin, {
      areaPermission: ResourcePermission.admin,
      instances: {
        [AGENT_ID]: ResourcePermission.admin,
        [OTHER_AGENT_ID]: ResourcePermission.none,
      },
    })

  const TRIGGER_KEYED = [
    [
      'update',
      (c: Caps) => triggerCaller(c).update({ id: TRIGGER_ID, enabled: false }),
      () => triggerService.updateTrigger,
    ],
    [
      'delete',
      (c: Caps) => triggerCaller(c).delete({ id: TRIGGER_ID }),
      () => triggerService.deleteTrigger,
    ],
    ['runNow', (c: Caps) => triggerCaller(c).runNow({ id: TRIGGER_ID }), () => enqueueAgentJob],
    ['listRuns', (c: Caps) => triggerCaller(c).listRuns({ id: TRIGGER_ID }), null],
  ] as const

  it.each(
    TRIGGER_KEYED
  )('agentTrigger.%s keys on the trigger’s OWNING agent', async (_name, call, mock) => {
    agentsFixture.agentId = OTHER_AGENT_ID
    await expect(call(adminHereRestrictedThere())).rejects.toMatchObject(FORBIDDEN)
    if (mock) expect(mock()).not.toHaveBeenCalled()
  })

  it.each(
    TRIGGER_KEYED
  )('agentTrigger.%s 404s an unknown trigger before any capability decision', async (_n, call, mock) => {
    agentsFixture.agentId = null
    await expect(call(capabilitiesFor(ResourcePermission.admin))).rejects.toMatchObject({
      cause: undefined,
      code: 'NOT_FOUND',
    })
    if (mock) expect(mock()).not.toHaveBeenCalled()
  })

  const LINK_KEYED = [
    [
      'update',
      (c: Caps) => procedureCaller(c).update({ id: LINK_ID, enabled: true }),
      () => procedures.updateAgentProcedure,
    ],
    [
      'detach',
      (c: Caps) => procedureCaller(c).detach({ id: LINK_ID }),
      () => procedures.detachProcedure,
    ],
  ] as const

  it.each(LINK_KEYED)('agentProcedure.%s keys on the LINK’s agent', async (_name, call, mock) => {
    linkFixture.agentId = OTHER_AGENT_ID
    await expect(call(adminHereRestrictedThere())).rejects.toMatchObject(FORBIDDEN)
    expect(mock()).not.toHaveBeenCalled()
  })

  it.each(LINK_KEYED)('agentProcedure.%s 404s an unknown link', async (_n, call, mock) => {
    linkFixture.agentId = null
    await expect(call(capabilitiesFor(ResourcePermission.admin))).rejects.toMatchObject({
      cause: undefined,
      code: 'NOT_FOUND',
    })
    expect(mock()).not.toHaveBeenCalled()
  })

  it('agentProcedure.detach resolves BEFORE the delete, not from its return value', async () => {
    // `detachProcedure` hands back the removed link's agentId — far too late to
    // authorize anything. The resolve has to be its own read, ahead of the write.
    linkFixture.agentId = OTHER_AGENT_ID
    await expect(
      procedureCaller(adminHereRestrictedThere()).detach({ id: LINK_ID })
    ).rejects.toThrow()
    expect(procedures.detachProcedure).not.toHaveBeenCalled()
  })
})

describe('the assert keys on the resolved `Agent.id`, never the slug', () => {
  it('a slug belonging to a restricted agent is still denied', async () => {
    // The regression this guards: `assertViewInstance('agent', 'support-bot')`
    // finds no `ResourceAccess` row (rows are keyed on the id), falls through to
    // the area level — `admin` here — and hands over the restricted agent.
    await expect(triggerCaller(restricted()).list({ agentId: AGENT_SLUG })).rejects.toMatchObject(
      FORBIDDEN
    )
    expect(triggerService.listForAgent).not.toHaveBeenCalled()
  })

  it('a slug for an agent the member CAN view resolves to the id downstream', async () => {
    await triggerCaller(capabilitiesFor(ResourcePermission.view)).list({ agentId: AGENT_SLUG })
    expect(triggerService.listForAgent).toHaveBeenCalledWith(AGENT_ID, ORG_ID)
  })

  it('an agent from another org 404s rather than 403s', async () => {
    // `resolveAgentId` throws the lib-layer `NotFoundError`, which the app's
    // `auxxErrorMiddleware` maps to a 404. That middleware is not in this
    // harness (the `~/server/api/trpc` stand-in replaces it), so the assertion
    // is on the AuxxError carried as `cause` — same shape as {@link FORBIDDEN}.
    await expect(
      triggerCaller(capabilitiesFor(ResourcePermission.admin)).list({
        agentId: 'agt_foreign000000',
      })
    ).rejects.toMatchObject({ cause: { name: 'NotFoundError', statusCode: 404 } })
    expect(triggerService.listForAgent).not.toHaveBeenCalled()
  })
})

describe('agentToolset.listTools is coarse, on `agentsView`', () => {
  it('succeeds for a member at the agents Read rung', async () => {
    // It takes no agent id and returns the ORG's tool catalogue — so it stays
    // coarse. But an instance-`view` holder has to be able to render an agent's
    // enabled tools, so `agentsManage` was the #1346 bug: a read gated on the
    // authoring rung.
    await expect(
      toolsetCaller(capabilitiesFor(ResourcePermission.view, { instances: {} })).listTools()
    ).resolves.toBeDefined()
    expect(getOrgToolCatalog).toHaveBeenCalledTimes(1)
  })

  it('is refused for a member at agents: None', async () => {
    await expect(
      toolsetCaller(capabilitiesFor(ResourcePermission.none, { instances: {} })).listTools()
    ).rejects.toMatchObject(FORBIDDEN)
    expect(getOrgToolCatalog).not.toHaveBeenCalled()
  })
})

describe('`baselineAtCreate: false` — no row falls back to the AREA level', () => {
  const noRows = (areaPermission: ResourcePermission) =>
    capabilitiesFor(areaPermission, { areaPermission, instances: {} })

  it('area Read ⇒ the triggers tab renders, but nothing writes', async () => {
    await expect(
      triggerCaller(noRows(ResourcePermission.view)).list({ agentId: AGENT_ID })
    ).resolves.toBeDefined()
    await expect(
      scopeCaller(noRows(ResourcePermission.view)).removeRow({
        agentId: AGENT_ID,
        recordId: RECORD_ID,
      })
    ).rejects.toMatchObject(FORBIDDEN)
  })

  it('area Edit ⇒ toolsets/scope/procedures save, triggers still do not', async () => {
    await toolsetCaller(noRows(ResourcePermission.edit)).update({
      agentId: AGENT_ID,
      slug: 'auxx',
      enabled: true,
    })
    expect(updateAgentToolset).toHaveBeenCalledTimes(1)
    await expect(
      triggerCaller(noRows(ResourcePermission.edit)).delete({ id: TRIGGER_ID })
    ).rejects.toMatchObject(FORBIDDEN)
    expect(triggerService.deleteTrigger).not.toHaveBeenCalled()
  })

  it('area Full ⇒ triggers too, with no ResourceAccess row anywhere', async () => {
    await expect(
      triggerCaller(noRows(ResourcePermission.admin)).delete({ id: TRIGGER_ID })
    ).resolves.toBeDefined()
    expect(triggerService.deleteTrigger).toHaveBeenCalledTimes(1)
  })
})

describe('OWNER regression', () => {
  it('an owner short-circuits to admin on an agent restricted to `none`', async () => {
    // Nothing authored on an agent may lock the last owner out of the agent that
    // would let them undo it.
    const owner = capabilitiesFor(ResourcePermission.admin, {
      role: 'OWNER',
      instances: { [AGENT_ID]: ResourcePermission.none },
    })
    await expect(
      triggerCaller(owner).create({ agentId: AGENT_ID, trigger: { kind: 'dm' } })
    ).resolves.toBeDefined()
    expect(triggerService.createTrigger).toHaveBeenCalledTimes(1)
  })
})
