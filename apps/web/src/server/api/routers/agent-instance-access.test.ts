// apps/web/src/server/api/routers/agent-instance-access.test.ts

import type { ResourcePermission } from '@auxx/database/enums'
import { Area, expandLevelsToKeys, Level, PermissionKey } from '@auxx/lib/permissions/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'

/**
 * Plan 25 §4.2.DECIDED at the router layer — per-agent instance access.
 *
 * Four things this file exists to pin, in order of how easy they are to break:
 *  1. **`getById` resolves BEFORE it asserts.** It accepts an id *or* a slug
 *     (the detail page routes by slug) while `ResourceAccess` rows are keyed on
 *     `Agent.id`. An assert on the raw input finds no row, falls through to the
 *     area level, and hands over an agent the member was restricted from — in
 *     the `agents: None` + explicit-grant direction it does the opposite and
 *     403s a legitimate holder on their own agent. Both directions are pinned.
 *  2. **The three-rung ladder.** `view` = usable (open it, chat, mention),
 *     `edit` = authoring, `admin` = publish / restore / delete / archive /
 *     run-as / permission-profile. Each boundary is tested from BOTH sides.
 *  3. **`update`'s field-presence escalation.** One fat mutation serves the
 *     persona autosave (Edit) and the administration panels (Full), so the tier
 *     is decided by which KEYS the payload carries (`ADMIN_ONLY_UPDATE_FIELDS`),
 *     not by the procedure.
 *  4. **`list` FILTERS, never asserts per agent** — and does so through all
 *     three `instanceListScope` arms, since plan 25 §2 gave the view gate two
 *     regimes that no single id list can express.
 *
 * Behavioral, not source-text: the real router module is imported and driven
 * through a tRPC caller, `ctx.capabilities` is a **real** `CapabilitySet` (the
 * shipped assert methods), and the real `~/server/lib/agent-instance-access`
 * resolver runs against a mocked org agents cache. The `permissionProcedure`
 * stand-in runs the real `capabilities.assert(key)`, so the coarse rung on the
 * builder is under test too — `create`/`checkSlug`'s `agentsManage` gate lives
 * there, not in the body.
 *
 * Deleting or weakening any assert makes a case here fail, because the mocked
 * `@auxx/lib/agents` service functions are the observed side effect.
 */

const ORG_ID = 'org_cuid000000000000000000000'
const USER_ID = 'usr_cuid000000000000000000000'
/** The agent every tier case is keyed on. */
const AGENT_ID = 'agt_cuid0000000000000000000'
/** …and its slug. `getById` is routinely called with THIS, never the id. */
const AGENT_SLUG = 'escalation-lead'
const VERSION_ID = 'agv_cuid0000000000000000000'

const { agents, cache, realtime, featureService } = vi.hoisted(() => {
  /**
   * The org's agents, as BOTH the cache resolver and `listAgents` see them.
   * One fixture on purpose: `agent.list`'s filter and
   * `assertAgentAccess`' id-or-slug resolve must agree about what exists.
   */
  const fixture: { rows: { id: string; slug: string }[] } = {
    rows: [{ id: 'agt_cuid0000000000000000000', slug: 'escalation-lead' }],
  }
  return {
    cache: {
      fixture,
      getAllCachedAgents: vi.fn(async () => fixture.rows),
    },
    agents: {
      listAgents: vi.fn(async () => fixture.rows.map((r) => ({ id: r.id, slug: r.slug }))),
      getAgentDetailByIdOrSlug: vi.fn(async (_org: string, id: string) => ({ id })),
      createAgent: vi.fn(async () => ({
        agentId: 'agt_new',
        userId: null,
        toolsetSlugs: [],
        toolsetSource: 'auto_default',
      })),
      completeAgentSetup: vi.fn(async () => undefined),
      deleteDraftAgent: vi.fn(async () => ({ deleted: true })),
      deleteAgent: vi.fn(async () => ({ deleted: true })),
      updateAgent: vi.fn(async () => undefined),
      isAgentSlugTaken: vi.fn(async () => false),
      setAgentToolBindings: vi.fn(async () => undefined),
      publishAgent: vi.fn(async () => ({
        isErr: () => false,
        value: { version: { id: VERSION_ID, versionNumber: 2 }, reductions: [] },
      })),
      discardAgentDraft: vi.fn(async () => ({ isErr: () => false, value: undefined })),
      restoreAgentVersion: vi.fn(async () => ({ isErr: () => false, value: undefined })),
      renameAgentVersion: vi.fn(async () => ({ isErr: () => false, value: undefined })),
      listAgentVersions: vi.fn(async () => ({ isErr: () => false, value: [] })),
    },
    realtime: {
      publishAgentUpdated: vi.fn(async () => undefined),
    },
    featureService: { requireAccess: vi.fn(async () => undefined) },
  }
})

