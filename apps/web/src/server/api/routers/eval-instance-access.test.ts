// apps/web/src/server/api/routers/eval-instance-access.test.ts

import type { ResourcePermission } from '@auxx/database/enums'
import { Area, expandLevelsToKeys, Level, PermissionKey } from '@auxx/lib/permissions/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Plan 25 §4.2 at the eval router — per-agent instance access over an agent's
 * simulations, suites and run history.
 *
 * The headline here is a **closed hole, not a re-tiering**: 11 of these
 * procedures were bare `protectedProcedure` and read no capabilities at all, so
 * any org member could list, open and diff any agent's eval cases, runs, traces
 * and credit spend. Every one of those 11 gets its own denial case below.
 *
 * The second thing this file exists to pin is **where the agent id comes from**.
 * Only 5 of the 19 procedures are handed an `agentId`; the rest arrive with an
 * eval-case id, a run id, or a suite-run id, and each has to resolve the owning
 * agent before it can assert. Those resolutions are the easy thing to get
 * subtly wrong (assert the wrong agent, or the *input* id, and the gate reads as
 * present while gating nothing), so each indirect path has a case that points
 * the fixture at a DIFFERENT agent and demands a 403.
 *
 * Behavioral, not source-text: the real router module is imported and driven
 * through a tRPC caller, `ctx.capabilities` is a **real** {@link CapabilitySet},
 * and `~/server/lib/agent-instance-access` is the REAL module (only the agents
 * cache underneath it is stubbed) so id-or-slug resolution is under test too.
 * The mocked `@auxx/lib/evals` functions are the observed side effect.
 */

const ORG_ID = 'org_cuid000000000000000000000'
const USER_ID = 'usr_cuid000000000000000000000'
const AGENT_ID = 'agt_cuid000000000000000000000'
const AGENT_SLUG = 'support-agent'
const OTHER_AGENT_ID = 'agt_othercuid00000000000000'
const CASE_ID = 'evc_cuid000000000000000000000'
const RUN_ID = 'evr_cuid000000000000000000000'
const SUITE_ID = 'evs_cuid000000000000000000000'
const BASELINE_SUITE_ID = 'evs_baseline0000000000000000'

/** A valid `SimulationConfig` — `parseCase` runs the REAL Zod schemas. */
const CONFIG = {
  openingMessage: 'hello',
  customerContext: null,
  channel: 'chat' as const,
  timeFrozenAt: null,
  maxCustomerTurns: 3,
  subject: { recordIds: [], identityVerified: false },
  startingFields: [],
  unmatchedToolPolicy: 'error' as const,
  connectorMocks: [],
}

/** `agentEvalAssertionsSchema` rejects empty lists, so cases need at least one. */
const ASSERTIONS = [
  { id: 'a1', type: 'terminal_outcome' as const, data: { outcome: 'finished' as const } },
]

const targetFor = (agentId: string) => ({
  kind: 'agent_simulation' as const,
  scope: 'agent' as const,
  agentId,
})

