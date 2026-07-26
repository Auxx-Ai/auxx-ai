// packages/lib/src/permissions/profiles/profile-delete.test.ts

import { MemberType } from '@auxx/database/enums'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Resource } from '../../resources/registry/types'

/**
 * The §8.4 deletion transaction and its preview.
 *
 * Everything here runs against an in-memory fake of the query builder, so writes
 * are visible to the reads that follow them **inside the same transaction** —
 * which is exactly what the two ordering traps are about:
 *
 *  - capturing the holder set **after** the null-out loses it (there is then
 *    nothing pointing at the profile), and
 *  - invalidating **before** commit publishes a capability change that a guard
 *    refusal then rolls back.
 *
 * Both are asserted structurally (an op log over the fake) and semantically (the
 * captured set survives a state in which no binding exists any more).
 */

// ── An introspectable `drizzle-orm`: conditions become plain objects the fake
//    query builder can evaluate against rows. Everything else stays real.
vi.mock('drizzle-orm', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>()
  const col = (x: unknown) =>
    x && typeof x === 'object' && '__col' in (x as Record<string, unknown>)
      ? (x as { __col: string }).__col
      : undefined
  return {
    ...actual,
    eq: (left: unknown, right: unknown) => ({ op: 'eq', left: col(left), right }),
    and: (...parts: unknown[]) => ({ op: 'and', parts: parts.filter(Boolean) }),
    or: (...parts: unknown[]) => ({ op: 'or', parts: parts.filter(Boolean) }),
    inArray: (left: unknown, values: unknown[]) => ({ op: 'inArray', left: col(left), values }),
    isNull: (left: unknown) => ({ op: 'isNull', left: col(left) }),
    isNotNull: (left: unknown) => ({ op: 'isNotNull', left: col(left) }),
  }
})

// ── `@auxx/database`: a schema proxy whose tables and columns are identifiable.
vi.mock('@auxx/database', () => {
  const tables = new Map<string, unknown>()
  return {
    database: {},
    schema: new Proxy(
      {},
      {
        get: (_target, table: string) => {
          if (!tables.has(table)) {
            tables.set(
              table,
              new Proxy(
                { __table: table },
                {
                  get: (_t, column: string) => (column === '__table' ? table : { __col: column }),
                }
              )
            )
          }
          return tables.get(table)
        },
      }
    ),
  }
})

const ORG = 'org_1'
const HR_DEF = 'def_hr_000000000000000000000'
const CONTACTS_DEF = 'def_contacts_0000000000000000'

const RESOURCES = [
  { id: HR_DEF, apiSlug: 'hr', entityDefinitionId: HR_DEF, label: 'HR' },
  { id: CONTACTS_DEF, apiSlug: 'contacts', entityDefinitionId: CONTACTS_DEF, label: 'Contacts' },
] as unknown as Resource[]

/** The org cache, frozen at its PRE-write values — as in `profile-save.test.ts`. */
const staleCache: { profiles: unknown[]; memberRoleMap: Record<string, unknown> } = {
  profiles: [],
  memberRoleMap: {},
}

/** Every `onCacheEvent` the run emitted, in order. */
const cacheEvents: Array<{ event: string; payload: unknown }> = []

vi.mock('../../cache', () => ({
  onCacheEvent: vi.fn(async (event: string, payload: unknown) => {
    cacheEvents.push({ event, payload })
  }),
  getCachedResources: vi.fn(async () => RESOURCES),
  getOrgCache: () => ({
    get: vi.fn(async (_orgId: string, key: string) =>
      key === 'profiles' ? staleCache.profiles : staleCache.memberRoleMap
    ),
  }),
}))
vi.mock('../../dehydration/cache', () => ({
  DehydrationCacheService: class {
    async invalidateUser() {}
    async invalidateOrganization() {}
  },
}))

/**
 * Every capability publish, each stamped with whether the profile row was still
 * in the store when it fired. A publish observed with `profileStillPresent:true`
 * would mean the fan-out ran *before* the deletion committed.
 */
const publishes: Array<{ target: unknown; profileStillPresent: boolean }> = []
/** The store the currently-running test is driving, for the publish stamp. */
const active: { store: { PermissionProfile: Array<Record<string, unknown>> } | null } = {
  store: null,
}