vi.mock('@auxx/lib/agents', () => ({
  ...agents,
  // Faithful stand-in for `packages/lib/src/agents/slug-schema.ts`; slug
  // *validation* is not what this file is about, only that inputs still parse.
  agentSlugSchema: z
    .string()
    .min(1)
    .max(60)
    .regex(/^[a-z0-9-]+$/),
}))

// `~/server/lib/agent-instance-access` (the real module, deliberately NOT
// mocked — its resolve is property #1 above) reads the org agents cache.
vi.mock('@auxx/lib/cache', () => ({ getAllCachedAgents: cache.getAllCachedAgents }))

vi.mock('@auxx/lib/realtime', () => ({
  publishAgentUpdated: realtime.publishAgentUpdated,
  getRealtimeService: () => ({}),
}))

vi.mock('@auxx/logger', async () => (await import('~/test/logger-mock')).mockAuxxLogger())

// See the note in `workflow-instance-access.test.ts` — the `@auxx/lib/permissions`
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
 *
 * So the coarse rung on the procedure builder is under test alongside the
 * per-instance asserts in the bodies — dropping
 * `permissionProcedure(agentsManage)` from `create` fails a case below.
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
const { agentRouter } = await import('./agent')

/** AuxxError, wrapped by tRPC as `cause` (the app's middleware maps it to 403). */
const FORBIDDEN = { cause: { name: 'ForbiddenError', statusCode: 403 } }
/** `assertAgentAccess` 404s an unresolvable identifier BEFORE the capability check. */
const NOT_FOUND = { cause: { name: 'NotFoundError', statusCode: 404 } }

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
 * independently (e.g. a member sitting at area `Full` but restricted on one
 * agent). `instances: {}` models an agent with NO row at all — the
 * `baselineAtCreate: false` fallback to the area level.
 */