const { evals, startAgentSuiteRun, enqueueEvalRun, getAllCachedAgents, featureService, fixture } =
  vi.hoisted(() => {
    /**
     * Which agent each persisted row resolves to. Mutated per test — this is how
     * the indirect-resolution cases prove the router reads the ROW's agent
     * rather than echoing whatever id arrived on the input.
     */
    const fixture = {
      /** `EvalCase.agentId`; `null` exercises the `target`-is-source-of-truth fallback. */
      caseAgentId: null as string | null,
      /** `EvalCase.target` — the source of truth `caseAgentId()` falls back to. */
      caseTarget: null as unknown,
      /** `EvalRun.definitionSnapshot.case.target` — `null` models an unparseable snapshot. */
      runSnapshotTarget: null as unknown,
      /** `EvalSuiteRun.agentId` per suite id. `null` models a suite with no agent. */
      suiteAgents: {} as Record<string, string | null>,
      /** Rows `listEvalCasesByAgent` hands back (the `list` projection needs real Dates). */
      caseRows: [] as unknown[],
    }

    const okResult = <T>(value: T) => ({ isErr: () => false, value })

    return {
      fixture,
      featureService: { requireAccess: vi.fn(async () => undefined) },
      getAllCachedAgents: vi.fn(async () => [
        { id: AGENT_ID, slug: AGENT_SLUG },
        { id: OTHER_AGENT_ID, slug: 'other-agent' },
      ]),
      startAgentSuiteRun: vi.fn(async () =>
        okResult({ suiteRun: { id: SUITE_ID }, runIds: [RUN_ID], requestedCount: 1 })
      ),
      enqueueEvalRun: vi.fn(async () => undefined),
      evals: {
        getEvalCaseById: vi.fn(async () =>
          okResult({
            id: CASE_ID,
            name: 'Refund flow',
            agentId: fixture.caseAgentId,
            target: fixture.caseTarget,
            config: CONFIG,
            assertions: ASSERTIONS,
            suggestionId: null,
            createdAt: new Date('2026-01-01T00:00:00.000Z'),
            updatedAt: new Date('2026-01-01T00:00:00.000Z'),
          })
        ),
        listEvalCasesByAgent: vi.fn(async () => okResult(fixture.caseRows)),
        getLatestRunsByCaseIds: vi.fn(async () => okResult([])),
        createEvalCase: vi.fn(async () => okResult({ id: 'evc_new' })),
        updateEvalCase: vi.fn(async () => okResult({ id: CASE_ID })),
        deleteEvalCase: vi.fn(async () => okResult(undefined)),
        getEvalRun: vi.fn(async () =>
          okResult({
            id: RUN_ID,
            caseId: CASE_ID,
            status: 'passed',
            definitionSnapshot: { case: { target: fixture.runSnapshotTarget } },
          })
        ),
        listEvalRuns: vi.fn(async () => okResult([])),
        getEvalRunCredits: vi.fn(async () => okResult({ creditsUsed: 1, totalTokens: 2 })),
        deleteEvalRun: vi.fn(async () => okResult(undefined)),
        cancelEvalRun: vi.fn(async () => okResult({ status: 'cancelled' })),
        getEvalSuiteRun: vi.fn(async ({ suiteRunId }: { suiteRunId: string }) => {
          const agentId = fixture.suiteAgents[suiteRunId]
          if (agentId === undefined) return okResult(null)
          return okResult({
            id: suiteRunId,
            agentId,
            status: 'completed',
            runMode: 'pinned',
            createdAt: new Date('2026-01-01T00:00:00.000Z'),
          })
        }),
        listEvalSuiteRuns: vi.fn(async () => okResult([])),
        listSuiteChildRunSummaries: vi.fn(async () => okResult([])),
        compareSuiteRuns: vi.fn(async () => okResult({ counts: {}, entries: [] })),
        createQueuedEvalRun: vi.fn(async () => okResult({ id: RUN_ID })),
        failQueuedEvalRun: vi.fn(async () => undefined),
        prepareRunSnapshots: vi.fn(async () =>
          okResult({ definitionSnapshot: {}, runtimeSnapshot: { runMode: 'pinned' } })
        ),
        suggestAgentSimulations: vi.fn(async () => okResult({ suggestions: [] })),
        validateAgentToolMock: vi.fn(async () => ({ valid: true })),
        validateEvalCase: vi.fn(async () => ({ ok: true, issues: [] })),
      },
    }
  })

vi.mock('@auxx/lib/evals', () => ({ ...evals }))
vi.mock('@auxx/lib/evals/start-suite-run', () => ({ startAgentSuiteRun }))
vi.mock('@auxx/lib/evals/worker', () => ({ enqueueEvalRun }))

// `agent-instance-access.ts` itself is REAL — only the org agents cache beneath
// it is stubbed, so id-or-slug resolution and the 404-before-assert rule are
// both exercised for real.
vi.mock('@auxx/lib/cache', () => ({ getAllCachedAgents }))

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
 * `capabilities.assert(key)`. Kept in lockstep with `trpc.ts`; only the plan-AND
 * and the `getCapabilities` read are dropped, since ctx carries the set already.
 * So the coarse `agentsView` front door is under test alongside the per-instance
 * asserts in the bodies.
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

// Deep path on purpose — see the note in `segment-instance-access.test.ts`.
const { CapabilitySet } = await import('@auxx/lib/permissions/capabilities/capability-set')
const { evalRouter } = await import('./eval')

/** AuxxError, wrapped by tRPC as `cause` (the app's middleware maps it to 403). */
const FORBIDDEN = { cause: { name: 'ForbiddenError', statusCode: 403 } }

