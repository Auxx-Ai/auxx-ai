// apps/web/src/server/api/routers/actor-agent-access.test.ts

import { ResourcePermission } from '@auxx/database/enums'
import { Area, expandLevelsToKeys, Level, PermissionKey } from '@auxx/lib/permissions/client'
import type { Actor } from '@auxx/types/actor'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Plan 25 §4.2 decision 1 at the picker endpoint — `view` means **usable**, and
 * "the picker hides what the endpoint still serves" is the consequence it names.
 *
 * `actor.list` / `actor.search` / `actor.getByIds` fill every actor picker in
 * the app (assignees, @-mentions, DM sender, ACTOR field values). They filtered
 * agents not at all, so an agent restricted to `none` still showed up to be
 * picked — and `getByIds` additionally handed back that agent's name, avatar,
 * slug and synthetic user id for any id a client cared to ask about.
 *
 * Two properties, and the second is why this is a FILTER and not an assert:
 *  1. an agent the caller cannot view never appears;
 *  2. users and groups are untouched — a member who can see zero agents still
 *     gets a working picker, not a 403 (the mistake plan 30 §2.2 calls out for
 *     `workflow.list`).
 *
 * Behavioral: the real router is driven through a tRPC caller with a REAL
 * {@link CapabilitySet}. `ActorService` is mocked to return the org's FULL
 * unfiltered actor set, so the router is the only thing that can be dropping
 * rows — a router that stopped filtering hands the fixture straight back and
 * every case below fails.
 */

const { listActors, getByIds, searchActors } = vi.hoisted(() => ({
  listActors: vi.fn(),
  getByIds: vi.fn(),
  searchActors: vi.fn(),
}))

vi.mock('@auxx/lib/actors', () => ({
  ActorService: class {
    listActors = listActors
    getByIds = getByIds
    searchActors = searchActors
  },
  GroupMemberService: class {
    getMembers = vi.fn(async () => [])
    expandToUsers = vi.fn(async () => [])
  },
}))

/**
 * The procedure builders, mirroring what `trpc.ts` really does.
 *
 * `protectedProcedure` deliberately STRIPS `ctx.capabilities`: the real one does
 * not resolve a `CapabilitySet` (only `capabilityProcedure` does), so a
 * procedure downgraded back to `protectedProcedure` would throw on
 * `ctx.capabilities.instanceListScope` in production. Modelling that here makes
 * the downgrade fail a test instead of shipping.
 */
vi.mock('~/server/api/trpc', async () => {
  const { initTRPC } = await import('@trpc/server')
  const t = initTRPC.context<Record<string, unknown>>().create()
  return {
    createTRPCRouter: t.router,
    capabilityProcedure: t.procedure,
    // `next({ ctx })` MERGES, so the strip has to be an explicit overwrite.
    protectedProcedure: t.procedure.use(({ next }) => next({ ctx: { capabilities: undefined } })),
  }
})

// Deep path on purpose — the `@auxx/lib/permissions` barrel hangs under vitest.
const { CapabilitySet } = await import('@auxx/lib/permissions/capabilities/capability-set')
const { actorRouter } = await import('./actor')

const ORG_ID = 'org_cuid000000000000000000000'
const USER_ID = 'usr_cuid000000000000000000000'

const OPEN_AGENT = 'agt_opencuid00000000000000'
const RESTRICTED_AGENT = 'agt_restrictedcuid00000000'
const OPEN_AGENT_USER = 'usr_agentopen0000000000000'
const RESTRICTED_AGENT_USER = 'usr_agentrestricted0000000'

const HUMAN: Actor = {
  actorId: 'user:usr_human000000000000000',
  type: 'user',
  name: 'Ada',
  email: 'ada@example.com',
  avatarUrl: null,
  role: 'USER',
}

const GROUP: Actor = {
  actorId: 'group:grp_cuid00000000000000',
  type: 'group',
  name: 'Support',
  description: null,
  avatarUrl: null,
  memberCount: 3,
  visibility: 'public',
}

function agentActor(agentId: string, userId: string, slug: string): Actor {
  return {
    actorId: `agent:${agentId}`,
    type: 'agent',
    name: slug,
    avatarUrl: null,
    agentId,
    userId,
    slug,
    mentionable: true,
  }
}

const OPEN = agentActor(OPEN_AGENT, OPEN_AGENT_USER, 'open-agent')
const RESTRICTED = agentActor(RESTRICTED_AGENT, RESTRICTED_AGENT_USER, 'restricted-agent')