function capabilitiesFor(
  permission: ResourcePermission,
  opts: {
    instances?: Record<string, ResourcePermission>
    areaPermission?: ResourcePermission
    role?: 'MEMBER' | 'OWNER'
    seatType?: 'full' | 'worker'
    /**
     * Override the derived front-door keys. Only the `list` `kind: 'none'` case
     * needs this — see the note there.
     */
    derivedKeys?: PermissionKey[]
  } = {}
) {
  const instances = opts.instances ?? { [AGENT_ID]: permission }
  const seatType = opts.seatType ?? 'full'
  // Reproduce `deriveInstanceReadKeys`: any ≥`view` agent row synthesizes
  // `agentsView`, clamped away on a worker seat (`agents` is outside
  // WORKER_AREAS). Without this an `agents: None` grantee would 403 at the
  // coarse front door on every instance-asserted procedure.
  const derived =
    opts.derivedKeys ??
    (seatType !== 'worker' && Object.values(instances).some((p) => p !== 'none' && p !== undefined)
      ? [PermissionKey.agentsView]
      : [])
  return new CapabilitySet(
    new Set(
      expandLevelsToKeys({ [Area.agents]: AREA_LEVEL_OF[opts.areaPermission ?? permission] })
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

function caller(capabilities: InstanceType<typeof CapabilitySet>) {
  return agentRouter.createCaller({
    db: {},
    capabilities,
    headers: new Headers(),
    session: {
      organizationId: ORG_ID,
      userId: USER_ID,
      isSuperAdmin: false,
      user: { id: USER_ID, defaultOrganizationId: ORG_ID, email: 'a@b.c', name: 'A' },
    },
  } as never)
}

type Caller = ReturnType<typeof caller>

/** View tier — everything a `view` holder may read. */
const VIEW_READS = [
  [
    'getById',
    (c: Caller) => c.getById({ agentId: AGENT_ID }),
    () => agents.getAgentDetailByIdOrSlug,
  ],
  [
    'listVersions',
    (c: Caller) => c.listVersions({ agentId: AGENT_ID }),
    () => agents.listAgentVersions,
  ],
] as const

/** Edit tier — authoring the draft. */
const EDIT_LEVEL = [
  [
    'update (prompt)',
    (c: Caller) => c.update({ agentId: AGENT_ID, prompt: { type: 'doc' } }),
    () => agents.updateAgent,
  ],
  [
    'setToolBindings',
    (c: Caller) => c.setToolBindings({ agentId: AGENT_ID, bindings: {} }),
    () => agents.setAgentToolBindings,
  ],
  [
    'deleteDraft',
    (c: Caller) => c.deleteDraft({ agentId: AGENT_ID }),
    () => agents.deleteDraftAgent,
  ],
  [
    'discardChanges',
    (c: Caller) => c.discardChanges({ agentId: AGENT_ID }),
    () => agents.discardAgentDraft,
  ],
  [
    'renameVersion',
    (c: Caller) => c.renameVersion({ agentId: AGENT_ID, versionId: VERSION_ID, label: 'v2' }),
    () => agents.renameAgentVersion,
  ],
] as const

/** Admin tier — promote to production, rewind it, or destroy the agent. */
const ADMIN_ONLY = [
  [
    'completeSetup',
    (c: Caller) => c.completeSetup({ agentId: AGENT_ID }),
    () => agents.completeAgentSetup,
  ],
  ['publish', (c: Caller) => c.publish({ agentId: AGENT_ID }), () => agents.publishAgent],
  [
    'restoreVersion',
    (c: Caller) => c.restoreVersion({ agentId: AGENT_ID, toVersionId: VERSION_ID }),
    () => agents.restoreAgentVersion,
  ],
  ['delete', (c: Caller) => c.delete({ agentId: AGENT_ID }), () => agents.deleteAgent],
] as const

/**
 * Every `ADMIN_ONLY_UPDATE_FIELDS` key, with a value that is genuinely present.
 * `null` on two of them is deliberate — CLEARING a run-as delegation or a
 * profile binding is as administrative as setting one, and a falsy-but-defined
 * value must still escalate, which an `if (input[field])` check would miss.
 */
const ADMIN_UPDATE_PAYLOADS = [
  ['runAsUserId (set)', { runAsUserId: 'usr_delegate0000000000000000' }],
  ['runAsUserId (clear)', { runAsUserId: null }],
  ['permissionProfileId (set)', { permissionProfileId: 'prf_cuid0000000000000000000' }],
  ['permissionProfileId (clear)', { permissionProfileId: null }],
  ['archivedAt (archive)', { archivedAt: new Date('2026-07-28T00:00:00Z') }],
  ['archivedAt (unarchive)', { archivedAt: null }],
] as const

/** Ordinary authoring fields — these must NOT escalate. */
const EDIT_UPDATE_PAYLOADS = [
  ['name', { name: 'Renamed' }],
  ['slug', { slug: 'renamed-agent' }],
  ['description', { description: 'A description' }],
  ['prompt', { prompt: { type: 'doc' } }],
  ['modelId', { modelId: 'claude-sonnet' }],
  ['mentionable', { mentionable: false }],
  ['appAccounts', { appAccounts: { quickbooks: { credId: 'crd_1' } } }],
] as const

const ALL_MOCKS = [
  ...Object.values(agents),
  realtime.publishAgentUpdated,
  featureService.requireAccess,
]

beforeEach(() => {
  for (const fn of ALL_MOCKS) fn.mockClear()
  cache.getAllCachedAgents.mockClear()
  agents.isAgentSlugTaken.mockReset()
  agents.isAgentSlugTaken.mockResolvedValue(false)
  cache.fixture.rows = [{ id: AGENT_ID, slug: AGENT_SLUG }]
})

describe('agent router — `getById` asserts on the RESOLVED id, not the raw input', () => {
  it('a slug reaches the agent whose grant is keyed on the ID', async () => {
    // The detail page routes by slug. `assertViewInstance('agent', <slug>)` would
    // find no ResourceAccess row for `escalation-lead`, fall back to the area
    // level (None here) and 403 a member who genuinely holds the agent.
    const caps = capabilitiesFor('read', {
      areaPermission: 'none',
      instances: { [AGENT_ID]: 'read' },
    })
    await expect(caller(caps).getById({ agentId: AGENT_SLUG })).resolves.toEqual({ id: AGENT_ID })
    // …and the service is handed the RESOLVED id, never the slug.
    expect(agents.getAgentDetailByIdOrSlug).toHaveBeenCalledWith(ORG_ID, AGENT_ID)
  })

  it('a slug does NOT escape a restriction keyed on the id', async () => {
    // The other direction, and the leak that matters: an area-Full member who
    // was explicitly restricted from this agent must not walk around the row by
    // asking for it by slug. Asserting on the raw slug finds no row, falls
    // through to the area level (`admin`) and hands the agent straight over.
    const caps = capabilitiesFor('none', {
      areaPermission: 'admin',
      instances: { [AGENT_ID]: 'none' },
    })
    await expect(caller(caps).getById({ agentId: AGENT_SLUG })).rejects.toMatchObject(FORBIDDEN)
    expect(agents.getAgentDetailByIdOrSlug).not.toHaveBeenCalled()
  })

  it('every instance-asserted procedure resolves, not just getById', async () => {
    // The resolver is the ONE authority (`assertAgentAccess`), so the slug path
    // works uniformly — a caller that passes a slug to `update` gets the same
    // treatment, and the service receives the id.
    const caps = capabilitiesFor('edit')
    await expect(
      caller(caps).update({ agentId: AGENT_SLUG, prompt: { type: 'doc' } })
    ).resolves.toBeUndefined()
    expect(agents.updateAgent).toHaveBeenCalledWith(AGENT_ID, ORG_ID, expect.anything(), {
      excludeSocketId: undefined,
    })
  })

  it('an unknown identifier 404s BEFORE any capability decision leaks its existence', async () => {
    // An agent id from another org must not be distinguishable from one this
    // member is restricted from — both end as NotFoundError.
    await expect(
      caller(capabilitiesFor('admin')).getById({ agentId: 'agt_missing' })
    ).rejects.toMatchObject(NOT_FOUND)
    expect(agents.getAgentDetailByIdOrSlug).not.toHaveBeenCalled()
  })
})

describe('agent router — the view tier', () => {
  it.each(VIEW_READS)('%s succeeds at instance view', async (_name, call, mock) => {
    await expect(call(caller(capabilitiesFor('read')))).resolves.toBeDefined()
    expect(mock()).toHaveBeenCalledTimes(1)
  })

  it.each(VIEW_READS)('%s is refused for an agent restricted to `none`', async (_n, call, mock) => {
    await expect(
      call(
        caller(
          capabilitiesFor('none', {
            areaPermission: 'admin',
            instances: { [AGENT_ID]: 'none' },
          })
        )
      )
    ).rejects.toMatchObject(FORBIDDEN)
    expect(mock()).not.toHaveBeenCalled()
  })
})

describe('agent router — the edit tier', () => {
  it.each(EDIT_LEVEL)('%s succeeds at instance edit', async (_name, call, mock) => {
    await expect(call(caller(capabilitiesFor('edit')))).resolves.not.toThrow()
    expect(mock()).toHaveBeenCalledTimes(1)
  })

  it.each(EDIT_LEVEL)('%s is refused at instance view', async (_name, call, mock) => {
    await expect(call(caller(capabilitiesFor('read')))).rejects.toMatchObject(FORBIDDEN)
    expect(mock()).not.toHaveBeenCalled()
  })
})

describe('agent router — the admin tier', () => {
  it.each(ADMIN_ONLY)('%s succeeds at instance admin', async (_name, call, mock) => {
    await expect(call(caller(capabilitiesFor('admin')))).resolves.not.toThrow()
    expect(mock()).toHaveBeenCalledTimes(1)
  })

  it.each(ADMIN_ONLY)('%s is refused at instance edit', async (_name, call, mock) => {
    await expect(call(caller(capabilitiesFor('edit')))).rejects.toMatchObject(FORBIDDEN)
    expect(mock()).not.toHaveBeenCalled()
  })

  it.each(ADMIN_ONLY)('%s is refused at instance view', async (_name, call, mock) => {
    await expect(call(caller(capabilitiesFor('read')))).rejects.toMatchObject(FORBIDDEN)
    expect(mock()).not.toHaveBeenCalled()
  })

  it('deleteDraft and delete sit on DIFFERENT rungs', async () => {
    // The pair is easy to collapse: both destroy an agent row. `deleteDraft`
    // only ever touches an agent that never completed setup (no backing User,
    // nothing published), so it is authoring; `delete` destroys a live agent.
    const editor = capabilitiesFor('edit')
    await expect(caller(editor).deleteDraft({ agentId: AGENT_ID })).resolves.toBeUndefined()
    await expect(caller(editor).delete({ agentId: AGENT_ID })).rejects.toMatchObject(FORBIDDEN)
    expect(agents.deleteAgent).not.toHaveBeenCalled()
  })
})

describe('agent router — `update` escalates on field PRESENCE', () => {
  it.each(EDIT_UPDATE_PAYLOADS)('carrying `%s` stays on the edit rung', async (_f, payload) => {
    await expect(
      caller(capabilitiesFor('edit')).update({ agentId: AGENT_ID, ...payload })
    ).resolves.toBeUndefined()
    expect(agents.updateAgent).toHaveBeenCalledTimes(1)
  })

  it.each(
    EDIT_UPDATE_PAYLOADS
  )('carrying `%s` is still refused at instance view', async (_f, p) => {
    await expect(
      caller(capabilitiesFor('read')).update({ agentId: AGENT_ID, ...p })
    ).rejects.toMatchObject(FORBIDDEN)
    expect(agents.updateAgent).not.toHaveBeenCalled()
  })

  it.each(
    ADMIN_UPDATE_PAYLOADS
  )('carrying `%s` escalates the save to Full — refused at instance edit', async (_f, payload) => {
    await expect(
      caller(capabilitiesFor('edit')).update({
        agentId: AGENT_ID,
        prompt: { type: 'doc' },
        ...payload,
      })
    ).rejects.toMatchObject(FORBIDDEN)
    expect(agents.updateAgent).not.toHaveBeenCalled()
  })

  it.each(
    ADMIN_UPDATE_PAYLOADS
  )('carrying `%s` succeeds at instance admin', async (_f, payload) => {
    await expect(
      caller(capabilitiesFor('admin')).update({ agentId: AGENT_ID, ...payload })
    ).resolves.toBeUndefined()
    expect(agents.updateAgent).toHaveBeenCalledTimes(1)
  })

  it('an admin field present but explicitly `undefined` does NOT escalate', async () => {
    // THE TRIPWIRE for `ADMIN_ONLY_UPDATE_FIELDS`' `input[field] !== undefined`
    // form. That check is safe only because the router's own payload builder
    // guards each of the three with the SAME `!== undefined` test, so an
    // explicitly-undefined key never reaches `updateAgent` and cannot change
    // anything either. The assertion below is on KEY PRESENCE, not on the value,
    // because `updateAgent` detects an archive transition with
    // `'archivedAt' in input` — a payload builder that ever forwarded the key
    // with an undefined value would silently UNARCHIVE the agent (and ban/unban
    // its backing User) on a plain persona autosave. If that day comes this test
    // fails, and the router's escalation check has to become key-presence-based
    // (`field in patch`) to match.
    await expect(
      caller(capabilitiesFor('edit')).update({
        agentId: AGENT_ID,
        prompt: { type: 'doc' },
        runAsUserId: undefined,
        permissionProfileId: undefined,
        archivedAt: undefined,
      })
    ).resolves.toBeUndefined()
    expect(agents.updateAgent).toHaveBeenCalledTimes(1)
    const written = agents.updateAgent.mock.calls[0]?.[2] as Record<string, unknown>
    expect('runAsUserId' in written).toBe(false)
    expect('permissionProfileId' in written).toBe(false)
    expect('archivedAt' in written).toBe(false)
  })

  it('the escalation runs BEFORE the slug-conflict probe', async () => {
    // Order matters for disclosure: a member who may not archive must not learn
    // whether a slug is taken by bundling one into the same payload.
    agents.isAgentSlugTaken.mockResolvedValue(true)
    await expect(
      caller(capabilitiesFor('edit')).update({
        agentId: AGENT_ID,
        slug: 'taken-slug',
        archivedAt: new Date(),
      })
    ).rejects.toMatchObject(FORBIDDEN)
    expect(agents.isAgentSlugTaken).not.toHaveBeenCalled()
  })
})

describe('agent router — creating is the coarse `agentsManage` rung', () => {
  it('create is refused for a member at the agents Edit rung', async () => {
    await expect(caller(capabilitiesFor('edit')).create({ name: 'New' })).rejects.toMatchObject(
      FORBIDDEN
    )
    expect(agents.createAgent).not.toHaveBeenCalled()
  })

  it('create succeeds once the member holds agents Full', async () => {
    await expect(caller(capabilitiesFor('admin')).create({ name: 'New' })).resolves.toMatchObject({
      agentId: 'agt_new',
    })
    expect(agents.createAgent).toHaveBeenCalledTimes(1)
  })

  it('one instance `admin` grant does NOT confer the create rung', async () => {
    // `deriveInstanceReadKeys` synthesizes the Read rung only, regardless of
    // grant strength — precisely so that a share cannot front-door `create`.
    await expect(
      caller(capabilitiesFor('admin', { areaPermission: 'none' })).create({ name: 'New' })
    ).rejects.toMatchObject(FORBIDDEN)
    expect(agents.createAgent).not.toHaveBeenCalled()
  })

  /**
   * `checkSlug` serves two callers with two different authorities, so it is the
   * one procedure whose gate lives in the BODY rather than on the builder.
   * Without `excludeAgentId` it is the create dialog asking about the org's slug
   * namespace (coarse `agentsManage`); with it, it is the detail page's live
   * rename hint asking about ONE agent (instance `edit`).
   */
  it('checkSlug without excludeAgentId rides the coarse create rung', async () => {
    await expect(
      caller(capabilitiesFor('edit')).checkSlug({ slug: 'anything' })
    ).rejects.toMatchObject(FORBIDDEN)
    await expect(caller(capabilitiesFor('admin')).checkSlug({ slug: 'anything' })).resolves.toEqual(
      { available: true }
    )
  })

  it('checkSlug with excludeAgentId is an instance edit check, not the create rung', async () => {
    // The rename hint must survive for an instance-`edit` holder below coarse
    // Full — `update` already lets them rename, so taking the preview away is an
    // affordance vanishing for no visible reason.
    await expect(
      caller(capabilitiesFor('edit', { areaPermission: 'none' })).checkSlug({
        slug: 'anything',
        excludeAgentId: AGENT_ID,
      })
    ).resolves.toEqual({ available: true })

    // …and it is still a real check: `view` on that agent is not enough.
    await expect(
      caller(capabilitiesFor('read')).checkSlug({
        slug: 'anything',
        excludeAgentId: AGENT_ID,
      })
    ).rejects.toMatchObject(FORBIDDEN)
  })

  it('checkSlug resolves excludeAgentId by slug, like every other instance assert', async () => {
    await expect(
      caller(capabilitiesFor('edit')).checkSlug({
        slug: 'anything',
        excludeAgentId: AGENT_SLUG,
      })
    ).resolves.toEqual({ available: true })
  })
})

describe('agent router — `list` filters through all three instanceListScope arms', () => {
  const OTHER_ID = 'agt_othercuid000000000000'

  beforeEach(() => {
    cache.fixture.rows = [
      { id: AGENT_ID, slug: AGENT_SLUG },
      { id: OTHER_ID, slug: 'other-agent' },
    ]
  })

  it('EXCLUDE — an open area drops only the explicitly restricted agent', async () => {
    const result = await caller(
      capabilitiesFor('admin', {
        areaPermission: 'admin',
        instances: { [OTHER_ID]: 'none' },
      })
    ).list()
    expect(result.map((a: { id: string }) => a.id)).toEqual([AGENT_ID])
  })

  it('EXCLUDE with nothing restricted — an unrestricted org pays nothing', async () => {
    const result = await caller(capabilitiesFor('admin', { instances: {} })).list()
    expect(result.map((a: { id: string }) => a.id)).toEqual([AGENT_ID, OTHER_ID])
  })

  it('INCLUDE — an `agents: None` member sees ONLY what was shared with them', async () => {
    // The regime that makes sharing work at all (plan 25 §2): the member
    // composes the area to None, so every row-LESS agent is invisible and no
    // exclusion list could enumerate them. The scope inverts to an allow-list.
    const result = await caller(
      capabilitiesFor('read', {
        areaPermission: 'none',
        instances: { [AGENT_ID]: 'read' },
      })
    ).list()
    expect(result.map((a: { id: string }) => a.id)).toEqual([AGENT_ID])
  })

  it('NONE — returns an empty list WITHOUT reading the agents cache', async () => {
    // `kind: 'none'` means nothing is visible, so the router must short-circuit
    // rather than fetch the org's agents and filter them all away.
    //
    // A worker seat is the only producer of this arm (`agents` is outside
    // WORKER_AREAS, so `SEAT_CEILINGS.worker` closes it). The `agentsView` key
    // is handed in explicitly because production clamps it away upstream — this
    // pins the router's own defense-in-depth short-circuit, which is what
    // survives if the front-door gate is ever relaxed to `capabilityProcedure`.
    const worker = capabilitiesFor('admin', {
      seatType: 'worker',
      derivedKeys: [PermissionKey.agentsView],
      instances: { [AGENT_ID]: 'admin' },
    })
    await expect(caller(worker).list()).resolves.toEqual([])
    expect(agents.listAgents).not.toHaveBeenCalled()
  })

  it('keeps the `includeArchived` passthrough', async () => {
    await caller(capabilitiesFor('admin', { instances: {} })).list({
      includeArchived: true,
    })
    expect(agents.listAgents).toHaveBeenCalledWith(ORG_ID, { includeArchived: true })
  })
})

describe('agent router — composition: `agents: None` + ONE explicit grant (plan 25 §2)', () => {
  /**
   * The member the whole feature exists for: their profile grants no agents at
   * all, and a single share hands them one. Three things must all hold — the
   * coarse front door opens (via the derived Read rung), the instance assert
   * passes for THAT agent, and nothing else in the org becomes reachable.
   */
  const shared = (permission: ResourcePermission) =>
    capabilitiesFor(permission, {
      areaPermission: 'none',
      instances: { [AGENT_ID]: permission },
    })

  it('an `admin` grant reaches every rung on that one agent', async () => {
    await expect(caller(shared('admin')).getById({ agentId: AGENT_ID })).resolves.toBeDefined()
    await expect(
      caller(shared('admin')).update({
        agentId: AGENT_ID,
        prompt: { type: 'doc' },
      })
    ).resolves.toBeUndefined()
    await expect(caller(shared('admin')).publish({ agentId: AGENT_ID })).resolves.toBeDefined()
    await expect(caller(shared('admin')).delete({ agentId: AGENT_ID })).resolves.toBeUndefined()
  })

  it('and reaches NOTHING else — a row-less agent stays invisible', async () => {
    const OTHER_ID = 'agt_othercuid000000000000'
    cache.fixture.rows = [
      { id: AGENT_ID, slug: AGENT_SLUG },
      { id: OTHER_ID, slug: 'other-agent' },
    ]
    await expect(caller(shared('admin')).getById({ agentId: OTHER_ID })).rejects.toMatchObject(
      FORBIDDEN
    )
    expect(agents.getAgentDetailByIdOrSlug).not.toHaveBeenCalled()
  })

  it('a `view` grant is usable but not editable', async () => {
    await expect(caller(shared('read')).getById({ agentId: AGENT_ID })).resolves.toBeDefined()
    await expect(
      caller(shared('read')).update({ agentId: AGENT_ID, prompt: { type: 'doc' } })
    ).rejects.toMatchObject(FORBIDDEN)
  })
})

describe('agent router — `baselineAtCreate: false`: no row falls back to the AREA', () => {
  /** A member with NO instance rows at all — nothing is in `governingInstanceIds`. */
  const noRows = (areaPermission: ResourcePermission) =>
    capabilitiesFor(areaPermission, { areaPermission, instances: {} })

  it('area Read ⇒ the agent opens, but does not save', async () => {
    await expect(caller(noRows('read')).getById({ agentId: AGENT_ID })).resolves.toBeDefined()
    await expect(
      caller(noRows('read')).update({ agentId: AGENT_ID, prompt: { type: 'doc' } })
    ).rejects.toMatchObject(FORBIDDEN)
  })

  it('area Edit ⇒ saves, but does not publish or archive', async () => {
    await expect(
      caller(noRows('edit')).update({ agentId: AGENT_ID, prompt: { type: 'doc' } })
    ).resolves.toBeUndefined()
    await expect(caller(noRows('edit')).publish({ agentId: AGENT_ID })).rejects.toMatchObject(
      FORBIDDEN
    )
    await expect(
      caller(noRows('edit')).update({ agentId: AGENT_ID, archivedAt: new Date() })
    ).rejects.toMatchObject(FORBIDDEN)
  })

  it('area Full ⇒ everything, with no ResourceAccess row anywhere', async () => {
    // The no-regression guarantee: `MEMBER_BASELINE_LEVELS[agents] = Full`, so
    // this is what every existing member is, and nothing here may 403.
    await expect(caller(noRows('admin')).delete({ agentId: AGENT_ID })).resolves.toBeUndefined()
    await expect(caller(noRows('admin')).publish({ agentId: AGENT_ID })).resolves.toBeDefined()
    await expect(
      caller(noRows('admin')).completeSetup({ agentId: AGENT_ID })
    ).resolves.toBeUndefined()
  })
})

describe('agent router — OWNER regression', () => {
  it('short-circuits to admin on an agent restricted to `none`', async () => {
    // §0.10 recovery guarantee: nothing authored on an agent can lock the last
    // owner out of the agent that would let them undo it.
    const owner = capabilitiesFor('admin', {
      role: 'OWNER',
      instances: { [AGENT_ID]: 'none' },
    })
    await expect(caller(owner).delete({ agentId: AGENT_ID })).resolves.toBeUndefined()
    expect(agents.deleteAgent).toHaveBeenCalledTimes(1)
  })
})