const AREA_LEVEL_OF: Record<ResourcePermission, Level> = {
  ['none']: Level.None,
  ['read']: Level.Read,
  ['edit']: Level.Edit,
  ['admin']: Level.Full,
}

/**
 * A real `CapabilitySet` for a MEMBER holding `permission` on {@link AGENT_ID}
 * via an explicit `ResourceAccess` instance row (what the share dialog writes).
 *
 * `areaPermission` defaults to `permission` so the coarse `agents` rungs stay
 * consistent with the instance row; pass it separately to exercise the two
 * independently (e.g. a member at area `Full` but restricted on one agent).
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
  // synthesizes `agentsView`, so an `agents: None` grantee is not 403'd at the
  // coarse front door before the per-instance assert can speak.
  const derived = Object.values(instances).some((p) => p !== 'none')
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

/** A member at area `Full` who is explicitly restricted from {@link AGENT_ID}. */
const restrictedFromAgent = () =>
  capabilitiesFor('none', {
    areaPermission: 'admin',
    instances: { [AGENT_ID]: 'none' },
  })

function caller(capabilities: InstanceType<typeof CapabilitySet>) {
  return evalRouter.createCaller({
    capabilities,
    headers: new Headers(),
    session: { organizationId: ORG_ID, userId: USER_ID, isSuperAdmin: false },
  } as never)
}

type Caller = ReturnType<typeof caller>

/**
 * The `view` tier — all 11 procedures that read no capabilities at all before
 * plan 25 §4.2. The third slot is the post-assert side effect, where there is
 * one; `getById` / `getRun` / `getSuiteRun` do their only load BEFORE the assert
 * (the row is what names the agent), so for those the rejection IS the observation.
 */
const VIEW_READS = [
  ['list', (c: Caller) => c.list({ agentId: AGENT_ID }), () => evals.listEvalCasesByAgent],
  ['getById', (c: Caller) => c.getById({ id: CASE_ID }), null],
  [
    'validateMock',
    (c: Caller) => c.validateMock({ agentId: AGENT_ID, toolName: 'get_order', output: {} }),
    () => evals.validateAgentToolMock,
  ],
  ['validate', (c: Caller) => c.validate({ id: CASE_ID }), () => evals.validateEvalCase],
  ['listRuns', (c: Caller) => c.listRuns({ caseId: CASE_ID }), () => evals.listEvalRuns],
  ['getRun', (c: Caller) => c.getRun({ runId: RUN_ID }), null],
  [
    'getRunCredits',
    (c: Caller) => c.getRunCredits({ runId: RUN_ID }),
    () => evals.getEvalRunCredits,
  ],
  ['getSuiteRun', (c: Caller) => c.getSuiteRun({ suiteRunId: SUITE_ID }), null],
  [
    'listSuiteRuns',
    (c: Caller) => c.listSuiteRuns({ agentId: AGENT_ID }),
    () => evals.listEvalSuiteRuns,
  ],
  [
    'listSuiteChildRuns',
    (c: Caller) => c.listSuiteChildRuns({ suiteRunId: SUITE_ID }),
    () => evals.listSuiteChildRunSummaries,
  ],
  [
    'compareSuiteRuns',
    (c: Caller) =>
      c.compareSuiteRuns({
        baselineSuiteRunId: BASELINE_SUITE_ID,
        candidateSuiteRunId: SUITE_ID,
      }),
    () => evals.compareSuiteRuns,
  ],
] as const

/** The `edit` tier — authoring cases, deleting runs, and spending credits. */
const EDIT_WRITES = [
  [
    'create',
    (c: Caller) =>
      c.create({
        name: 'New case',
        target: targetFor(AGENT_ID),
        config: CONFIG,
        assertions: ASSERTIONS,
      }),
    () => evals.createEvalCase,
  ],
  [
    'update',
    (c: Caller) => c.update({ id: CASE_ID, patch: { name: 'Renamed' } }),
    () => evals.updateEvalCase,
  ],
  ['delete', (c: Caller) => c.delete({ id: CASE_ID }), () => evals.deleteEvalCase],
  ['run', (c: Caller) => c.run({ id: CASE_ID }), () => evals.prepareRunSnapshots],
  ['runAll', (c: Caller) => c.runAll({ agentId: AGENT_ID }), () => startAgentSuiteRun],
  ['cancelRun', (c: Caller) => c.cancelRun({ runId: RUN_ID }), () => evals.cancelEvalRun],
  ['deleteRun', (c: Caller) => c.deleteRun({ runId: RUN_ID }), () => evals.deleteEvalRun],
  [
    'suggest',
    (c: Caller) => c.suggest({ agentId: AGENT_ID, procedureId: 'prc_1' }),
    () => evals.suggestAgentSimulations,
  ],
] as const

