// packages/lib/src/members/assign-profile.test.ts

import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * `member.assignProfile`'s guard set (plan 21 §7). Assignment writes the
 * member's rank from the profile's declared role, so it inherits every guard
 * `updateMemberRole` owns — each case below is what keeps the profile picker
 * from becoming a privilege-escalation control.
 */

// ── An introspectable `drizzle-orm`: conditions become plain objects the fake
//    query builder evaluates against rows. `count()` and the rest stay real.
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

/** Permission keys the base gate asked for, in order (§7 row 1). */
const keysRequested: string[] = []
vi.mock('../permissions/capabilities/require', () => ({
  requirePermission: vi.fn(async (_userId: string, _orgId: string, key: string) => {
    keysRequested.push(key)
  }),
}))

// `loadInvitableProfile` lives beside `recordAudit`; nothing here writes one.
vi.mock('../audit-log', () => ({ recordAudit: vi.fn(async () => ({ isErr: () => false })) }))

/**
 * Membership lookups. In production these come from the ORG CACHE while the
 * owner count is a live DB read, so the two can disagree — which is what the
 * last-owner test below simulates through {@link membershipOverrides}.
 */
vi.mock('./member-queries', () => ({
  findMemberByUser: vi.fn(async (_orgId: string, userId: string) => {
    return membershipOverrides[userId] ?? store.OrganizationMember.find((r) => r.userId === userId)
  }),
}))

// The post-commit tail (§7's cache/dehydration/publish row).
const tail = { cacheEvents: [] as string[], invalidated: [] as string[], published: [] as string[] }
vi.mock('../cache', () => ({
  onCacheEvent: vi.fn(async (event: string) => {
    tail.cacheEvents.push(event)
  }),
  getOrgCache: () => ({ getOrRecompute: async () => ({ members: [] }) }),
}))
vi.mock('../dehydration/cache', () => ({
  DehydrationCacheService: class {
    async invalidateUser(userId: string) {
      tail.invalidated.push(userId)
    }
  },
}))
vi.mock('../realtime', () => ({
  getRealtimeService: () => ({}),
  publishCapabilitiesChanged: vi.fn(async (_service: unknown, input: { userId: string }) => {
    tail.published.push(input.userId)
  }),
}))

/**
 * The effective-state composer, faked but **live**: it reads the member row out
 * of the store at call time, so the `after` snapshot genuinely reflects the
 * binding written earlier in the transaction. A frozen fake would make the
 * escalation assertions pass vacuously.
 */
vi.mock('../permissions/profiles/effective-state', () => ({
  computeEffectiveStatesUncached: vi.fn(async ({ userIds }: { userIds: string[] }) => {
    const out = new Map<string, unknown>()
    for (const userId of userIds) out.set(userId, composeFakeState(userId))
    return out
  }),
}))

import { BadRequestError, ForbiddenError } from '../errors'
import { AREA_ORDER, Area, Level } from '../permissions/capabilities/registry'
import { assignMemberProfile } from './assign-profile'

const ORG = 'org_1'

type Row = Record<string, unknown>
interface Store {
  OrganizationMember: Row[]
  PermissionProfile: Row[]
  [table: string]: Row[]
}

/** The store the fake db and the fake composer both read. */
let store: Store
/** Memberships that deliberately disagree with the store (the cache/DB drift). */
let membershipOverrides: Record<string, Row | undefined>
/** Patches passed to `update().set()`, in order — proves what is written. */
let patches: Row[]
/** Per-profile area levels the fake composer reports for that profile's holder. */
let profileAreas: Record<string, Partial<Record<Area, Level>>>

function areasOf(levels: Partial<Record<Area, Level>> = {}): Record<Area, Level> {
  const areas = {} as Record<Area, Level>
  for (const area of AREA_ORDER) areas[area] = levels[area] ?? Level.None
  return areas
}

function composeFakeState(userId: string) {
  const member = store.OrganizationMember.find((row) => row.userId === userId)
  const profileId = (member?.permissionProfileId as string | null) ?? '__unbound__'
  return { userId, areas: areasOf(profileAreas[profileId]), defs: {}, instances: {} }
}

// ─────────────────────────────────────────────────────────────────────────────
// A minimal in-memory query builder — enough of drizzle's surface for the assign.
// ─────────────────────────────────────────────────────────────────────────────

type Cond = any

function colOf(x: unknown): string | undefined {
  return x && typeof x === 'object' && '__col' in (x as Record<string, unknown>)
    ? (x as { __col: string }).__col
    : undefined
}