/** Everything the org has, as `ActorService` would hand it over unfiltered. */
const ALL_ACTORS: Actor[] = [HUMAN, OPEN, RESTRICTED, GROUP]

/**
 * A real `CapabilitySet` for a MEMBER at `agentsLevel` with explicit
 * `ResourceAccess` instance rows.
 *
 * The derived Read rung mirrors `composeUserCapabilities`: any ≥`view` agent row
 * synthesizes `agentsView`, so an `agents: None` grantee is not shut out at the
 * coarse front door. Clamped away on a worker seat, where `agents` is outside
 * `WORKER_AREAS`.
 */
function capabilitiesFor(
  agentsLevel: Level,
  opts: {
    instances?: Record<string, ResourcePermission>
    role?: 'MEMBER' | 'OWNER'
    seatType?: 'full' | 'worker'
  } = {}
) {
  const instances = opts.instances ?? {}
  const seatType = opts.seatType ?? 'full'
  const derived =
    seatType !== 'worker' && Object.values(instances).some((p) => p !== ResourcePermission.none)
      ? [PermissionKey.agentsView]
      : []
  return new CapabilitySet(
    new Set(expandLevelsToKeys({ [Area.agents]: agentsLevel })),
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
  return actorRouter.createCaller({
    db: {},
    capabilities,
    session: { organizationId: ORG_ID, userId: USER_ID, isSuperAdmin: false },
  } as never)
}

/** Ids of whatever actors came back, in order. */
const idsOf = (actors: Actor[]) => actors.map((a) => a.actorId)

beforeEach(() => {
  listActors.mockReset().mockResolvedValue(ALL_ACTORS)
  searchActors.mockReset().mockResolvedValue(ALL_ACTORS)
  getByIds.mockReset().mockResolvedValue(
    new Map<string, Actor>([
      [HUMAN.actorId, HUMAN],
      [OPEN.actorId, OPEN],
      [RESTRICTED.actorId, RESTRICTED],
      [GROUP.actorId, GROUP],
    ])
  )
})

/** Area open (`exclude` arm) with ONE agent explicitly restricted to `none`. */
const restrictedFromOne = () =>
  capabilitiesFor(Level.Full, { instances: { [RESTRICTED_AGENT]: ResourcePermission.none } })

describe('actor router — a restricted agent never reaches the picker', () => {
  it('list drops it', async () => {
    const result = await caller(restrictedFromOne()).list({ target: 'all' })
    expect(idsOf(result)).toEqual([HUMAN.actorId, OPEN.actorId, GROUP.actorId])
  })

  it('search drops it', async () => {
    const result = await caller(restrictedFromOne()).search({ query: 'a', target: 'all' })
    expect(idsOf(result)).toEqual([HUMAN.actorId, OPEN.actorId, GROUP.actorId])
  })

  it('getByIds drops it', async () => {
    const result = await caller(restrictedFromOne()).getByIds({
      ids: [HUMAN.actorId, OPEN.actorId, RESTRICTED.actorId, GROUP.actorId],
    })
    expect(Object.keys(result).sort()).toEqual([HUMAN.actorId, OPEN.actorId, GROUP.actorId].sort())
  })

  it('getByIds also drops the LEGACY `user:<syntheticUserId>` spelling', async () => {
    // `ActorService.getByIds` stamps an AgentActor under BOTH `agent:<id>` and
    // `user:<agent.userId>`, because Thread.assigneeIds / ACTOR field rows still
    // address agents the old way. Filtering on the map KEY would let the whole
    // agent through under its user spelling — the value is what carries the
    // agent id, so the value is what gets judged.
    getByIds.mockResolvedValue(
      new Map<string, Actor>([
        [`user:${RESTRICTED_AGENT_USER}`, RESTRICTED],
        [RESTRICTED.actorId, RESTRICTED],
        [`user:${OPEN_AGENT_USER}`, OPEN],
        [HUMAN.actorId, HUMAN],
      ])
    )
    const result = await caller(restrictedFromOne()).getByIds({
      ids: [`user:${RESTRICTED_AGENT_USER}`, `user:${OPEN_AGENT_USER}`, HUMAN.actorId],
    })
    expect(Object.keys(result).sort()).toEqual([`user:${OPEN_AGENT_USER}`, HUMAN.actorId].sort())
  })

  it('an unrestricted org loses nothing', async () => {
    // The control. `agent` is `baselineAtCreate: false`, so with no
    // `ResourceAccess` rows anywhere every agent falls back to the area level and
    // the exclusion is empty — nobody regresses.
    const result = await caller(capabilitiesFor(Level.Full)).list({ target: 'all' })
    expect(idsOf(result)).toEqual(idsOf(ALL_ACTORS))
  })
})

describe('actor router — all three instanceListScope arms', () => {
  it('`exclude`: an open area drops only the explicitly restricted agents', async () => {
    const result = await caller(restrictedFromOne()).list({ target: 'all' })
    expect(idsOf(result)).toContain(OPEN.actorId)
    expect(idsOf(result)).not.toContain(RESTRICTED.actorId)
  })

  it('`include`: `agents: None` + one grant shows exactly that agent', async () => {
    // The headline case. An explicit instance row beats the closed area floor
    // (plan 25 §2), and it is an ALLOW-list — every row-less agent stays hidden,
    // which is the arm a deny-list cannot express.
    const result = await caller(
      capabilitiesFor(Level.None, { instances: { [OPEN_AGENT]: ResourcePermission.view } })
    ).list({ target: 'all' })
    expect(idsOf(result)).toEqual([HUMAN.actorId, OPEN.actorId, GROUP.actorId])
  })

  it('`include` still hides an agent whose grant is `none`', async () => {
    const result = await caller(
      capabilitiesFor(Level.None, {
        instances: {
          [OPEN_AGENT]: ResourcePermission.view,
          [RESTRICTED_AGENT]: ResourcePermission.none,
        },
      })
    ).list({ target: 'all' })
    expect(idsOf(result)).toEqual([HUMAN.actorId, OPEN.actorId, GROUP.actorId])
  })

  it('`none`: `agents: None` with no grants hides every agent', async () => {
    const result = await caller(capabilitiesFor(Level.None)).list({ target: 'all' })
    expect(idsOf(result)).toEqual([HUMAN.actorId, GROUP.actorId])
  })

  it('`none` on a WORKER seat, whose ceiling closes the area over any grant', async () => {
    // `agents` is absent from `WORKER_AREAS`, so `SEAT_CEILINGS.worker` clamps it
    // to None and `instanceListScope` short-circuits before a single row is read.
    const result = await caller(
      capabilitiesFor(Level.Full, {
        seatType: 'worker',
        instances: { [OPEN_AGENT]: ResourcePermission.admin },
      })
    ).list({ target: 'all' })
    expect(idsOf(result)).toEqual([HUMAN.actorId, GROUP.actorId])
  })

  it('an OWNER keeps every agent, restriction rows and all', async () => {
    // §0.10 recovery guarantee — an owner must always be able to see the agent
    // whose restriction they need to undo.
    const result = await caller(
      capabilitiesFor(Level.Full, {
        role: 'OWNER',
        instances: { [RESTRICTED_AGENT]: ResourcePermission.none },
      })
    ).list({ target: 'all' })
    expect(idsOf(result)).toEqual(idsOf(ALL_ACTORS))
  })
})

describe('actor router — FILTER, never assert (the picker must keep working)', () => {
  it('a member who can see NO agents still gets users and groups from list', async () => {
    const result = await caller(capabilitiesFor(Level.None)).list({ target: 'all' })
    expect(idsOf(result)).toEqual([HUMAN.actorId, GROUP.actorId])
  })

  it('…and from search', async () => {
    const result = await caller(capabilitiesFor(Level.None)).search({ query: 'a', target: 'all' })
    expect(idsOf(result)).toEqual([HUMAN.actorId, GROUP.actorId])
  })

  it('…and from getByIds', async () => {
    const result = await caller(capabilitiesFor(Level.None)).getByIds({
      ids: [HUMAN.actorId, OPEN.actorId, GROUP.actorId],
    })
    expect(Object.keys(result).sort()).toEqual([HUMAN.actorId, GROUP.actorId].sort())
  })

  it('none of the three throws for a member with the agents area shut', async () => {
    // A 403 here would blank the assignee picker, the mention menu and every
    // hydrated ACTOR cell on the page at once.
    const c = caller(capabilitiesFor(Level.None))
    await expect(c.list({ target: 'all' })).resolves.toBeDefined()
    await expect(c.search({ query: 'a', target: 'all' })).resolves.toBeDefined()
    await expect(c.getByIds({ ids: [HUMAN.actorId] })).resolves.toBeDefined()
  })

  it('the service is still asked for the full set — filtering is the router’s job', async () => {
    // Pins WHERE the filter lives. `ActorService` has no capability parameter, so
    // the router must not be quietly narrowing the request instead.
    await caller(restrictedFromOne()).list({ target: 'all', includeAgents: true })
    expect(listActors).toHaveBeenCalledWith({ target: 'all', includeAgents: true })
  })
})