const ALL_MOCKS = [
  ...Object.values(evals),
  startAgentSuiteRun,
  enqueueEvalRun,
  getAllCachedAgents,
  featureService.requireAccess,
]

beforeEach(() => {
  // `mockReset` would drop the implementations set in `vi.hoisted`, so clear —
  // no test queues a `mockResolvedValueOnce` here; the `fixture` object is the
  // per-test lever instead, and it is fully reassigned below.
  for (const fn of ALL_MOCKS) fn.mockClear()
  fixture.caseAgentId = AGENT_ID
  fixture.caseTarget = targetFor(AGENT_ID)
  fixture.runSnapshotTarget = targetFor(AGENT_ID)
  fixture.suiteAgents = { [SUITE_ID]: AGENT_ID, [BASELINE_SUITE_ID]: AGENT_ID }
  fixture.caseRows = [
    {
      id: CASE_ID,
      name: 'Refund flow',
      target: targetFor(AGENT_ID),
      suggestionId: null,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    },
  ]
})

describe('eval router — the 11 formerly ungated reads now need `view` on the agent', () => {
  it.each(VIEW_READS)('%s is refused for an agent restricted to `none`', async (_n, call, mock) => {
    await expect(call(caller(restrictedFromAgent()))).rejects.toMatchObject(FORBIDDEN)
    if (mock) expect(mock()).not.toHaveBeenCalled()
  })

  it.each(VIEW_READS)('%s succeeds at instance view', async (_name, call, mock) => {
    await expect(call(caller(capabilitiesFor('read')))).resolves.toBeDefined()
    if (mock) expect(mock()).toHaveBeenCalledTimes(1)
  })

  it.each(VIEW_READS)('%s is refused for a member at agents: None', async (_n, call, mock) => {
    // No instance row anywhere — `baselineAtCreate: false` falls back to the area
    // level, and a closed area denies every agent including row-less ones.
    await expect(call(caller(capabilitiesFor('none', { instances: {} })))).rejects.toMatchObject(
      FORBIDDEN
    )
    if (mock) expect(mock()).not.toHaveBeenCalled()
  })
})

describe('eval router — the 8 writes need `edit`, not `view`', () => {
  it.each(EDIT_WRITES)('%s is refused at instance view', async (_name, call, mock) => {
    await expect(call(caller(capabilitiesFor('read')))).rejects.toMatchObject(FORBIDDEN)
    expect(mock()).not.toHaveBeenCalled()
  })

  it.each(EDIT_WRITES)('%s succeeds at instance edit', async (_name, call, mock) => {
    await expect(call(caller(capabilitiesFor('edit')))).resolves.toBeDefined()
    expect(mock()).toHaveBeenCalledTimes(1)
  })

  it('run and runAll really are `edit` — a viewer cannot spend org credits', async () => {
    // These two are the only procedures on this router that cost money. The user
    // accepted that an instance EDITOR may spend it; a viewer may not, and a
    // stray `tier: 'read'` on either would be invisible without this.
    const viewer = caller(capabilitiesFor('read'))
    await expect(viewer.run({ id: CASE_ID })).rejects.toMatchObject(FORBIDDEN)
    await expect(viewer.runAll({ agentId: AGENT_ID })).rejects.toMatchObject(FORBIDDEN)
    expect(evals.createQueuedEvalRun).not.toHaveBeenCalled()
    expect(enqueueEvalRun).not.toHaveBeenCalled()
    expect(startAgentSuiteRun).not.toHaveBeenCalled()
  })
})

/**
 * The part that is easy to fake and hard to get right: 14 of the 19 procedures
 * never receive an `agentId`. Each case below points the persisted row at
 * {@link OTHER_AGENT_ID} while the caller administers {@link AGENT_ID}, so a
 * router that asserted on the input id — or on the wrong row — would pass.
 */
