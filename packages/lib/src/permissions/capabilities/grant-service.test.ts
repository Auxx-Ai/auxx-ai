// packages/lib/src/permissions/capabilities/grant-service.test.ts

import type { Database } from '@auxx/database'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const roleMap: Record<
  string,
  { role: string; seatType: string; userType: string; permissionProfileId: string | null }
> = {
  u_human: { role: 'USER', seatType: 'full', userType: 'USER', permissionProfileId: null },
  u_agent: { role: 'USER', seatType: 'full', userType: 'AGENT', permissionProfileId: null },
  u_bound: {
    role: 'USER',
    seatType: 'full',
    userType: 'USER',
    permissionProfileId: 'prof_custom',
  },
}

const profiles = [
  { id: 'prof_member', slug: 'member', isSystem: true },
  { id: 'prof_custom', slug: 'support_rep', isSystem: false },
]

// The cache barrel is only used here for `onCacheEvent` + the memberRoleMap /
// profiles reads; mocking it keeps the heavy cache/redis deps out of the test.
vi.mock('../../cache', () => ({
  onCacheEvent: vi.fn(async () => {}),
  getOrgCache: () => ({
    get: vi.fn(async (_orgId: string, key: string) => (key === 'profiles' ? profiles : roleMap)),
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
vi.mock('../feature-permission-service', () => ({
  FeaturePermissionService: class {
    async requireAccess() {}
  },
}))

/**
 * The effective-state module, faked but **live**: `composeFakeState` reads the
 * grant store at call time, so the `after` snapshot genuinely reflects the row
 * written earlier in the transaction. A frozen fake would make every escalation
 * assertion pass vacuously — which is precisely the failure mode plan 37 §6.3's
 * second mutation exists to catch.
 *
 * `loadActorRole`'s own query is not exercised here; `profile-save.test.ts`
 * drives the real function against a fake `OrganizationMember` table.
 */
vi.mock('../profiles/effective-state', () => ({
  computeEffectiveStatesUncached: vi.fn(
    async ({ userIds, tx }: { userIds: string[]; tx: unknown }) => {
      composedWith.push(tx)
      const out = new Map<string, unknown>()
      for (const userId of userIds) out.set(userId, composeFakeState(userId))
      return out
    }
  ),
  loadActorRole: vi.fn(async (_tx: unknown, _organizationId: string, userId: string) => {
    const member = store.members[userId]
    if (!member) throw new ForbiddenError('You are not a member of this organization.')
    return member.role
  }),
}))

import type { OrganizationRole } from '@auxx/database/types'
import { ForbiddenError } from '../../errors'
import { composeUserCapabilities } from './compose-user-capabilities'
import { assertGrantableLevels, setGranteeLevels } from './grant-service'
import { AREA_ORDER, Area, Level, PermissionKey, parseAreaLevels } from './registry'
import { MEMBER_BASELINE_LEVELS } from './seat-policy'

const ORG = 'org_1'

interface FakeMember {
  role: OrganizationRole
  /** The member's own composed base, before any `PermissionGrant` row applies. */
  base: Partial<Record<Area, Level>>
}

/**
 * The `tx` every `computeEffectiveStatesUncached` call was handed, in order.
 *
 * Composing either snapshot through anything other than the open transaction —
 * the org cache, or the outer `db` — returns PRE-write values on both sides, so
 * the guard compares a state to itself and passes unconditionally. The fake
 * composer reads a module-level store and would not notice, so the runner
 * identity is pinned directly instead.
 */
let composedWith: unknown[]

/** The transaction runner the fake db hands to the callback. */
let txRunner: unknown

/** What the fake composer and the fake db both read. */
let store: {
  members: Record<string, FakeMember | undefined>
  /** Written grant rows, keyed `<granteeType>:<granteeId>`. */
  grants: Record<string, Partial<Record<Area, Level>>>
}

function resetStore() {
  composedWith = []
  txRunner = undefined
  store = {
    members: {
      // The default actor: an admin, so the seven storability cases below are
      // never denied by the guard and keep testing what they were written for.
      u_admin: { role: 'ADMIN', base: allAreas(Level.Full) },
      u_owner: { role: 'OWNER', base: allAreas(Level.Full) },
      u_human: { role: 'USER', base: {} },
      u_agent: { role: 'USER', base: {} },
      u_peer: { role: 'USER', base: {} },
    },
    grants: {},
  }
}

function allAreas(level: Level): Record<Area, Level> {
  const areas = {} as Record<Area, Level>
  for (const area of AREA_ORDER) areas[area] = level
  return areas
}

/**
 * Compose one principal the way the real composer does, to the depth this suite
 * needs: a non-member holds nothing, and everyone else is `max(base, userGrant)`
 * — the raise-only user tier.
 *
 * OWNER is deliberately NOT special-cased here. An owner's all-Full state comes
 * from `ROLE_DEFAULTS.OWNER` landing in their base, exactly as it does in
 * composition — so a test can hand an owner a degraded base and prove the
 * guard's OWNER short-circuit holds on its own rather than riding on the base.
 */
function composeFakeState(userId: string) {
  const member = store.members[userId]
  if (!member) return { userId, areas: allAreas(Level.None), defs: {}, instances: {} }

  const granted = store.grants[`user:${userId}`] ?? {}
  const areas = {} as Record<Area, Level>
  for (const area of AREA_ORDER) {
    areas[area] = Math.max(member.base[area] ?? Level.None, granted[area] ?? Level.None)
  }
  return { userId, areas, defs: {}, instances: {} }
}

/**
 * Minimal chainable drizzle stub covering only the shapes `setGranteeLevels`
 * touches; captures the `levels` payload that reaches the upsert and applies it
 * to the store so the post-write snapshot can see it.
 *
 * `transaction` restores the store on a throw — the rollback is the entire undo
 * mechanism for a denied grant, so a test asserting "no row was written" is
 * testing the real property only if this restores.
 */
function fakeDb(sink: { levels?: Record<string, number> }): Database {
  const runner = {
    insert: () => ({
      values: (row: { granteeType: string; granteeId: string; levels: Record<string, number> }) => {
        sink.levels = row.levels
        store.grants[`${row.granteeType}:${row.granteeId}`] = row.levels as Partial<
          Record<Area, Level>
        >
        return {
          onConflictDoUpdate: () => ({ returning: async () => [row] }),
        }
      },
    }),
  }
  txRunner = runner
  return {
    ...runner,
    transaction: async <T>(fn: (tx: typeof runner) => Promise<T>): Promise<T> => {
      const snapshot = structuredClone(store.grants)
      try {
        return await fn(runner)
      } catch (error) {
        store.grants = snapshot
        throw error
      }
    },
  } as unknown as Database
}

beforeEach(() => {
  resetStore()
})

describe('setGranteeLevels — Level.None storability (v2 §1)', () => {
  it('KEEPS Level.None for an AGENT user grantee (the only way to lock an area down)', async () => {
    const sink: { levels?: Record<string, number> } = {}
    await setGranteeLevels({
      organizationId: ORG,
      granteeType: 'user',
      granteeId: 'u_agent',
      grantedById: 'u_admin',
      levels: { [Area.records]: Level.None, [Area.knowledgeBase]: Level.Read },
      db: fakeDb(sink),
    })
    expect(sink.levels).toEqual({
      [Area.records]: Level.None,
      [Area.knowledgeBase]: Level.Read,
    })
  })

  it('STRIPS Level.None for a human user grantee (raise-only ⇒ inert noise)', async () => {
    const sink: { levels?: Record<string, number> } = {}
    await setGranteeLevels({
      organizationId: ORG,
      granteeType: 'user',
      granteeId: 'u_human',
      grantedById: 'u_admin',
      levels: { [Area.records]: Level.None, [Area.knowledgeBase]: Level.Read },
      db: fakeDb(sink),
    })
    expect(sink.levels).toEqual({ [Area.knowledgeBase]: Level.Read })
  })

  it('STRIPS Level.None for a group grantee', async () => {
    const sink: { levels?: Record<string, number> } = {}
    await setGranteeLevels({
      organizationId: ORG,
      granteeType: 'group',
      granteeId: 'grp_1',
      grantedById: 'u_admin',
      levels: { [Area.records]: Level.None, [Area.workflows]: Level.Full },
      db: fakeDb(sink),
    })
    expect(sink.levels).toEqual({ [Area.workflows]: Level.Full })
  })

  it('KEEPS Level.None for the legacy org_member policy row', async () => {
    // No composer reads this tier anymore (migration 041 moved it onto the `member`
    // profile), but the semantics are preserved so a pre-migration row round-trips
    // unchanged instead of being silently widened on a re-save.
    const sink: { levels?: Record<string, number> } = {}
    await setGranteeLevels({
      organizationId: ORG,
      granteeType: 'role',
      granteeId: 'org_member',
      grantedById: 'u_admin',
      levels: { [Area.records]: Level.Read, [Area.workflows]: Level.None },
      db: fakeDb(sink),
    })
    expect(sink.levels).toEqual({
      [Area.records]: Level.Read,
      [Area.workflows]: Level.None,
    })
  })

  it('KEEPS Level.None for a PROFILE grantee (the composition base — fail-open if stripped)', async () => {
    // `composeUserCapabilities` reads
    // `profileLevels[a] ?? profileBaseLevel ?? ROLE_DEFAULTS[role][a]`, so a stored
    // None genuinely zeroes the area for every holder of the profile. Stripping it
    // would write "unset", fall through to the role default, and make the editor
    // display a denial the profile does not produce — a silent fail-OPEN.
    const sink: { levels?: Record<string, number> } = {}
    await setGranteeLevels({
      organizationId: ORG,
      granteeType: 'profile',
      granteeId: 'prof_member',
      grantedById: 'u_admin',
      levels: { [Area.records]: Level.Read, [Area.workflows]: Level.None },
      db: fakeDb(sink),
    })
    expect(sink.levels).toEqual({
      [Area.records]: Level.Read,
      [Area.workflows]: Level.None,
    })
  })

  it('a profile grant round-trips an explicit None into a composed None for that area', async () => {
    // End-to-end proof of the same invariant: the levels that reach the DB are
    // the levels the composer consumes. `prof_member`'s row models the seeded
    // Member baseline (plan 22 §2.2) with an admin override zeroing `records` —
    // post plan-22 an unset area floors to None too, so this must ground the
    // "other areas untouched" half in the baseline's OWN explicit levels, not
    // the old ROLE_DEFAULTS.USER fall-through.
    const sink: { levels?: Record<string, number> } = {}
    await setGranteeLevels({
      organizationId: ORG,
      granteeType: 'profile',
      granteeId: 'prof_member',
      grantedById: 'u_admin',
      levels: { ...MEMBER_BASELINE_LEVELS, [Area.records]: Level.None },
      db: fakeDb(sink),
    })
    const caps = composeUserCapabilities({
      role: 'USER',
      seatType: 'full',
      profileLevels: parseAreaLevels(sink.levels),
      typeAccessRows: [],
    })
    expect(caps.keys).not.toContain(PermissionKey.recordsView)
    expect(caps.keys).not.toContain(PermissionKey.recordsEdit)
    // Other Member-baseline areas persist — they're explicit in the map now,
    // not a role-default fall-through.
    expect(caps.keys).toContain(PermissionKey.workflowsManage)
  })

  it('treats an unknown user grantee (no member row) as a human and strips None', async () => {
    const sink: { levels?: Record<string, number> } = {}
    await setGranteeLevels({
      organizationId: ORG,
      granteeType: 'user',
      granteeId: 'u_ghost',
      grantedById: 'u_admin',
      levels: { [Area.records]: Level.None },
      db: fakeDb(sink),
    })
    expect(sink.levels).toEqual({})
  })
})

/**
 * Plan 39 §7.1 — `assertGrantableLevels` after `settings` dropped `adminOnly`.
 *
 * Worth stating plainly: before this change the guard's REJECTION path had no
 * test anywhere in the repo — it appeared only in prose. So dropping the flag
 * removed the one area it could ever fire on without a single test going red.
 * These cases exist so the delegation is pinned by something executable.
 */
describe('assertGrantableLevels — the adminOnly guard (plan 39 §7.1)', () => {
  it('permits granting `settings`, the area that used to be refused', () => {
    expect(() => assertGrantableLevels({ [Area.settings]: Level.Full })).not.toThrow()
  })

  it('permits EVERY area at Full — the adminOnly set is empty', () => {
    // The consequence of an empty set, asserted directly rather than inferred.
    // If this throws, some area regained `adminOnly` and a delegation broke.
    const everyAreaFull = Object.fromEntries(
      AREA_ORDER.map((area) => [area, Level.Full])
    ) as Partial<Record<Area, Level>>
    expect(() => assertGrantableLevels(everyAreaFull)).not.toThrow()
  })
})

/**
 * Plan 37 phase 1 — the §6.1 escalation guard on the `user` grantee tier.
 *
 * `permissions.grant` is gated on `permissionsManage` alone and its input places
 * no per-area restriction, so before this guard a holder could name THEMSELVES
 * as the grantee and write `{billing: Full, members: Full, permissions: Full}`.
 * `assertGrantableLevels` never caught it: back then `adminOnly` was `settings`
 * alone, and all three of those areas are deliberately grantable. Since plan 39
 * §7.1 that set is empty, so this guard is the ONLY thing standing there.
 */
describe('setGranteeLevels — the escalation guard (plan 37 §3)', () => {
  /** Register a member with an explicit composed base. */
  function member(userId: string, role: OrganizationRole, base: Partial<Record<Area, Level>> = {}) {
    store.members[userId] = { role, base }
  }

  it('DENIES an actor granting themselves an area they do not hold', async () => {
    member('u_weak', 'USER', { [Area.records]: Level.Full })
    const sink: { levels?: Record<string, number> } = {}

    await expect(
      setGranteeLevels({
        organizationId: ORG,
        granteeType: 'user',
        granteeId: 'u_weak',
        grantedById: 'u_weak',
        levels: { [Area.billing]: Level.Full },
        db: fakeDb(sink),
      })
    ).rejects.toThrow(ForbiddenError)
  })

  it('ROLLS BACK the row on denial — the throw is the whole undo mechanism', async () => {
    member('u_weak', 'USER', {})
    const sink: { levels?: Record<string, number> } = {}

    await expect(
      setGranteeLevels({
        organizationId: ORG,
        granteeType: 'user',
        granteeId: 'u_weak',
        grantedById: 'u_weak',
        levels: { [Area.permissions]: Level.Full },
        db: fakeDb(sink),
      })
    ).rejects.toThrow(ForbiddenError)

    // The insert DID run — the guard is post-write by design, so "denied" has to
    // mean "rolled back", not "never attempted".
    expect(sink.levels).toEqual({ [Area.permissions]: Level.Full })
    expect(store.grants['user:u_weak']).toBeUndefined()
  })

  it('ALLOWS granting an area the actor holds themselves, to someone else', async () => {
    member('u_strong', 'USER', { [Area.billing]: Level.Full })
    const sink: { levels?: Record<string, number> } = {}

    await setGranteeLevels({
      organizationId: ORG,
      granteeType: 'user',
      granteeId: 'u_peer',
      grantedById: 'u_strong',
      levels: { [Area.billing]: Level.Full },
      db: fakeDb(sink),
    })

    expect(store.grants['user:u_peer']).toEqual({ [Area.billing]: Level.Full })
  })

  it('DENIES a raise above the actor even when the grantee is someone else', async () => {
    member('u_mid', 'USER', { [Area.billing]: Level.Read })
    const sink: { levels?: Record<string, number> } = {}

    await expect(
      setGranteeLevels({
        organizationId: ORG,
        granteeType: 'user',
        granteeId: 'u_peer',
        grantedById: 'u_mid',
        levels: { [Area.billing]: Level.Full },
        db: fakeDb(sink),
      })
    ).rejects.toThrow(ForbiddenError)
  })

  it('an OWNER actor short-circuits past the guard (the §0.10 recovery guarantee)', async () => {
    const sink: { levels?: Record<string, number> } = {}

    await setGranteeLevels({
      organizationId: ORG,
      granteeType: 'user',
      granteeId: 'u_peer',
      grantedById: 'u_owner',
      levels: { [Area.billing]: Level.Full, [Area.permissions]: Level.Full },
      db: fakeDb(sink),
    })

    expect(store.grants['user:u_peer']).toEqual({
      [Area.billing]: Level.Full,
      [Area.permissions]: Level.Full,
    })
  })

  it('an OWNER actor passes even when their own composed state is NOT all-Full', async () => {
    // The short-circuit is doc 19 §0.10's recovery guarantee and must hold
    // structurally, not because an owner happens to compose all-Full. Give this
    // owner an empty base: without the early return the grant below raises
    // `billing` above the actor's own `None` and would be denied, locking the
    // org out of repairing a mis-shaped grant.
    member('u_owner_clamped', 'OWNER', {})
    const sink: { levels?: Record<string, number> } = {}

    await setGranteeLevels({
      organizationId: ORG,
      granteeType: 'user',
      granteeId: 'u_peer',
      grantedById: 'u_owner_clamped',
      levels: { [Area.billing]: Level.Full },
      db: fakeDb(sink),
    })

    expect(store.grants['user:u_peer']).toEqual({ [Area.billing]: Level.Full })
  })

  it('an OWNER GRANTEE is vacuous — they compose all-Full, so nothing is raised', async () => {
    member('u_weak', 'USER', {})
    const sink: { levels?: Record<string, number> } = {}

    // A weak actor granting an owner everything is not an escalation: the owner
    // already composes all-Full from their role, so after === before.
    await setGranteeLevels({
      organizationId: ORG,
      granteeType: 'user',
      granteeId: 'u_owner',
      grantedById: 'u_weak',
      levels: { [Area.billing]: Level.Full },
      db: fakeDb(sink),
    })

    expect(store.grants['user:u_owner']).toEqual({ [Area.billing]: Level.Full })
  })

  it('a NON-MEMBER grantee composes empty, so the grant raises nobody', async () => {
    member('u_weak', 'USER', {})
    const sink: { levels?: Record<string, number> } = {}

    // Fails closed rather than denying: the row is written, but a user with no
    // membership composes nothing from it, so there is no raise to refuse.
    await setGranteeLevels({
      organizationId: ORG,
      granteeType: 'user',
      granteeId: 'u_ghost',
      grantedById: 'u_weak',
      levels: { [Area.billing]: Level.Full },
      db: fakeDb(sink),
    })

    expect(composeFakeState('u_ghost').areas[Area.billing]).toBe(Level.None)
  })

  it('a DECREASE is permitted even by an actor who no longer holds the area', async () => {
    member('u_faded', 'USER', {})
    store.grants['user:u_peer'] = { [Area.billing]: Level.Full }
    const sink: { levels?: Record<string, number> } = {}

    // Nothing is denied unless `after > before` — so an admin whose own access
    // was narrowed can still clean up. Mirrors `clearGranteeLevels` not being
    // plan-gated: removal only tightens.
    await setGranteeLevels({
      organizationId: ORG,
      granteeType: 'user',
      granteeId: 'u_peer',
      grantedById: 'u_faded',
      levels: {},
      db: fakeDb(sink),
    })

    expect(store.grants['user:u_peer']).toEqual({})
  })

  it('DENIES an actor with no membership row at all', async () => {
    const sink: { levels?: Record<string, number> } = {}

    await expect(
      setGranteeLevels({
        organizationId: ORG,
        granteeType: 'user',
        granteeId: 'u_peer',
        grantedById: 'u_nobody',
        levels: { [Area.billing]: Level.Full },
        db: fakeDb(sink),
      })
    ).rejects.toThrow(ForbiddenError)
  })

  it('composes BOTH snapshots through the open transaction, never the outer db', async () => {
    member('u_strong', 'USER', { [Area.billing]: Level.Full })
    const sink: { levels?: Record<string, number> } = {}
    const db = fakeDb(sink)

    await setGranteeLevels({
      organizationId: ORG,
      granteeType: 'user',
      granteeId: 'u_peer',
      grantedById: 'u_strong',
      levels: { [Area.billing]: Level.Full },
      db,
    })

    expect(composedWith).toHaveLength(2)
    for (const tx of composedWith) {
      expect(tx).toBe(txRunner)
      expect(tx).not.toBe(db)
    }
  })

  it('does NOT yet guard a GROUP grantee — pins the phase 2 hole so it fails loudly when closed', async () => {
    member('u_weak', 'USER', {})
    const sink: { levels?: Record<string, number> } = {}

    // `resolveHolderIds` returns null for `group`, which skips the guard. This
    // is plan 37 §4's open decision (the >HOLDER_GUARD_CAP fallback), NOT an
    // oversight — a `permissionsManage` holder can still raise a group they are
    // in. When phase 2 lands this must flip to `rejects.toThrow`.
    await setGranteeLevels({
      organizationId: ORG,
      granteeType: 'group',
      granteeId: 'grp_weak',
      grantedById: 'u_weak',
      levels: { [Area.billing]: Level.Full },
      db: fakeDb(sink),
    })

    expect(store.grants['group:grp_weak']).toEqual({ [Area.billing]: Level.Full })
  })
})