vi.mock('../../realtime', () => ({
  getRealtimeService: () => ({}),
  publishCapabilitiesChanged: vi.fn(async (_service: unknown, target: unknown) => {
    publishes.push({
      target,
      profileStillPresent: !!active.store?.PermissionProfile.some((row) => row.id === 'p_support'),
    })
  }),
}))

const planGate = { allowed: true }
vi.mock('../feature-permission-service', () => ({
  FeaturePermissionService: class {
    async requireAccess() {
      if (!planGate.allowed) throw new Error('PLAN_GATE')
    }
  },
}))

import { ForbiddenError, NotFoundError } from '../../errors'
import { Area, Level } from '../capabilities/registry'
import { deletePermissionProfile, previewPermissionProfileDeletion } from './profile-delete'

// ─────────────────────────────────────────────────────────────────────────────
// A minimal in-memory query builder, plus an op log so ORDER is assertable.
// ─────────────────────────────────────────────────────────────────────────────

type Row = Record<string, unknown>
interface Store {
  OrganizationMember: Row[]
  User: Row[]
  PermissionProfile: Row[]
  PermissionGrant: Row[]
  EntityGroupMember: Row[]
  EntityInstance: Row[]
  ResourceAccess: Row[]
  Agent: Row[]
  AgentVersion: Row[]
  OrganizationInvitation: Row[]
  [table: string]: Row[]
}
/** The untyped condition objects the `drizzle-orm` mock produces. */
type Cond = any

function colOf(x: unknown): string | undefined {
  return x && typeof x === 'object' && '__col' in (x as Record<string, unknown>)
    ? (x as { __col: string }).__col
    : undefined
}

function matches(row: Row, cond: Cond): boolean {
  if (!cond) return true
  switch (cond.op) {
    case 'and':
      return cond.parts.every((part: Cond) => matches(row, part))
    case 'or':
      return cond.parts.some((part: Cond) => matches(row, part))
    case 'eq': {
      const rightCol = colOf(cond.right)
      return rightCol ? row[cond.left] === row[rightCol] : row[cond.left] === cond.right
    }
    case 'inArray':
      return cond.values.includes(row[cond.left])
    case 'isNull':
      return row[cond.left] === null || row[cond.left] === undefined
    case 'isNotNull':
      return row[cond.left] !== null && row[cond.left] !== undefined
    default:
      return true
  }
}

/** Join predicate — accepts either column orientation. */
function joins(left: Row, right: Row, cond: Cond): boolean {
  const rightCol = colOf(cond.right)
  if (!rightCol) return false
  return left[cond.left] === right[rightCol] || right[cond.left] === left[rightCol]
}

class FakeSelect {
  private table = ''
  private readonly joined: Array<{ table: string; on: Cond }> = []
  private cond: Cond = null
  private max: number | undefined

  constructor(
    private readonly store: Store,
    private readonly log: string[],
    private readonly selection?: Record<string, unknown>
  ) {}

  from(table: { __table: string }) {
    this.table = table.__table
    this.log.push(`select:${this.table}`)
    return this
  }
  leftJoin(table: { __table: string }, on: Cond) {
    this.joined.push({ table: table.__table, on })
    return this
  }
  innerJoin(table: { __table: string }, on: Cond) {
    this.joined.push({ table: table.__table, on })
    return this
  }
  where(cond: Cond) {
    this.cond = cond
    return this
  }
  limit(n: number) {
    this.max = n
    return this
  }
  // biome-ignore lint/suspicious/noThenProperty: a thenable IS drizzle's select API
  then<T>(resolve: (rows: Row[]) => T) {
    return Promise.resolve(resolve(this.run()))
  }

  private run(): Row[] {
    let rows: Row[] = (this.store[this.table] ?? []).map((row) => ({ ...row }))
    for (const join of this.joined) {
      const right = this.store[join.table] ?? []
      rows = rows.flatMap((left) => {
        const hits = right.filter((candidate) => joins(left, candidate, join.on))
        return hits.length === 0 ? [left] : hits.map((hit) => ({ ...hit, ...left }))
      })
    }
    rows = rows.filter((row) => matches(row, this.cond))
    if (this.max !== undefined) rows = rows.slice(0, this.max)
    if (!this.selection) return rows
    return rows.map((row) =>
      Object.fromEntries(
        Object.entries(this.selection ?? {}).map(([key, ref]) => [key, row[colOf(ref) ?? key]])
      )
    )
  }
}