describe('eval router — the agent id is resolved from the ROW, not the input', () => {
  /** Administers AGENT_ID, explicitly restricted from OTHER_AGENT_ID. */
  const adminHereNotThere = () =>
    capabilitiesFor('admin', {
      areaPermission: 'admin',
      instances: {
        [AGENT_ID]: 'admin',
        [OTHER_AGENT_ID]: 'none',
      },
    })

  it('getById keys on the CASE’s agent', async () => {
    fixture.caseAgentId = OTHER_AGENT_ID
    await expect(caller(adminHereNotThere()).getById({ id: CASE_ID })).rejects.toMatchObject(
      FORBIDDEN
    )
  })

  it('validate keys on the CASE’s agent', async () => {
    fixture.caseAgentId = OTHER_AGENT_ID
    await expect(caller(adminHereNotThere()).validate({ id: CASE_ID })).rejects.toMatchObject(
      FORBIDDEN
    )
    expect(evals.validateEvalCase).not.toHaveBeenCalled()
  })

  it('listRuns keys on the case behind the caseId, not the caseId itself', async () => {
    fixture.caseAgentId = OTHER_AGENT_ID
    await expect(caller(adminHereNotThere()).listRuns({ caseId: CASE_ID })).rejects.toMatchObject(
      FORBIDDEN
    )
    expect(evals.listEvalRuns).not.toHaveBeenCalled()
  })

  it('a case with a null agentId column falls back to `target.agentId`', async () => {
    // `EvalCase.agentId` is a denormalized copy; `target` is the source of truth.
    // A row the column is null on must still be judged, never served ungated.
    fixture.caseAgentId = null
    fixture.caseTarget = targetFor(OTHER_AGENT_ID)
    await expect(caller(adminHereNotThere()).getById({ id: CASE_ID })).rejects.toMatchObject(
      FORBIDDEN
    )

    // …and the fallback is a real read, not a rubber stamp: the same row with the
    // target pointing back at the caller's agent must go through.
    fixture.caseTarget = targetFor(AGENT_ID)
    await expect(caller(adminHereNotThere()).getById({ id: CASE_ID })).resolves.toBeDefined()
  })

  it('a case with neither an agentId nor a parseable target 404s', async () => {
    // Nothing names an agent, so nothing can judge the row — it must not be
    // served, and it must not resolve to some other identifier that happens to
    // be lying around (the case id, say).
    fixture.caseAgentId = null
    fixture.caseTarget = { nonsense: true }
    await expect(caller(capabilitiesFor('admin')).getById({ id: CASE_ID })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    })
  })

  it.each([
    ['getRun', (c: Caller) => c.getRun({ runId: RUN_ID }), null],
    [
      'getRunCredits',
      (c: Caller) => c.getRunCredits({ runId: RUN_ID }),
      () => evals.getEvalRunCredits,
    ],
    ['cancelRun', (c: Caller) => c.cancelRun({ runId: RUN_ID }), () => evals.cancelEvalRun],
    ['deleteRun', (c: Caller) => c.deleteRun({ runId: RUN_ID }), () => evals.deleteEvalRun],
  ] as const)('%s keys on the run’s SNAPSHOT agent', async (_n, call, mock) => {
    // `EvalRun.caseId` is ON DELETE SET NULL, so the immutable
    // `definitionSnapshot.case.target.agentId` — not the case — is the only
    // durable owner. Point it elsewhere and the run must become unreachable.
    fixture.runSnapshotTarget = targetFor(OTHER_AGENT_ID)
    await expect(call(caller(adminHereNotThere()))).rejects.toMatchObject(FORBIDDEN)
    if (mock) expect(mock()).not.toHaveBeenCalled()
  })

  it('a run with an unparseable snapshot 404s instead of reading as ungated', async () => {
    fixture.runSnapshotTarget = { nonsense: true }
    await expect(caller(capabilitiesFor('admin')).getRun({ runId: RUN_ID })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    })
  })

  it.each([
    ['getSuiteRun', (c: Caller) => c.getSuiteRun({ suiteRunId: SUITE_ID }), null],
    [
      'listSuiteChildRuns',
      (c: Caller) => c.listSuiteChildRuns({ suiteRunId: SUITE_ID }),
      () => evals.listSuiteChildRunSummaries,
    ],
  ] as const)('%s keys on the SUITE’s agent', async (_n, call, mock) => {
    fixture.suiteAgents[SUITE_ID] = OTHER_AGENT_ID
    await expect(call(caller(adminHereNotThere()))).rejects.toMatchObject(FORBIDDEN)
    if (mock) expect(mock()).not.toHaveBeenCalled()
  })

  it('a suite with no agentId 404s instead of reading as ungated', async () => {
    // `EvalSuiteRun.agentId` is nullable and FK-less (suite history outlives
    // deleted agents), so "no agent" is unjudgeable and must not be served.
    fixture.suiteAgents[SUITE_ID] = null
    await expect(
      caller(capabilitiesFor('admin')).getSuiteRun({ suiteRunId: SUITE_ID })
    ).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })

  it('compareSuiteRuns asserts BOTH sides, not just the candidate', async () => {
    // It accepts any two suite ids, including ones belonging to different
    // agents, so gating only the candidate would leak the baseline's verdicts.
    fixture.suiteAgents[BASELINE_SUITE_ID] = OTHER_AGENT_ID
    await expect(
      caller(adminHereNotThere()).compareSuiteRuns({
        baselineSuiteRunId: BASELINE_SUITE_ID,
        candidateSuiteRunId: SUITE_ID,
      })
    ).rejects.toMatchObject(FORBIDDEN)
    expect(evals.compareSuiteRuns).not.toHaveBeenCalled()
  })

  it('compareSuiteRuns is also refused when only the CANDIDATE is restricted', async () => {
    fixture.suiteAgents[SUITE_ID] = OTHER_AGENT_ID
    await expect(
      caller(adminHereNotThere()).compareSuiteRuns({
        baselineSuiteRunId: BASELINE_SUITE_ID,
        candidateSuiteRunId: SUITE_ID,
      })
    ).rejects.toMatchObject(FORBIDDEN)
    expect(evals.compareSuiteRuns).not.toHaveBeenCalled()
  })

  it('create keys on `target.agentId` — authoring onto an agent edits it', async () => {
    await expect(
      caller(adminHereNotThere()).create({
        name: 'Sneaky',
        target: targetFor(OTHER_AGENT_ID),
        config: CONFIG,
        assertions: ASSERTIONS,
      })
    ).rejects.toMatchObject(FORBIDDEN)
    expect(evals.createEvalCase).not.toHaveBeenCalled()
  })

  it('update RE-TARGETING a case onto another agent needs edit on that agent too', async () => {
    // Otherwise `edit` on a agent you control is enough to plant a case on one
    // you do not.
    await expect(
      caller(adminHereNotThere()).update({
        id: CASE_ID,
        patch: { target: targetFor(OTHER_AGENT_ID) },
      })
    ).rejects.toMatchObject(FORBIDDEN)
    expect(evals.updateEvalCase).not.toHaveBeenCalled()
  })
})

