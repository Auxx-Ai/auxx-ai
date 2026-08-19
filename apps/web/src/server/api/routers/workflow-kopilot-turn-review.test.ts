// apps/web/src/server/api/routers/workflow-kopilot-turn-review.test.ts

import { Area, expandLevelsToKeys, Level, PermissionKey } from '@auxx/lib/permissions/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * `workflow.getKopilotTurnReview` + `revertKopilotTurn` + `keepKopilotTurn` — plan 20
 * phase D (`plans/kopilot/workflow/20-partial-turn-survival.md` §5, §9).
 *
 * The claims under test:
 *
 *  - the OFFER is derived from the surviving pre-turn snapshot, not from a
 *    `turnId` plumbed through SSE (there is none), and it is withheld while the
 *    turn that owns the snapshot still holds the draft lock;
 *  - the offer reads at instance `view`, but TAKING it is instance `edit` — a
 *    viewer cannot revert a workflow they can only look at;
 *  - `revertWorkflowTurn`'s three outcomes each reach the client intact.
 *    **[C3]** in the plan: the 404 ("that turn's snapshot is gone") and the 409
 *    ("the canvas moved on") are distinct statements the card has to be able to
 *    show, so the router must NOT flatten either into a 500. Under this file's
 *    `~/server/api/trpc` stub there is no `auxxErrorMiddleware`, so the AuxxError
 *    arrives on `.cause` — which is exactly what the real middleware maps.
 *
 * Behavioural: the real router runs through a tRPC caller with a REAL
 * `CapabilitySet`; only the graph-edit seam and the row lookup are faked.
 */

const { graphEdit, guards, featureService, appRows } = vi.hoisted(() => ({
  /** Rows `db.select()...limit(1)` hands back — empty models "not in this org". */
  appRows: {
    value: [{ id: 'wf_cuid0000000000000000000', draftNodeCount: 9 }] as Record<string, unknown>[],
  },
  graphEdit: {
    finalizeWorkflowTurn: vi.fn(async () => undefined),
    readWorkflowTurnLock: vi.fn(async () => null as { turnId: string } | null),
    readWorkflowTurnSnapshot: vi.fn(async () => null as Record<string, unknown> | null),
    revertWorkflowTurn: vi.fn(async () => ({ isErr: () => false, value: { graphHash: 'h' } })),
  },
  guards: { app: vi.fn(async () => undefined) },
  featureService: { requireAccess: vi.fn(async () => undefined) },
}))

vi.mock('@auxx/lib/workflows/graph-edit', () => graphEdit)

// Real drizzle columns come back undefined under vitest — the org predicate is
// exercised through the rows the fake query builder returns, not generated SQL.
vi.mock('@auxx/database', async () =>
  (await import('~/test/database-mock')).mockAuxxDatabase({
    schema: {
      WorkflowApp: {
        id: 'WorkflowApp.id',
        organizationId: 'WorkflowApp.organizationId',
        draftWorkflowId: 'WorkflowApp.draftWorkflowId',
      },
      Workflow: { id: 'Workflow.id', graph: 'Workflow.graph' },
    },
  })
)

