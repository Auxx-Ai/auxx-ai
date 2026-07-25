// packages/lib/src/permissions/profiles/profile-save.test.ts

import { MemberType } from '@auxx/database/enums'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Resource } from '../../resources/registry/types'

/**
 * The transactional save (§6.1.4) and the cache-bypassing composer it depends on.
 *
 * These tests run against an in-memory fake of the query builder, so writes are
 * visible to the reads that follow them **inside the same transaction** — which
 * is the whole point: `computeEffectiveStatesUncached` must see post-write state
 * while `getOrgCache()` deliberately keeps serving the PRE-write projection.
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
  { id: HR_DEF, apiSlug: 'hr', entityDefinitionId: HR_DEF },
  { id: CONTACTS_DEF, apiSlug: 'contacts', entityDefinitionId: CONTACTS_DEF },
] as unknown as Resource[]

/**
 * The org cache, deliberately frozen at its PRE-write values for the whole test.
 * If the composer resolved profiles through this instead of the transaction, the
 * `after` snapshot would equal `before` and every escalation test below would
 * pass vacuously.
 */
const staleCache: { profiles: unknown[]; memberRoleMap: Record<string, unknown> } = {
  profiles: [],
  memberRoleMap: {},
}

vi.mock('../../cache', () => ({
  onCacheEvent: vi.fn(async () => {}),
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
vi.mock('../../realtime', () => ({
  getRealtimeService: () => ({}),
  publishCapabilitiesChanged: vi.fn(async () => {}),
}))

const planGate = { allowed: true }
vi.mock('../feature-permission-service', () => ({
  FeaturePermissionService: class {
    async requireAccess() {
      if (!planGate.allowed) throw new Error('PLAN_GATE')
    }
  },
}))

import { ForbiddenError } from '../../errors'
import { Area, Level } from '../capabilities/registry'
import { computeEffectiveStatesUncached } from './effective-state'
import { assertNoEscalation } from './escalation-guard'
import { savePermissionProfile } from './profile-save'

// ─────────────────────────────────────────────────────────────────────────────
// A minimal in-memory query builder: enough of drizzle's surface for the save.
// ─────────────────────────────────────────────────────────────────────────────

type Row = Record<string, unknown>
/**
 * The fake's tables. The named tables are declared so fixture code reads them
 * without a null dance; the index signature is what the query builder walks.
 */
interface Store {
  OrganizationMember: Row[]
  User: Row[]
  PermissionProfile: Row[]
  PermissionGrant: Row[]
  EntityGroupMember: Row[]
  EntityInstance: Row[]
  ResourceAccess: Row[]
  [table: string]: Row[]
}
/**
 * The untyped condition objects the `drizzle-orm` mock above produces —
 * recursive and deliberately shapeless, so the fake reads them structurally.
 */
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
    private readonly selection?: Record<string, unknown>
  ) {}

  from(table: { __table: string }) {
    this.table = table.__table
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

function fakeRunner(store: Store) {
  // Split from `transaction` below so the object literal does not reference its
  // own inferred type (TS7022) — the txn handle is the same runner minus nesting.
  const runner = {
    select: (selection?: Record<string, unknown>) => new FakeSelect(store, selection),
    insert: (table: { __table: string }) => ({
      values: (row: Row) => ({
        onConflictDoUpdate: ({ target, set }: { target: unknown[]; set: Row }) => {
          const keys = target.map((ref) => colOf(ref) as string)
          const rows = (store[table.__table] ??= [])
          const existing = rows.find((candidate) =>
            keys.every((key) => candidate[key] === row[key])
          )
          if (existing) Object.assign(existing, set)
          else rows.push({ ...row })
          return Promise.resolve([existing ?? row])
        },
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
          for (const row of store[table.__table] ?? []) {
            if (matches(row, cond)) Object.assign(row, patch)
          }
          return Promise.resolve([])
        },
      }),
    }),
    delete: (table: { __table: string }) => ({
      where: (cond: Cond) => {
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
        // Rollback: the guard throwing must leave every table as it was.
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
  /** The custom profile `u_holder` is bound to. */
  supportCeiling?: unknown
  /** Sparse levels stored on the support profile's grant row. */
  supportLevels?: Record<string, number>
  /** A ceiling on the ACTOR's own profile (used to narrow the actor). */
  actorCeiling?: unknown
  /**
   * Add `u_null`, a member with a **null** binding — the §6.1.3 majority case.
   * No row points at the `member` system profile, so the
   * `(organizationId, permissionProfileId)` index alone would return nobody.
   */
  nullBoundHolder?: boolean
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
      id: 'p_support',
      organizationId: ORG,
      slug: 'support_rep',
      name: 'Support rep',
      description: null,
      icon: null,
      seat: 'full',
      appliesTo: 'member',
      baseLevel: null,
      ceiling: fixture.supportCeiling ?? null,
      agentPolicy: null,
      isSystem: false,
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

  const grants: Row[] = []
  if (fixture.supportLevels) {
    grants.push({
      id: 'pg_support',
      organizationId: ORG,
      granteeType: 'profile',
      granteeId: 'p_support',
      levels: fixture.supportLevels,
    })
  }

  staleCache.profiles = structuredClone(profiles)
  staleCache.memberRoleMap = {
    u_holder: {
      role: 'USER',
      seatType: 'full',
      userType: 'USER',
      permissionProfileId: 'p_support',
    },
    u_actor: { role: 'USER', seatType: 'full', userType: 'USER', permissionProfileId: 'p_actor' },
  }

  if (fixture.nullBoundHolder) {
    staleCache.memberRoleMap.u_null = {
      role: 'USER',
      seatType: 'full',
      userType: 'USER',
      permissionProfileId: null,
    }
  }

  const store: Store = {
    OrganizationMember: [
      {
        organizationId: ORG,
        userId: 'u_holder',
        role: 'USER',
        seatType: 'full',
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
    PermissionGrant: grants,
    // `u_holder` is in a group that already holds `admin` on the HR definition —
    // a grant the actor never authored (§6.1 unsoundness mode 1).
    EntityGroupMember: [
      { memberRefId: 'u_holder', groupInstanceId: 'g_1', memberType: MemberType.user },
    ],
    EntityInstance: [{ id: 'g_1', organizationId: ORG }],
    ResourceAccess: [
      {
        organizationId: ORG,
        granteeType: 'group',
        granteeId: 'g_1',
        entityDefinitionId: HR_DEF,
        entityInstanceId: null,
        permission: 'admin',
      },
    ],
  }

  if (fixture.nullBoundHolder) {
    store.OrganizationMember.push({
      organizationId: ORG,
      userId: 'u_null',
      role: 'USER',
      seatType: 'full',
      permissionProfileId: null,
    })
    store.User.push({ id: 'u_null', userType: 'USER' })
  }

  return store
}

beforeEach(() => {
  planGate.allowed = true
})

// ─────────────────────────────────────────────────────────────────────────────

describe('computeEffectiveStatesUncached — the §6.1.4 cache bypass', () => {
  it('composes from the TRANSACTION, not the org cache', async () => {
    // The store says the profile excludes every definition; the cached `profiles`
    // projection (which `computeUserCapabilities` would have used) says it is
    // uncapped. Reading the cache here would report HR access the holder does not
    // have — and, inside a save, would make `after` identical to `before`.
    const store = makeStore({ supportCeiling: { defs: { mode: 'only', slugs: [] } } })
    staleCache.profiles = structuredClone(store.PermissionProfile).map((row) => ({
      ...row,
      ceiling: null,
    }))

    const states = await computeEffectiveStatesUncached({
      organizationId: ORG,
      userIds: ['u_holder'],
      tx: fakeRunner(store) as never,
    })

    expect(states.get('u_holder')?.defs).toEqual({})
  })

  it('sees a write made earlier in the same transaction', async () => {
    const store = makeStore({ supportCeiling: { defs: { mode: 'only', slugs: [] } } })
    const before = await computeEffectiveStatesUncached({
      organizationId: ORG,
      userIds: ['u_holder'],
      tx: fakeRunner(store) as never,
    })
    expect(before.get('u_holder')?.defs).toEqual({})

    const profile = store.PermissionProfile.find((row) => row.id === 'p_support')
    if (profile) profile.ceiling = null

    const after = await computeEffectiveStatesUncached({
      organizationId: ORG,
      userIds: ['u_holder'],
      tx: fakeRunner(store) as never,
    })
    // The pre-existing group grant on HR is now visible — nothing about the
    // grant changed, only the ceiling above it.
    expect(after.get('u_holder')?.defs[HR_DEF]).toBe('admin')
  })

  it('composes the actor and the holders in ONE batch', async () => {
    const store = makeStore({})
    const states = await computeEffectiveStatesUncached({
      organizationId: ORG,
      userIds: ['u_holder', 'u_actor'],
      tx: fakeRunner(store) as never,
    })
    expect([...states.keys()].sort()).toEqual(['u_actor', 'u_holder'])
    // Only the holder is in the group that holds HR.
    expect(states.get('u_holder')?.defs[HR_DEF]).toBe('admin')
    expect(states.get('u_actor')?.defs[HR_DEF]).toBeUndefined()
  })
})

describe('savePermissionProfile — §6.1 escalation guard end to end', () => {
  it('DENIES raising a ceiling that surfaces a pre-existing group grant', async () => {
    const store = makeStore({ supportCeiling: { defs: { mode: 'only', slugs: [] } } })
    await expect(
      savePermissionProfile({
        organizationId: ORG,
        actorUserId: 'u_actor',
        profileId: 'p_support',
        ceiling: null,
        db: fakeRunner(store) as never,
      })
    ).rejects.toBeInstanceOf(ForbiddenError)

    // …and the transaction rolled back.
    expect(store.PermissionProfile.find((row) => row.id === 'p_support')?.ceiling).toEqual({
      defs: { mode: 'only', slugs: [] },
    })
  })

  it('DENIES raising an area above the actor’s own level', async () => {
    const store = makeStore({
      supportLevels: { [Area.records]: Level.Read },
      actorCeiling: { areas: { [Area.records]: Level.Read } },
    })
    await expect(
      savePermissionProfile({
        organizationId: ORG,
        actorUserId: 'u_actor',
        profileId: 'p_support',
        levels: { [Area.records]: Level.Full },
        db: fakeRunner(store) as never,
      })
    ).rejects.toBeInstanceOf(ForbiddenError)
    expect(store.PermissionGrant[0]?.levels).toEqual({ [Area.records]: Level.Read })
  })

  it('PERMITS a decrease even when the actor’s own access is narrower', async () => {
    // The actor is capped at `records: Read` yet may still lower the profile from
    // Full to Read — removal only tightens (§6.1.2 property 1).
    const store = makeStore({
      supportLevels: { [Area.records]: Level.Full },
      actorCeiling: { areas: { [Area.records]: Level.Read } },
    })
    await savePermissionProfile({
      organizationId: ORG,
      actorUserId: 'u_actor',
      profileId: 'p_support',
      levels: { [Area.records]: Level.Read },
      db: fakeRunner(store) as never,
    })
    expect(store.PermissionGrant[0]?.levels).toEqual({ [Area.records]: Level.Read })
  })

  it('PERMITS a raise the actor holds themselves, and writes metadata in the same txn', async () => {
    const store = makeStore({ supportLevels: { [Area.records]: Level.Read } })
    await savePermissionProfile({
      organizationId: ORG,
      actorUserId: 'u_actor',
      profileId: 'p_support',
      name: 'Support (tier 2)',
      levels: { [Area.records]: Level.Full },
      db: fakeRunner(store) as never,
    })
    const profile = store.PermissionProfile.find((row) => row.id === 'p_support')
    expect(profile?.name).toBe('Support (tier 2)')
    expect(store.PermissionGrant[0]?.levels).toEqual({ [Area.records]: Level.Full })
  })

  it('reaches NULL-BOUND holders of a system profile (§6.1.3 majority case)', async () => {
    // `u_null` has no `permissionProfileId`, so the §1.1 index returns NOBODY for
    // the `member` profile. If the sweep skipped the null-bound branch the
    // affected set would be empty, the comparison vacuous, and this save would
    // succeed — which is exactly the hole §6.1.3 calls out.
    // `members` is grantable but USER-default `None` (`USER_ADMIN_NONE_AREAS`),
    // so the actor does not hold it either — the raise is a real delta for
    // `u_null` and above the actor's own level.
    const store = makeStore({ nullBoundHolder: true })
    await expect(
      savePermissionProfile({
        organizationId: ORG,
        actorUserId: 'u_actor',
        profileId: 'p_member',
        levels: { [Area.members]: Level.Full },
        db: fakeRunner(store) as never,
      })
    ).rejects.toBeInstanceOf(ForbiddenError)
    expect(store.PermissionGrant).toHaveLength(0)
  })

  it('lets an OWNER make a change no other actor could (§0.10 recovery)', async () => {
    const store = makeStore({ supportCeiling: { defs: { mode: 'only', slugs: [] } } })
    const actor = store.OrganizationMember.find((row) => row.userId === 'u_actor')
    if (actor) actor.role = 'OWNER'
    await savePermissionProfile({
      organizationId: ORG,
      actorUserId: 'u_actor',
      profileId: 'p_support',
      ceiling: null,
      db: fakeRunner(store) as never,
    })
    expect(store.PermissionProfile.find((row) => row.id === 'p_support')?.ceiling).toBeNull()
  })
})

/**
 * §6.1.3's fourth row. `deletePermissionProfile` itself is **not built** — it
 * belongs with step 7's delete dialog — but the guard has to be able to evaluate
 * a deletion *before* that mutation exists, because deletion can WIDEN: holders
 * fall back to the §1.3 system template, which may carry no ceiling at all.
 *
 * This test performs the deletion's writes inline, in the order §8.4 requires,
 * and shows the existing guard API measuring the result. A step-7 implementer
 * writes exactly this, inside `db.transaction`.
 */
describe('the guard evaluates a DELETION (§6.1.3) — no delete mutation required', () => {
  /** The step-7 delete, minus the mutation wrapper. Returns before/after states. */
  async function simulateDelete(store: Store, holderIds: string[]) {
    const tx = fakeRunner(store) as never
    // 1. Holders are captured BEFORE the bindings are nulled, and `before` is
    //    snapshotted inside the transaction.
    const before = await computeEffectiveStatesUncached({
      organizationId: ORG,
      userIds: [...holderIds, 'u_actor'],
      tx,
    })
    // 2. `permissionProfileId` → null (§0.24), then the profile row and — because
    //    `granteeId` has no FK — its own grant + ResourceAccess rows (§8.4).
    for (const row of store.OrganizationMember) {
      if (row.permissionProfileId === 'p_support') row.permissionProfileId = null
    }
    store.PermissionProfile = store.PermissionProfile.filter((row) => row.id !== 'p_support')
    store.PermissionGrant = store.PermissionGrant.filter((row) => row.granteeId !== 'p_support')
    store.ResourceAccess = store.ResourceAccess.filter((row) => row.granteeId !== 'p_support')
    // 3. Re-read post-write: holders now compose through the `member` template.
    const after = await computeEffectiveStatesUncached({
      organizationId: ORG,
      userIds: holderIds,
      tx,
    })
    return { before, after }
  }

  it('DENIES a deletion whose system-template fallback widens past the actor', async () => {
    const store = makeStore({ supportCeiling: { defs: { mode: 'only', slugs: [] } } })
    const { before, after } = await simulateDelete(store, ['u_holder'])

    // The ceiling that hid HR went with the profile; the group grant underneath
    // it is now visible. Nothing about that grant changed.
    expect(before.get('u_holder')?.defs[HR_DEF]).toBeUndefined()
    expect(after.get('u_holder')?.defs[HR_DEF]).toBe('admin')

    const actorState = before.get('u_actor')
    if (!actorState) throw new Error('actor state missing')
    expect(() =>
      assertNoEscalation({
        actor: { userId: 'u_actor', role: 'USER', state: actorState },
        before,
        after,
      })
    ).toThrow(ForbiddenError)
  })

  it('PERMITS the same deletion for an actor who holds that def access', async () => {
    const store = makeStore({ supportCeiling: { defs: { mode: 'only', slugs: [] } } })
    store.ResourceAccess.push({
      organizationId: ORG,
      granteeType: 'user',
      granteeId: 'u_actor',
      entityDefinitionId: HR_DEF,
      entityInstanceId: null,
      permission: 'admin',
    })
    const { before, after } = await simulateDelete(store, ['u_holder'])

    const actorState = before.get('u_actor')
    if (!actorState) throw new Error('actor state missing')
    expect(actorState.defs[HR_DEF]).toBe('admin')
    expect(() =>
      assertNoEscalation({
        actor: { userId: 'u_actor', role: 'USER', state: actorState },
        before,
        after,
      })
    ).not.toThrow()
  })
})

describe('savePermissionProfile — the other §6.1.5 gates', () => {
  it('refuses a cross-org profile id', async () => {
    const store = makeStore({})
    await expect(
      savePermissionProfile({
        organizationId: 'org_other',
        actorUserId: 'u_actor',
        profileId: 'p_support',
        name: 'x',
        db: fakeRunner(store) as never,
      })
    ).rejects.toThrow(/not found/i)
  })

  it('refuses to edit the owner profile', async () => {
    const store = makeStore({})
    store.PermissionProfile.push({
      id: 'p_owner',
      organizationId: ORG,
      slug: 'owner',
      name: 'Owner',
      description: null,
      icon: null,
      seat: 'full',
      appliesTo: 'member',
      baseLevel: 3,
      ceiling: null,
      agentPolicy: null,
      isSystem: true,
      updatedAt: null,
    })
    await expect(
      savePermissionProfile({
        organizationId: ORG,
        actorUserId: 'u_actor',
        profileId: 'p_owner',
        name: 'nope',
        db: fakeRunner(store) as never,
      })
    ).rejects.toBeInstanceOf(ForbiddenError)
  })

  it('keeps agent-profile editing OWNER/ADMIN-only (§0.25 / doc 14 §0.9)', async () => {
    const store = makeStore({})
    const profile = store.PermissionProfile.find((row) => row.id === 'p_support')
    if (profile) profile.appliesTo = 'agent'
    await expect(
      savePermissionProfile({
        organizationId: ORG,
        actorUserId: 'u_actor',
        profileId: 'p_support',
        name: 'agent policy',
        db: fakeRunner(store) as never,
      })
    ).rejects.toThrow(/owners and admins/i)

    const actor = store.OrganizationMember.find((row) => row.userId === 'u_actor')
    if (actor) actor.role = 'ADMIN'
    await savePermissionProfile({
      organizationId: ORG,
      actorUserId: 'u_actor',
      profileId: 'p_support',
      name: 'agent policy',
      db: fakeRunner(store) as never,
    })
    expect(store.PermissionProfile.find((row) => row.id === 'p_support')?.name).toBe('agent policy')
  })

  it('plan-gates the WRITE (§0.26)', async () => {
    planGate.allowed = false
    const store = makeStore({})
    await expect(
      savePermissionProfile({
        organizationId: ORG,
        actorUserId: 'u_actor',
        profileId: 'p_support',
        name: 'x',
        db: fakeRunner(store) as never,
      })
    ).rejects.toThrow('PLAN_GATE')
  })

  it('refuses profile-scoped resource grants until step 9', async () => {
    const store = makeStore({})
    await expect(
      savePermissionProfile({
        organizationId: ORG,
        actorUserId: 'u_actor',
        profileId: 'p_support',
        defAccess: [{ entityDefinitionId: HR_DEF, permission: 'view' }],
        db: fakeRunner(store) as never,
      })
    ).rejects.toThrow(/step 9/)
  })
})