describe('eval router — id-or-slug resolution', () => {
  it('list accepts the agent SLUG and passes the resolved Agent.id downstream', async () => {
    // `EvalCase.agentId` stores `Agent.id`, so a slug forwarded verbatim would
    // have listed nothing — and `assertViewInstance` keyed on a slug finds no
    // ResourceAccess row and silently falls through to the area level.
    await expect(
      caller(capabilitiesFor('read')).list({ agentId: AGENT_SLUG })
    ).resolves.toBeDefined()
    expect(evals.listEvalCasesByAgent).toHaveBeenCalledWith(
      expect.objectContaining({ agentId: AGENT_ID })
    )
  })

  it('the slug is judged by the resolved id’s grant, not by falling through', async () => {
    await expect(caller(restrictedFromAgent()).list({ agentId: AGENT_SLUG })).rejects.toMatchObject(
      FORBIDDEN
    )
    expect(evals.listEvalCasesByAgent).not.toHaveBeenCalled()
  })

  it('runAll and suggest also forward the resolved id', async () => {
    const editor = caller(capabilitiesFor('edit'))
    await editor.runAll({ agentId: AGENT_SLUG })
    await editor.suggest({ agentId: AGENT_SLUG, procedureId: 'prc_1' })
    expect(startAgentSuiteRun).toHaveBeenCalledWith(expect.objectContaining({ agentId: AGENT_ID }))
    expect(evals.suggestAgentSimulations).toHaveBeenCalledWith(
      expect.objectContaining({ agentId: AGENT_ID })
    )
  })

  it('create persists the RESOLVED id in the target', async () => {
    await caller(capabilitiesFor('edit')).create({
      name: 'New case',
      target: targetFor(AGENT_SLUG),
      config: CONFIG,
      assertions: ASSERTIONS,
    })
    expect(evals.createEvalCase).toHaveBeenCalledWith(
      expect.objectContaining({ target: expect.objectContaining({ agentId: AGENT_ID }) })
    )
  })

  it('an agent id from another org 404s before any capability decision', async () => {
    await expect(
      caller(capabilitiesFor('admin')).list({ agentId: 'agt_fromanotherorg' })
    ).rejects.toMatchObject({ cause: { name: 'NotFoundError', statusCode: 404 } })
    expect(evals.listEvalCasesByAgent).not.toHaveBeenCalled()
  })
})