vi.mock('@auxx/lib/workflows', () => ({
  WorkflowService: class {
    test = vi.fn(async () => ({ success: true }))
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
vi.mock('@auxx/services/workflow-templates', () => ({
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
    isAuxxError: (error: unknown) => error instanceof Error,
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
const { ConflictError, NotFoundError } = await import('@auxx/lib/errors')
const { workflowRouter } = await import('./workflow')

const ORG_ID = 'org_cuid000000000000000000000'
const USER_ID = 'usr_cuid000000000000000000000'
const WF_ID = 'wf_cuid0000000000000000000'
const TURN_ID = 'turn_cuid00000000000000000'
const CAPTURED_AT = 1_755_000_000_000

/** AuxxError, wrapped by tRPC as `cause` (the app's middleware maps it to a status). */
const FORBIDDEN = { cause: { name: 'ForbiddenError', statusCode: 403 } }

/**
 * The four `Rung` values `instanceAccess` actually holds. NOT
 * `ResourcePermission` — that vocabulary's read rung is `view`, which is not a
 * `Rung` at all, so `satisfiesRung` would silently answer false and every
 * "succeeds at view" assertion would pass for the wrong reason.
 */
type Grant = 'none' | 'read' | 'edit' | 'admin'

const AREA_LEVEL_OF: Record<Grant, Level> = {
  none: Level.None,
  read: Level.Read,
  edit: Level.Edit,
  admin: Level.Full,
}

function capabilitiesFor(
  permission: Grant,
  opts: { instances?: Record<string, Grant>; areaPermission?: Grant } = {}
) {
  const instances = opts.instances ?? { [WF_ID]: permission }
  const derived = Object.values(instances).some((p) => p !== 'none')
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

/** `db.select().from().leftJoin().where().limit()` — resolves to {@link appRows}. */
function fakeDb() {
  const chain: Record<string, unknown> = {}
  chain.select = () => chain
  chain.from = () => chain
  chain.leftJoin = () => chain
  chain.innerJoin = () => chain
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

/** A surviving pre-turn snapshot: 6 nodes before the turn, 9 on the draft now. */
function snapshot(overrides: Record<string, unknown> = {}) {
  return {
    turnId: TURN_ID,
    name: 'Order triage',
    description: null,
    graph: { nodes: [1, 2, 3, 4, 5, 6].map((n) => ({ id: `n${n}` })), edges: [] },
    triggerType: 'manual',
    capturedAt: CAPTURED_AT,
    postTurnGraphHash: 'post-hash',
    /** Stamped at turn end by the capability — why the offer exists at all. */
    endedAs: 'exhausted',
    ...overrides,
  }
}

beforeEach(() => {
  graphEdit.finalizeWorkflowTurn.mockReset().mockResolvedValue(undefined)
  graphEdit.readWorkflowTurnLock.mockReset().mockResolvedValue(null)
  graphEdit.readWorkflowTurnSnapshot.mockReset().mockResolvedValue(null)
  graphEdit.revertWorkflowTurn
    .mockReset()
    .mockResolvedValue({ isErr: () => false, value: { graphHash: 'h' } })
  guards.app.mockClear().mockResolvedValue(undefined)
  appRows.value = [{ id: WF_ID, draftNodeCount: 9 }]
})

describe('workflow.getKopilotTurnReview', () => {
  it('returns null when no snapshot survived — the common case, and it costs no query', async () => {
    await expect(
      caller(capabilitiesFor('read')).getKopilotTurnReview({
        workflowAppId: WF_ID,
      })
    ).resolves.toBeNull()
    // The snapshot's ABSENCE is the whole answer: no row lookup should follow.
    expect(graphEdit.readWorkflowTurnLock).not.toHaveBeenCalled()
  })

  it('returns the offer, with the node counts an undo would move between', async () => {
    graphEdit.readWorkflowTurnSnapshot.mockResolvedValue(snapshot())
    await expect(
      caller(capabilitiesFor('read')).getKopilotTurnReview({
        workflowAppId: WF_ID,
      })
    ).resolves.toEqual({
      turnId: TURN_ID,
      capturedAt: CAPTURED_AT,
      preTurnNodeCount: 6,
      currentNodeCount: 9,
      endedAs: 'exhausted',
    })
  })

  it.each([
    'exhausted',
    'aborted',
    'error',
  ] as const)('passes the turn’s %s ending through — the banner’s wording is derived from it', async (endedAs) => {
    graphEdit.readWorkflowTurnSnapshot.mockResolvedValue(snapshot({ endedAs }))
    await expect(
      caller(capabilitiesFor('read')).getKopilotTurnReview({
        workflowAppId: WF_ID,
      })
    ).resolves.toMatchObject({ endedAs })
  })

  it('FAILS OPEN on an unlabelled snapshot — no ending, but still an offer', async () => {
    // A snapshot captured before the field existed, a turn that died before its
    // turn-end hook ran, or a stamp whose Redis write failed. Losing the
    // adjective is a far smaller loss than losing the Undo, so the offer stands
    // in full and only `endedAs` goes null.
    const { endedAs: _dropped, ...unlabelled } = snapshot()
    graphEdit.readWorkflowTurnSnapshot.mockResolvedValue(unlabelled)
    await expect(
      caller(capabilitiesFor('read')).getKopilotTurnReview({
        workflowAppId: WF_ID,
      })
    ).resolves.toEqual({
      turnId: TURN_ID,
      capturedAt: CAPTURED_AT,
      preTurnNodeCount: 6,
      currentNodeCount: 9,
      endedAs: null,
    })
  })

  it('reads the CURRENT snapshot, unfiltered by turn — nothing plumbs a turnId to the client', async () => {
    graphEdit.readWorkflowTurnSnapshot.mockResolvedValue(snapshot())
    await caller(capabilitiesFor('read')).getKopilotTurnReview({
      workflowAppId: WF_ID,
    })
    // Second arg withheld on purpose: `readWorkflowTurnSnapshot(id, turnId)`
    // would answer null for every turn the caller cannot name, and the SSE
    // stream never carries one.
    expect(graphEdit.readWorkflowTurnSnapshot).toHaveBeenCalledWith(WF_ID)
  })

  it('withholds the offer while the snapshot’s own turn still holds the draft', async () => {
    // Mid-turn the snapshot exists and is live fuel — offering an undo there
    // would let the user roll back underneath a running agent.
    graphEdit.readWorkflowTurnSnapshot.mockResolvedValue(snapshot())
    graphEdit.readWorkflowTurnLock.mockResolvedValue({ turnId: TURN_ID })
    await expect(
      caller(capabilitiesFor('read')).getKopilotTurnReview({
        workflowAppId: WF_ID,
      })
    ).resolves.toBeNull()
  })

  it('still offers when a DIFFERENT turn holds the lock — that turn superseded nothing yet', async () => {
    graphEdit.readWorkflowTurnSnapshot.mockResolvedValue(snapshot())
    graphEdit.readWorkflowTurnLock.mockResolvedValue({ turnId: 'turn_someothernewerturn00' })
    await expect(
      caller(capabilitiesFor('read')).getKopilotTurnReview({
        workflowAppId: WF_ID,
      })
    ).resolves.toMatchObject({ turnId: TURN_ID })
  })

  it('returns null for a workflow outside the caller’s org, before any counts leak', async () => {
    // `workflow` is `baselineAtCreate: false`, so a row-less (foreign) id falls
    // back to the caller's AREA level and sails through the instance assert.
    graphEdit.readWorkflowTurnSnapshot.mockResolvedValue(snapshot())
    appRows.value = []
    await expect(
      caller(capabilitiesFor('admin', { instances: {} })).getKopilotTurnReview({
        workflowAppId: 'wf_someotherorg000000000',
      })
    ).resolves.toBeNull()
  })

  it('counts a draft with no graph row as zero nodes rather than failing', async () => {
    graphEdit.readWorkflowTurnSnapshot.mockResolvedValue(snapshot())
    appRows.value = [{ id: WF_ID, draftNodeCount: null }]
    await expect(
      caller(capabilitiesFor('read')).getKopilotTurnReview({
        workflowAppId: WF_ID,
      })
    ).resolves.toMatchObject({ currentNodeCount: 0 })
  })

  it('refuses a member restricted from the workflow entirely', async () => {
    await expect(
      caller(
        capabilitiesFor('none', {
          areaPermission: 'admin',
          instances: { [WF_ID]: 'none' },
        })
      ).getKopilotTurnReview({ workflowAppId: WF_ID })
    ).rejects.toMatchObject(FORBIDDEN)
    expect(graphEdit.readWorkflowTurnSnapshot).not.toHaveBeenCalled()
  })
})

describe('workflow.revertKopilotTurn', () => {
  it('reverts for an instance `edit` holder, passing the turnId the offer handed out', async () => {
    await expect(
      caller(capabilitiesFor('edit')).revertKopilotTurn({
        workflowAppId: WF_ID,
        turnId: TURN_ID,
      })
    ).resolves.toEqual({ reverted: true })
    expect(graphEdit.revertWorkflowTurn).toHaveBeenCalledWith(
      expect.anything(),
      { workflowAppId: WF_ID, organizationId: ORG_ID },
      TURN_ID
    )
  })

  it('refuses an instance `view` holder — the offer renders at view, taking it does not', async () => {
    await expect(
      caller(capabilitiesFor('read')).revertKopilotTurn({
        workflowAppId: WF_ID,
        turnId: TURN_ID,
      })
    ).rejects.toMatchObject(FORBIDDEN)
    expect(graphEdit.revertWorkflowTurn).not.toHaveBeenCalled()
  })

  it('surfaces the 404 verbatim when the snapshot is gone — [C3], not a 500', async () => {
    // The plan's case: an intervening MANUAL canvas save called
    // `clearWorkflowTurnSnapshot`, so there is nothing left to revert. The card
    // has to be able to say so, which means the message must survive the router.
    const error = new NotFoundError(
      'No snapshot for turn "x" — either the turn never wrote to the draft, or a later ' +
        'turn superseded it. Nothing was reverted.'
    )
    graphEdit.revertWorkflowTurn.mockResolvedValue({ isErr: () => true, error } as never)
    await expect(
      caller(capabilitiesFor('edit')).revertKopilotTurn({
        workflowAppId: WF_ID,
        turnId: TURN_ID,
      })
    ).rejects.toMatchObject({
      cause: { name: 'NotFoundError', statusCode: 404, message: error.message },
    })
  })

  it('surfaces the 409 verbatim when the canvas moved on — [C3], distinct from the 404', async () => {
    const error = new ConflictError(
      'The workflow canvas has changed since that turn finished, so those edits can no ' +
        'longer be undone as a group. Nothing was reverted.',
      { reason: 'canvas-changed-since-turn' }
    )
    graphEdit.revertWorkflowTurn.mockResolvedValue({ isErr: () => true, error } as never)
    await expect(
      caller(capabilitiesFor('edit')).revertKopilotTurn({
        workflowAppId: WF_ID,
        turnId: TURN_ID,
      })
    ).rejects.toMatchObject({
      cause: { name: 'ConflictError', statusCode: 409, message: error.message },
    })
  })

  it('refuses a system-owned workflow before touching the snapshot', async () => {
    const { ForbiddenError } = await import('@auxx/lib/errors')
    guards.app.mockRejectedValueOnce(new ForbiddenError('system-owned'))
    await expect(
      caller(capabilitiesFor('admin')).revertKopilotTurn({
        workflowAppId: WF_ID,
        turnId: TURN_ID,
      })
    ).rejects.toMatchObject(FORBIDDEN)
    expect(graphEdit.revertWorkflowTurn).not.toHaveBeenCalled()
  })

  it('a row-less workflow still needs the AREA at Edit', async () => {
    await expect(
      caller(capabilitiesFor('read', { instances: {} })).revertKopilotTurn({
        workflowAppId: WF_ID,
        turnId: TURN_ID,
      })
    ).rejects.toMatchObject(FORBIDDEN)
    await expect(
      caller(capabilitiesFor('edit', { instances: {} })).revertKopilotTurn({
        workflowAppId: WF_ID,
        turnId: TURN_ID,
      })
    ).resolves.toEqual({ reverted: true })
  })
})

describe('workflow.keepKopilotTurn', () => {
  it('discards the snapshot for the pinned turn, turn-checked', async () => {
    graphEdit.readWorkflowTurnSnapshot.mockResolvedValue(snapshot())
    await expect(
      caller(capabilitiesFor('edit')).keepKopilotTurn({ workflowAppId: WF_ID, turnId: TURN_ID })
    ).resolves.toEqual({ ok: true })
    // `finalizeWorkflowTurn`, not `clearWorkflowTurnSnapshot`: the delete has to
    // be turn-checked or a stale Keep button destroys a NEWER turn's recovery
    // path, which is the one thing this whole phase exists to preserve.
    expect(graphEdit.finalizeWorkflowTurn).toHaveBeenCalledWith(WF_ID, TURN_ID)
  })

  it('reads the snapshot turn-PINNED, and soft-fails when a newer turn owns the slot', async () => {
    graphEdit.readWorkflowTurnSnapshot.mockResolvedValue(null)
    await expect(
      caller(capabilitiesFor('edit')).keepKopilotTurn({ workflowAppId: WF_ID, turnId: TURN_ID })
    ).resolves.toEqual({ ok: false, reason: 'turn_mismatch' })
    expect(graphEdit.readWorkflowTurnSnapshot).toHaveBeenCalledWith(WF_ID, TURN_ID)
    expect(graphEdit.finalizeWorkflowTurn).not.toHaveBeenCalled()
  })

  it('soft-fails a workflow outside the caller’s org without reading the slot', async () => {
    appRows.value = []
    await expect(
      caller(capabilitiesFor('admin', { instances: {} })).keepKopilotTurn({
        workflowAppId: 'wf_someotherorg000000000',
        turnId: TURN_ID,
      })
    ).resolves.toEqual({ ok: false, reason: 'not_found' })
    expect(graphEdit.readWorkflowTurnSnapshot).not.toHaveBeenCalled()
  })

  it('refuses an instance `view` holder — Keep discards a recovery path', async () => {
    await expect(
      caller(capabilitiesFor('read')).keepKopilotTurn({ workflowAppId: WF_ID, turnId: TURN_ID })
    ).rejects.toMatchObject(FORBIDDEN)
    expect(graphEdit.finalizeWorkflowTurn).not.toHaveBeenCalled()
  })
})