function matches(row: Row, cond: Cond): boolean {
  if (!cond) return true
  if (cond.op === 'and') return cond.parts.every((part: Cond) => matches(row, part))
  if (cond.op === 'eq') return row[cond.left] === cond.right
  return true
}

class FakeSelect {
  private table = ''
  private cond: Cond = null
  private max: number | undefined

  constructor(private readonly selection?: Record<string, unknown>) {}

  from(table: { __table: string }) {
    this.table = table.__table
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
    let rows = (store[this.table] ?? []).filter((row) => matches(row, this.cond))
    if (this.max !== undefined) rows = rows.slice(0, this.max)
    const selection = this.selection
    if (!selection) return rows.map((row) => ({ ...row }))
    const entries = Object.entries(selection)
    // `select({ value: count() })` — the aggregate has no column to project.
    if (entries.length === 1 && entries[0] && colOf(entries[0][1]) === undefined) {
      return [{ [entries[0][0]]: rows.length }]
    }
    return rows.map((row) =>
      Object.fromEntries(entries.map(([key, ref]) => [key, row[colOf(ref) ?? key]]))
    )
  }
}

function fakeDb() {
  const runner = {
    select: (selection?: Record<string, unknown>) => new FakeSelect(selection),
    update: (table: { __table: string }) => ({
      set: (patch: Row) => ({
        where: (cond: Cond) => {
          patches.push(patch)
          for (const row of store[table.__table] ?? []) {
            if (matches(row, cond)) Object.assign(row, patch)
          }
          return Promise.resolve([])
        },
      }),
    }),
  }
  return {
    ...runner,
    transaction: async <T>(fn: (tx: typeof runner) => Promise<T>): Promise<T> => {
      const snapshot = structuredClone(store) as Store
      try {
        return await fn(runner)
      } catch (error) {
        // Rollback: a guard throwing must leave the binding exactly as it was.
        for (const key of Object.keys(store)) store[key] = snapshot[key] ?? []
        throw error
      }
    },
  } as never
}

// ─────────────────────────────────────────────────────────────────────────────
// Fixture
// ─────────────────────────────────────────────────────────────────────────────

function member(userId: string, over: Row = {}): Row {
  return {
    id: `m_${userId}`,
    organizationId: ORG,
    userId,
    role: 'USER',
    seatType: 'full',
    status: 'ACTIVE',
    onChatDuty: false,
    permissionProfileId: 'p_member',
    ...over,
  }
}

function profile(id: string, over: Row = {}): Row {
  return {
    id,
    organizationId: ORG,
    slug: id.replace('p_', ''),
    name: id,
    seat: 'full',
    appliesTo: 'member',
    role: 'USER',
    ...over,
  }
}

function rowOf(userId: string): Row | undefined {
  return store.OrganizationMember.find((row) => row.userId === userId)
}

beforeEach(() => {
  keysRequested.length = 0
  tail.cacheEvents = []
  tail.invalidated = []
  tail.published = []
  patches = []
  membershipOverrides = {}
  // Every profile composes to nothing by default, so only the tests that care
  // about the §6.1 guard have to reason about effective state.
  profileAreas = {}
  store = {
    OrganizationMember: [
      member('u_owner', { role: 'OWNER', permissionProfileId: 'p_owner' }),
      member('u_admin', { role: 'ADMIN', permissionProfileId: 'p_admin' }),
      member('u_admin2', { role: 'ADMIN', permissionProfileId: 'p_admin' }),
      member('u_target'),
      member('u_grantee'),
      member('u_field', { seatType: 'worker', permissionProfileId: 'p_field_tech' }),
    ],
    PermissionProfile: [
      profile('p_owner', { role: 'OWNER' }),
      profile('p_admin', { role: 'ADMIN' }),
      profile('p_member'),
      profile('p_support'),
      profile('p_field_tech', { seat: 'worker' }),
      profile('p_agent', { appliesTo: 'agent' }),
    ],
  }
})

// ─────────────────────────────────────────────────────────────────────────────