describe('eval router — an `agents: None` member with one explicit grant', () => {
  /** The whole point of instance access: no area level, one shared agent. */
  const grantOnly = (permission: ResourcePermission) =>
    capabilitiesFor(permission, {
      areaPermission: 'none',
      instances: { [AGENT_ID]: permission },
    })

  it('an `admin` grant reaches that agent’s evals, reads and writes', async () => {
    const c = caller(grantOnly('admin'))
    await expect(c.list({ agentId: AGENT_ID })).resolves.toBeDefined()
    await expect(c.getById({ id: CASE_ID })).resolves.toBeDefined()
    await expect(c.listSuiteChildRuns({ suiteRunId: SUITE_ID })).resolves.toBeDefined()
    await expect(c.run({ id: CASE_ID })).resolves.toBeDefined()
    await expect(c.delete({ id: CASE_ID })).resolves.toBeDefined()
  })

  it('a `view` grant reads but does not write', async () => {
    const c = caller(grantOnly('read'))
    await expect(c.getById({ id: CASE_ID })).resolves.toBeDefined()
    await expect(c.delete({ id: CASE_ID })).rejects.toMatchObject(FORBIDDEN)
    expect(evals.deleteEvalCase).not.toHaveBeenCalled()
  })

  it('the grant does NOT reach a different agent', async () => {
    // The derived `agentsView` front door says only "this member has some agent
    // access" — never which agent. A body that stopped at the coarse rung would
    // hand over every other agent's history.
    fixture.suiteAgents[SUITE_ID] = OTHER_AGENT_ID
    await expect(
      caller(grantOnly('admin')).getSuiteRun({ suiteRunId: SUITE_ID })
    ).rejects.toMatchObject(FORBIDDEN)
  })
})

describe('eval router — `baselineAtCreate: false`: no row falls back to the AREA', () => {
  /** A member with NO instance rows at all — nothing is in `governingInstanceIds`. */
  const noRows = (areaPermission: ResourcePermission) =>
    capabilitiesFor(areaPermission, { areaPermission, instances: {} })

  it('area Read ⇒ the suites list and open, but nothing runs or saves', async () => {
    const c = caller(noRows('read'))
    await expect(c.list({ agentId: AGENT_ID })).resolves.toBeDefined()
    await expect(c.getRun({ runId: RUN_ID })).resolves.toBeDefined()
    await expect(c.run({ id: CASE_ID })).rejects.toMatchObject(FORBIDDEN)
    await expect(c.update({ id: CASE_ID, patch: { name: 'x' } })).rejects.toMatchObject(FORBIDDEN)
  })

  it('area Edit ⇒ authors and runs, with no ResourceAccess row anywhere', async () => {
    const c = caller(noRows('edit'))
    await expect(c.update({ id: CASE_ID, patch: { name: 'x' } })).resolves.toBeDefined()
    await expect(c.runAll({ agentId: AGENT_ID })).resolves.toBeDefined()
  })

  it('area None ⇒ nothing, even though the agent is org-shared', async () => {
    await expect(caller(noRows('none')).getById({ id: CASE_ID })).rejects.toMatchObject(FORBIDDEN)
  })
})

describe('eval router — OWNER regression', () => {
  it('short-circuits to admin on an agent restricted to `none`', async () => {
    // The recovery guarantee: nothing authored on an agent can lock the last
    // owner out of it.
    const owner = capabilitiesFor('admin', {
      role: 'OWNER',
      instances: { [AGENT_ID]: 'none' },
    })
    await expect(caller(owner).getById({ id: CASE_ID })).resolves.toBeDefined()
    await expect(caller(owner).delete({ id: CASE_ID })).resolves.toBeDefined()
    expect(evals.deleteEvalCase).toHaveBeenCalledTimes(1)
  })
})