function fakeRunner(store: Store, log: string[] = []) {
  const runner = {
    select: (selection?: Record<string, unknown>) => new FakeSelect(store, log, selection),
    insert: (table: { __table: string }) => ({
      values: (row: Row) => ({
        returning: () => {
          const rows = (store[table.__table] ??= [])
          rows.push({ ...row })
          return Promise.resolve([row])
        },
      }),
    }),
    update: (table: { __table: string }) => ({
      set: (patch: Row) => ({
        where: (cond: Cond) => {
          log.push(`update:${table.__table}`)
          for (const row of store[table.__table] ?? []) {
            if (matches(row, cond)) Object.assign(row, patch)
          }
          return Promise.resolve([])
        },
      }),
    }),
    delete: (table: { __table: string }) => ({
      where: (cond: Cond) => {
        log.push(`delete:${table.__table}`)
        store[table.__table] = (store[table.__table] ?? []).filter((row) => !matches(row, cond))
        return Promise.resolve([])
      },
    }),
  }

  return {
    ...runner,
    transaction: async <T>(fn: (tx: typeof runner) => Promise<T>): Promise<T> => {
      const snapshot = structuredClone(store) as Store
      try {
        return await fn(runner)
      } catch (error) {
        // Rollback: a guard refusal (or the preview sentinel) must leave every
        // table exactly as it was.
        for (const key of Object.keys(store)) store[key] = snapshot[key] ?? []
        throw error
      }
    },
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Fixture
// ─────────────────────────────────────────────────────────────────────────────

interface Fixture {
  /**
   * A stored area clamp on the profile being deleted — what deletion REMOVES
   * (§0.24 widening). Unauthored since plan 20 §2.a.1/§2.a.3, so this stands in for
   * a row written before the editor lost the control.
   */
  supportCeiling?: unknown
  /** The same clamp on the ACTOR's profile, to narrow their authority. */
  actorCeiling?: unknown
  /** Give the actor a direct HR grant, so the widening is within their authority. */
  actorHoldsHr?: boolean
  /** Mark the profile as a system template (never deletable). */
  supportIsSystem?: boolean
  /** Flip the profile to `appliesTo: 'agent'` (OWNER/ADMIN-only). */
  supportAppliesTo?: string
  /** The holder's org role — drives which §1.3 template they fall back to. */
  holderRole?: string
  /** The holder's seat class — `worker` falls back to `field_tech`. */
  holderSeat?: string
}

function makeStore(fixture: Fixture = {}): Store {
  const profiles: Row[] = [
    {
      id: 'p_member',
      organizationId: ORG,
      slug: 'member',
      name: 'Member',
      description: null,
      icon: null,
      seat: 'full',
      appliesTo: 'member',
      baseLevel: null,
      ceiling: null,
      agentPolicy: null,
      isSystem: true,
      updatedAt: null,
    },
    {
      id: 'p_field_tech',
      organizationId: ORG,
      slug: 'field_tech',
      name: 'Field tech',
      description: null,
      icon: null,
      seat: 'worker',
      appliesTo: 'member',
      baseLevel: null,
      ceiling: null,
      agentPolicy: null,
      isSystem: true,
      updatedAt: null,
    },
    {
      id: 'p_support',
      organizationId: ORG,
      slug: 'support_rep',
      name: 'Support rep',
      description: null,
      icon: null,
      seat: 'full',
      appliesTo: fixture.supportAppliesTo ?? 'member',
      baseLevel: null,
      ceiling: fixture.supportCeiling ?? null,
      agentPolicy: null,
      isSystem: fixture.supportIsSystem ?? false,
      updatedAt: null,
    },
    {
      id: 'p_actor',
      organizationId: ORG,
      slug: 'ops',
      name: 'Ops',
      description: null,
      icon: null,
      seat: 'full',
      appliesTo: 'member',
      baseLevel: null,
      ceiling: fixture.actorCeiling ?? null,
      agentPolicy: null,
      isSystem: false,
      updatedAt: null,
    },
  ]

  staleCache.profiles = structuredClone(profiles)
  staleCache.memberRoleMap = {
    u_holder: {
      role: fixture.holderRole ?? 'USER',
      seatType: fixture.holderSeat ?? 'full',
      userType: 'USER',
      permissionProfileId: 'p_support',
    },
    u_actor: { role: 'USER', seatType: 'full', userType: 'USER', permissionProfileId: 'p_actor' },
  }

  const resourceAccess: Row[] = [
    // `u_holder` is in a group holding `admin` on HR — a grant the actor never
    // authored, and one deletion leaves untouched.
    {
      organizationId: ORG,
      granteeType: 'group',
      granteeId: 'g_1',
      entityDefinitionId: HR_DEF,
      entityInstanceId: null,
      permission: 'admin',
    },
    // The profile's OWN type row — no FK on `granteeId`, so the delete must
    // remove it explicitly or it outlives the profile.
    {
      organizationId: ORG,
      granteeType: 'profile',
      granteeId: 'p_support',
      entityDefinitionId: CONTACTS_DEF,
      entityInstanceId: null,
      permission: 'view',
    },
    // The actor administers Contacts, so losing the profile's Contacts row is a
    // pure LOSS for the holder and never the reason a test denies. It also keeps
    // Contacts in the org-wide restricted set on BOTH sides of the delete.
    {
      organizationId: ORG,
      granteeType: 'user',
      granteeId: 'u_actor',
      entityDefinitionId: CONTACTS_DEF,
      entityInstanceId: null,
      permission: 'admin',
    },
    // …and its own INSTANCE row. `dashboard` is row-described at birth, so
    // removing this row is a clean loss rather than a fallthrough.
    {
      organizationId: ORG,
      granteeType: 'profile',
      granteeId: 'p_support',
      entityDefinitionId: 'dashboard',
      entityInstanceId: 'dash_1',
      permission: 'view',
    },
  ]
  if (fixture.actorHoldsHr) {
    resourceAccess.push({
      organizationId: ORG,
      granteeType: 'user',
      granteeId: 'u_actor',
      entityDefinitionId: HR_DEF,
      entityInstanceId: null,
      permission: 'admin',
    })
  }

  const store: Store = {
    OrganizationMember: [
      {
        organizationId: ORG,
        userId: 'u_holder',
        role: fixture.holderRole ?? 'USER',
        seatType: fixture.holderSeat ?? 'full',
        permissionProfileId: 'p_support',
      },
      {
        organizationId: ORG,
        userId: 'u_actor',
        role: 'USER',
        seatType: 'full',
        permissionProfileId: 'p_actor',
      },
    ],
    User: [
      { id: 'u_holder', userType: 'USER' },
      { id: 'u_actor', userType: 'USER' },
    ],
    PermissionProfile: profiles,
    PermissionGrant: [
      {
        id: 'pg_support',
        organizationId: ORG,
        granteeType: 'profile',
        granteeId: 'p_support',
        levels: { [Area.records]: Level.Read },
      },
    ],
    EntityGroupMember: [
      { memberRefId: 'u_holder', groupInstanceId: 'g_1', memberType: MemberType.user },
    ],
    EntityInstance: [{ id: 'g_1', organizationId: ORG }],
    ResourceAccess: resourceAccess,
    Agent: [
      {
        id: 'a_published',
        organizationId: ORG,
        slug: 'triage-bot',
        kind: 'internal',
        permissionProfileId: 'p_support',
        activeVersionId: 'v_1',
        hasUnpublishedChanges: false,
      },
      {
        id: 'a_draft_only',
        organizationId: ORG,
        slug: 'concierge',
        kind: 'chat',
        permissionProfileId: 'p_support',
        activeVersionId: null,
        hasUnpublishedChanges: false,
      },
    ],
    AgentVersion: [
      {
        id: 'v_1',
        agentId: 'a_published',
        versionNumber: 3,
        permissionPolicy: { sourceProfileId: 'p_support', areas: {}, definitions: {} },
      },
    ],
    OrganizationInvitation: [
      { id: 'inv_1', organizationId: ORG, permissionProfileId: 'p_support' },
      { id: 'inv_2', organizationId: ORG, permissionProfileId: null },
    ],
  }

  active.store = store as unknown as { PermissionProfile: Array<Record<string, unknown>> }
  return store
}

/** The delete input every test shares. */
function del(store: Store, log?: string[], overrides: Record<string, unknown> = {}) {
  return {
    organizationId: ORG,
    actorUserId: 'u_actor',
    profileId: 'p_support',
    db: fakeRunner(store, log) as never,
    ...overrides,
  }
}

beforeEach(() => {
  planGate.allowed = true
  cacheEvents.length = 0
  publishes.length = 0
})

// ─────────────────────────────────────────────────────────────────────────────

describe('deletePermissionProfile — the §8.4 transaction order', () => {
  it('captures holders INSIDE the txn, BEFORE the bindings are nulled', async () => {
    const store = makeStore({ actorHoldsHr: true })
    const log: string[] = []

    const summary = await deletePermissionProfile(del(store, log))

    // Semantic proof: the captured set survives a post-write state in which
    // NOTHING points at the profile any more. Sweeping after the null-out — the
    // trap §8.4 names — could only have produced an empty set.
    expect(summary.holderIds).toEqual(['u_holder'])
    expect(summary.holderCount).toBe(1)
    expect(
      store.OrganizationMember.filter((row) => row.permissionProfileId === 'p_support')
    ).toHaveLength(0)
    expect(store.PermissionProfile.some((row) => row.id === 'p_support')).toBe(false)

    // Structural proof: at least two member SELECTs (the capture sweep and the
    // pre-write `before` snapshot) precede the first member UPDATE.
    const firstNullOut = log.indexOf('update:OrganizationMember')
    const selectsBefore = log
      .slice(0, firstNullOut)
      .filter((entry) => entry === 'select:OrganizationMember')
    expect(firstNullOut).toBeGreaterThan(-1)
    expect(selectsBefore.length).toBeGreaterThanOrEqual(2)
  })

  it('deletes grant → resource access → profile, after the null-out', async () => {
    const store = makeStore({ actorHoldsHr: true })
    const log: string[] = []

    await deletePermissionProfile(del(store, log))

    const nullOut = log.indexOf('update:OrganizationMember')
    const grant = log.indexOf('delete:PermissionGrant')
    const access = log.indexOf('delete:ResourceAccess')
    const profile = log.indexOf('delete:PermissionProfile')
    expect(nullOut).toBeLessThan(grant)
    expect(grant).toBeLessThan(access)
    expect(access).toBeLessThan(profile)
  })

  it('removes the profile-grantee rows that no FK would cascade', async () => {
    const store = makeStore({ actorHoldsHr: true })

    await deletePermissionProfile(del(store))

    expect(store.PermissionGrant.filter((row) => row.granteeId === 'p_support')).toHaveLength(0)
    // Type row AND instance row — §8.4 names both.
    expect(store.ResourceAccess.filter((row) => row.granteeId === 'p_support')).toHaveLength(0)
    expect(store.ResourceAccess.filter((row) => row.granteeType === 'group')).toHaveLength(1)
  })

  it('nulls bound invitations and reports them', async () => {
    const store = makeStore({ actorHoldsHr: true })

    const summary = await deletePermissionProfile(del(store))

    expect(summary.invitationIds).toEqual(['inv_1'])
    expect(store.OrganizationInvitation.every((row) => !row.permissionProfileId)).toBe(true)
  })
})

describe('deletePermissionProfile — invalidation happens AFTER commit', () => {
  it('publishes only once the profile row is already gone', async () => {
    const store = makeStore({ actorHoldsHr: true })

    await deletePermissionProfile(del(store))

    expect(publishes.length).toBeGreaterThan(0)
    // A publish observed while the row still existed would be a pre-commit
    // fan-out — the second trap §8.4 names.
    expect(publishes.every((entry) => entry.profileStillPresent)).toBe(false)
    expect(
      publishes.some((entry) => (entry.target as { userId?: string }).userId === 'u_holder')
    ).toBe(true)

    const events = cacheEvents.map((entry) => entry.event)
    expect(events).toContain('permission-profile.changed')
    // The profile's grant row went away, so `hasPermissionGrants` may have flipped.
    expect(events).toContain('permission-grant.changed')
    expect(events).toContain('agent.updated')
  })

  it('emits NOTHING when the guard rolls the transaction back', async () => {
    const store = makeStore({
      supportCeiling: { areas: { [Area.records]: Level.None } },
      actorCeiling: { areas: { [Area.records]: Level.None } },
    })

    await expect(deletePermissionProfile(del(store))).rejects.toBeInstanceOf(ForbiddenError)

    expect(publishes).toHaveLength(0)
    expect(cacheEvents).toHaveLength(0)
    // …and the rollback left every table intact.
    expect(store.PermissionProfile.some((row) => row.id === 'p_support')).toBe(true)
    expect(
      store.OrganizationMember.find((row) => row.userId === 'u_holder')?.permissionProfileId
    ).toBe('p_support')
    expect(store.PermissionGrant).toHaveLength(1)
  })
})

describe('deletePermissionProfile — the §6.1.3 escalation guard', () => {
  it('DENIES a deletion whose system-template fallback widens past the actor', async () => {
    // The support profile clamps Records to None. Deleting it takes the clamp with
    // it, so the holder rises to the USER role default — above the actor, whose own
    // profile still clamps Records to None.
    const store = makeStore({
      supportCeiling: { areas: { [Area.records]: Level.None } },
      actorCeiling: { areas: { [Area.records]: Level.None } },
    })

    await expect(deletePermissionProfile(del(store))).rejects.toThrow(
      /cannot grant access you do not hold/i
    )
  })

  it('PERMITS the same deletion for an actor who holds that area level', async () => {
    const store = makeStore({ supportCeiling: { areas: { [Area.records]: Level.None } } })

    const summary = await deletePermissionProfile(del(store))

    expect(summary.areaDeltas.some((d) => d.area === Area.records && d.direction === 'gain')).toBe(
      true
    )
  })

  it('OWNER short-circuits the guard (§0.10 recovery guarantee)', async () => {
    const store = makeStore({
      supportCeiling: { areas: { [Area.records]: Level.None } },
      actorCeiling: { areas: { [Area.records]: Level.None } },
    })
    const actor = store.OrganizationMember.find((row) => row.userId === 'u_actor')
    if (actor) actor.role = 'OWNER'

    await expect(deletePermissionProfile(del(store))).resolves.toBeDefined()
  })
})

describe('deletePermissionProfile — §0.24 fallback semantics', () => {
  it('reports the system template holders return to', async () => {
    const store = makeStore({ actorHoldsHr: true })

    const summary = await deletePermissionProfile(del(store))

    expect(summary.fallbacks).toEqual([{ slug: 'member', profileId: 'p_member', holderCount: 1 }])
  })

  it('sends a worker-seat holder to field_tech, not member', async () => {
    const store = makeStore({ actorHoldsHr: true, holderSeat: 'worker' })

    const summary = await deletePermissionProfile(del(store))

    expect(summary.fallbacks).toEqual([
      { slug: 'field_tech', profileId: 'p_field_tech', holderCount: 1 },
    ])
  })

  it('surfaces the access delta the delete dialog renders', async () => {
    const store = makeStore({
      supportCeiling: { areas: { [Area.records]: Level.None } },
      actorHoldsHr: true,
    })

    const summary = await deletePermissionProfile(del(store))

    expect(summary.deltaExact).toBe(true)
    const records = summary.areaDeltas.find((delta) => delta.area === Area.records)
    expect(records).toMatchObject({ label: 'Records', from: Level.None, direction: 'gain' })
    expect(records?.to).toBeGreaterThan(Level.None)
    expect(records?.holderCount).toBe(1)
    // Gains lead — §0.24's warning is that deletion can WIDEN.
    expect(summary.areaDeltas[0]?.direction).toBe('gain')
    // Losing the profile's own instance row is a LOSS on the dashboard.
    expect(summary.instanceDeltas).toEqual([
      { id: 'dash_1', from: 'view', to: null, direction: 'loss', holderCount: 1 },
    ])
  })

  it('labels definition deltas with the resource apiSlug', async () => {
    // The profile's own `view` row on Contacts dies with it, so the holder LOSES
    // Contacts — the def delta the dialog has to name.
    const store = makeStore({ actorHoldsHr: true })

    const summary = await deletePermissionProfile(del(store))

    const contacts = summary.defDeltas.find((delta) => delta.id === CONTACTS_DEF)
    expect(contacts).toMatchObject({
      apiSlug: 'contacts',
      label: 'Contacts',
      from: 'view',
      direction: 'loss',
    })
  })

  it('rebinds draft agents by kind and marks only the published one dirty', async () => {
    const store = makeStore({ actorHoldsHr: true })

    const summary = await deletePermissionProfile(del(store))

    expect(summary.agentDrafts).toEqual([
      {
        id: 'a_published',
        slug: 'triage-bot',
        kind: 'internal',
        fallbackSlug: 'agent',
        markedDirty: true,
      },
      {
        id: 'a_draft_only',
        slug: 'concierge',
        kind: 'chat',
        fallbackSlug: 'chat_agent',
        markedDirty: false,
      },
    ])
    expect(store.Agent.every((row) => row.permissionProfileId === null)).toBe(true)
    expect(store.Agent.find((row) => row.id === 'a_published')?.hasUnpublishedChanges).toBe(true)
    // A never-published draft has no baseline to be unpublished against.
    expect(store.Agent.find((row) => row.id === 'a_draft_only')?.hasUnpublishedChanges).toBe(false)
  })

  it('leaves published AgentVersion snapshots byte-identical and lists them as unchanged', async () => {
    const store = makeStore({ actorHoldsHr: true })
    const policyBefore = structuredClone(store.AgentVersion[0]?.permissionPolicy)

    const summary = await deletePermissionProfile(del(store))

    expect(summary.publishedVersions).toHaveLength(1)
    expect(summary.publishedVersions[0]).toMatchObject({
      agentId: 'a_published',
      agentSlug: 'triage-bot',
      versionNumber: 3,
      unchanged: true,
    })
    expect(store.AgentVersion).toHaveLength(1)
    expect(store.AgentVersion[0]?.permissionPolicy).toEqual(policyBefore)
  })
})

describe('deletePermissionProfile — governance', () => {
  it('refuses a system profile outright (§0.24 — a template must always exist)', async () => {
    const store = makeStore({ supportIsSystem: true })

    await expect(deletePermissionProfile(del(store))).rejects.toThrow(/system profile/i)
    expect(store.PermissionProfile.some((row) => row.id === 'p_support')).toBe(true)
  })

  it('refuses a cross-org profile id', async () => {
    const store = makeStore({})

    await expect(
      deletePermissionProfile(del(store, undefined, { organizationId: 'org_other' }))
    ).rejects.toBeInstanceOf(NotFoundError)
  })

  it('keeps agent-profile deletion OWNER/ADMIN-only (§0.25 / doc 14 §0.9)', async () => {
    const store = makeStore({ supportAppliesTo: 'agent', actorHoldsHr: true })

    await expect(deletePermissionProfile(del(store))).rejects.toThrow(/owners and admins/i)

    const actor = store.OrganizationMember.find((row) => row.userId === 'u_actor')
    if (actor) actor.role = 'ADMIN'
    await expect(deletePermissionProfile(del(store))).resolves.toBeDefined()
  })

  it('plan-gates the WRITE (§0.26)', async () => {
    planGate.allowed = false
    const store = makeStore({})

    await expect(deletePermissionProfile(del(store))).rejects.toThrow('PLAN_GATE')
  })
})

describe('previewPermissionProfileDeletion — read-only', () => {
  it('computes the identical delta and writes NOTHING', async () => {
    const store = makeStore({
      supportCeiling: { areas: { [Area.records]: Level.None } },
      actorHoldsHr: true,
    })
    const before = structuredClone(store)

    const preview = await previewPermissionProfileDeletion(del(store))

    expect(preview.blockedReason).toBeNull()
    expect(preview.holderIds).toEqual(['u_holder'])
    expect(preview.areaDeltas.some((d) => d.area === Area.records && d.direction === 'gain')).toBe(
      true
    )
    expect(preview.publishedVersions).toHaveLength(1)
    // Rolled back: every table is exactly as it was, and nothing was published.
    expect(store).toEqual(before)
    expect(publishes).toHaveLength(0)
    expect(cacheEvents).toHaveLength(0)

    // …and committing produces the same delta the dialog just showed.
    const summary = await deletePermissionProfile(del(store))
    expect(summary.defDeltas).toEqual(preview.defDeltas)
    expect(summary.areaDeltas).toEqual(preview.areaDeltas)
    expect(summary.fallbacks).toEqual(preview.fallbacks)
  })

  it('reports a guard refusal as blockedReason instead of throwing', async () => {
    const store = makeStore({
      supportCeiling: { areas: { [Area.records]: Level.None } },
      actorCeiling: { areas: { [Area.records]: Level.None } },
    })
    const before = structuredClone(store)

    const preview = await previewPermissionProfileDeletion(del(store))

    expect(preview.blockedReason).toMatch(/cannot grant access you do not hold/i)
    // The dialog still gets the delta it needs to explain WHY.
    expect(preview.areaDeltas.some((d) => d.area === Area.records && d.direction === 'gain')).toBe(
      true
    )
    expect(store).toEqual(before)
  })

  it('still throws the governance refusals, so the dialog never offers a dead delete', async () => {
    const store = makeStore({ supportIsSystem: true })

    await expect(previewPermissionProfileDeletion(del(store))).rejects.toThrow(/system profile/i)
  })
})