describe('assignMemberProfile — the §7 guard set', () => {
  it('gates on members.manage AND permissions.manage', async () => {
    await assignMemberProfile(
      {
        organizationId: ORG,
        actorUserId: 'u_owner',
        memberUserId: 'u_target',
        permissionProfileId: 'p_support',
      },
      fakeDb()
    )
    expect(keysRequested).toEqual(['members.manage', 'permissions.manage'])
  })

  it('refuses a USER-rank members.manage grantee assigning the Admin profile', async () => {
    // The rank guard runs against the profile's DECLARED role, so holding
    // `members.manage` never lets a USER mint an Admin.
    await expect(
      assignMemberProfile(
        {
          organizationId: ORG,
          actorUserId: 'u_grantee',
          memberUserId: 'u_target',
          permissionProfileId: 'p_admin',
        },
        fakeDb()
      )
    ).rejects.toThrow(/don't have permission to assign/i)
    expect(rowOf('u_target')?.permissionProfileId).toBe('p_member')
    expect(patches).toHaveLength(0)
  })

  it('refuses an Admin reassigning an Admin peer', async () => {
    await expect(
      assignMemberProfile(
        {
          organizationId: ORG,
          actorUserId: 'u_admin',
          memberUserId: 'u_admin2',
          permissionProfileId: 'p_support',
        },
        fakeDb()
      )
    ).rejects.toThrow(/other Admins/i)
  })

  it('refuses a non-Owner touching an Owner', async () => {
    await expect(
      assignMemberProfile(
        {
          organizationId: ORG,
          actorUserId: 'u_admin',
          memberUserId: 'u_owner',
          permissionProfileId: 'p_support',
        },
        fakeDb()
      )
    ).rejects.toThrow(/Only Owners can manage Owner roles/i)
  })

  it('fires last-owner protection when the only Owner is moved off Owner rank', async () => {
    // The actor is an Owner per the membership lookup (the org cache in
    // production) while the org's live OWNER count is 1 — the drift this guard
    // is defence in depth against. The error is `updateMemberRole`'s, verbatim.
    membershipOverrides.u_owner2 = {
      id: 'm_owner2',
      userId: 'u_owner2',
      organizationId: ORG,
      role: 'OWNER',
      seatType: 'full',
    }

    await expect(
      assignMemberProfile(
        {
          organizationId: ORG,
          actorUserId: 'u_owner2',
          memberUserId: 'u_owner',
          permissionProfileId: 'p_support',
        },
        fakeDb()
      )
    ).rejects.toThrow('Cannot change the role of the only Owner. Transfer ownership first.')
    expect(rowOf('u_owner')?.permissionProfileId).toBe('p_owner')
    expect(patches).toHaveLength(0)
  })

  it('lets an Owner reassign another Owner once a second Owner exists', async () => {
    store.OrganizationMember.push(member('u_owner2', { role: 'OWNER' }))
    await assignMemberProfile(
      {
        organizationId: ORG,
        actorUserId: 'u_owner2',
        memberUserId: 'u_owner',
        permissionProfileId: 'p_support',
      },
      fakeDb()
    )
    expect(rowOf('u_owner')).toMatchObject({ permissionProfileId: 'p_support', role: 'USER' })
  })

  it('refuses a cross-seat assignment rather than migrating the member', async () => {
    await expect(
      assignMemberProfile(
        {
          organizationId: ORG,
          actorUserId: 'u_owner',
          memberUserId: 'u_target',
          permissionProfileId: 'p_field_tech',
        },
        fakeDb()
      )
    ).rejects.toBeInstanceOf(BadRequestError)
    expect(patches).toHaveLength(0)
  })

  it('never writes seatType on a successful assign', async () => {
    await assignMemberProfile(
      {
        organizationId: ORG,
        actorUserId: 'u_owner',
        memberUserId: 'u_target',
        permissionProfileId: 'p_support',
      },
      fakeDb()
    )
    expect(patches).toHaveLength(1)
    expect(patches[0]).not.toHaveProperty('seatType')
  })

  it('refuses the Owner profile — assigning it would be an ownership transfer', async () => {
    await expect(
      assignMemberProfile(
        {
          organizationId: ORG,
          actorUserId: 'u_owner',
          memberUserId: 'u_target',
          permissionProfileId: 'p_owner',
        },
        fakeDb()
      )
    ).rejects.toThrow(/Owner profile cannot be assigned/i)
  })

  it('refuses an agent-only profile and one owned by another organization', async () => {
    await expect(
      assignMemberProfile(
        {
          organizationId: ORG,
          actorUserId: 'u_owner',
          memberUserId: 'u_target',
          permissionProfileId: 'p_agent',
        },
        fakeDb()
      )
    ).rejects.toThrow(/agents, not members/i)

    const foreign = store.PermissionProfile.find((row) => row.id === 'p_support')
    if (foreign) foreign.organizationId = 'org_other'
    await expect(
      assignMemberProfile(
        {
          organizationId: ORG,
          actorUserId: 'u_owner',
          memberUserId: 'u_target',
          permissionProfileId: 'p_support',
        },
        fakeDb()
      )
    ).rejects.toThrow(/another organization/i)
  })

  it('refuses self-service', async () => {
    await expect(
      assignMemberProfile(
        {
          organizationId: ORG,
          actorUserId: 'u_admin',
          memberUserId: 'u_admin',
          permissionProfileId: 'p_support',
        },
        fakeDb()
      )
    ).rejects.toThrow(/your own permission profile/i)
  })

  it('keeps the worker ⇒ USER invariant as a server-side refusal', async () => {
    // Unauthorable from any UI (§3.5) — a direct API caller must still be refused.
    const contradiction = store.PermissionProfile.find((row) => row.id === 'p_field_tech')
    if (contradiction) contradiction.role = 'ADMIN'
    await expect(
      assignMemberProfile(
        {
          organizationId: ORG,
          actorUserId: 'u_owner',
          memberUserId: 'u_field',
          permissionProfileId: 'p_field_tech',
        },
        fakeDb()
      )
    ).rejects.toThrow(/field seat, which is limited to the Member role/i)
  })
})

describe('assignMemberProfile — the write', () => {
  it('writes permissionProfileId AND the profile’s declared role in one update', async () => {
    const result = await assignMemberProfile(
      {
        organizationId: ORG,
        actorUserId: 'u_owner',
        memberUserId: 'u_target',
        permissionProfileId: 'p_admin',
      },
      fakeDb()
    )

    expect(result).toMatchObject({ success: true, permissionProfileId: 'p_admin', role: 'ADMIN' })
    expect(rowOf('u_target')).toMatchObject({ permissionProfileId: 'p_admin', role: 'ADMIN' })
    expect(patches).toHaveLength(1)
    expect(patches[0]).toMatchObject({ permissionProfileId: 'p_admin', role: 'ADMIN' })
    expect(tail.cacheEvents).toEqual(['member.role.changed'])
    expect(tail.invalidated).toEqual(['u_target'])
    expect(tail.published).toEqual(['u_target'])
  })

  it('DEMOTES an Admin moved onto a custom (USER-rank) profile — §2.0.2', async () => {
    const result = await assignMemberProfile(
      {
        organizationId: ORG,
        actorUserId: 'u_owner',
        memberUserId: 'u_admin',
        permissionProfileId: 'p_support',
      },
      fakeDb()
    )

    expect(result.role).toBe('USER')
    expect(rowOf('u_admin')).toMatchObject({ permissionProfileId: 'p_support', role: 'USER' })
  })

  it('unbinds without touching the rank', async () => {
    // A null binding resolves to the system template for the rank the member
    // already holds, so there is no declared role to write.
    await assignMemberProfile(
      {
        organizationId: ORG,
        actorUserId: 'u_owner',
        memberUserId: 'u_admin',
        permissionProfileId: null,
      },
      fakeDb()
    )

    expect(rowOf('u_admin')).toMatchObject({ permissionProfileId: null, role: 'ADMIN' })
  })
})

describe('assignMemberProfile — the §6.1 escalation guard', () => {
  it('DENIES an assignment that raises the member above the actor’s own access', async () => {
    profileAreas = {
      p_support: { [Area.records]: Level.Full },
      // The actor holds that area only at Read, so the raise is above them.
      p_grantee: { [Area.records]: Level.Read },
    }
    const grantee = rowOf('u_grantee')
    if (grantee) grantee.permissionProfileId = 'p_grantee'

    await expect(
      assignMemberProfile(
        {
          organizationId: ORG,
          actorUserId: 'u_grantee',
          memberUserId: 'u_target',
          permissionProfileId: 'p_support',
        },
        fakeDb()
      )
    ).rejects.toBeInstanceOf(ForbiddenError)
    // The guard runs post-write inside the transaction, so the binding rolls back.
    expect(rowOf('u_target')?.permissionProfileId).toBe('p_member')
  })

  it('PERMITS the same assignment when the actor holds that access themselves', async () => {
    profileAreas = {
      p_support: { [Area.records]: Level.Full },
      p_grantee: { [Area.records]: Level.Full },
    }
    const grantee = rowOf('u_grantee')
    if (grantee) grantee.permissionProfileId = 'p_grantee'

    await assignMemberProfile(
      {
        organizationId: ORG,
        actorUserId: 'u_grantee',
        memberUserId: 'u_target',
        permissionProfileId: 'p_support',
      },
      fakeDb()
    )
    expect(rowOf('u_target')?.permissionProfileId).toBe('p_support')
  })
})
