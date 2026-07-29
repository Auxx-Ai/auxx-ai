// apps/web/src/server/api/routers/permissions-profile-base-write-path.test.ts

import { Area, expandLevelsToKeys, Level, PermissionKey } from '@auxx/lib/permissions/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Plan 19 step 7 / plan 22 item 9 — **one guarded path to a profile's per-area
 * base**, pinned at the router that owns the write.
 *
 * `savePermissionProfile` runs the §6.1 escalation guard: it snapshots every
 * affected holder's effective state inside one transaction, applies the writes,
 * re-composes, and rolls back on any raise the actor does not hold themselves.
 *
 * `setGranteeLevels` ran **no** such guard when these tests were written — only
 * `assertGrantableLevels`, which rejects the single `adminOnly` area (`settings`)
 * and nothing else. Plan 37 phase 1 put the same guard on its `user` tier; its
 * `group` tier is still unguarded. That does not weaken anything below: these
 * tests pin that `'profile'` and `'role'` are off the wire, and the reason is
 * holder enumeration, not the presence of a guard.
 *
 * Until this change the Member-baseline tab wrote the org's `member` profile
 * through `setGranteeLevels`, addressed as `role:org_member` and redirected onto
 * the profile at the tRPC boundary. That made `permissions.grant` a guard-free
 * side door onto a profile base: `Area.permissions` is grantable and NOT
 * `adminOnly`, so a non-OWNER/ADMIN `permissionsManage` holder could raise
 * `billing`/`members`/`permissions` for every member in the org — a state
 * `saveProfile` refuses.
 *
 * These tests pin the closure mechanically: neither `'profile'` nor `'role'` is
 * on the `grant`/`revoke` wire, `listGrants` hands the `member` profile back
 * under its own profile id with no rewriting, and `saveProfile` still carries
 * levels into the guarded save.
 *
 * `getCapabilities` is stubbed to return a **real** `CapabilitySet`, so the
 * `permissionsManage` gate is the shipped decision rather than a boolean fake.
 */

const {
  getCapabilities,
  setGranteeLevels,
  clearGranteeLevels,
  listGranteeGrants,
  savePermissionProfile,
  createPermissionProfile,
  listPermissionProfiles,
  getPermissionProfile,
  recordAuditFromCtx,
} = vi.hoisted(() => ({
  getCapabilities: vi.fn(),
  setGranteeLevels: vi.fn(async () => ({ id: 'pgr_written' })),
  clearGranteeLevels: vi.fn(async () => true),
  listGranteeGrants: vi.fn(async () => []),
  savePermissionProfile: vi.fn(async () => ({ id: 'pprf_member', slug: 'member', name: 'Member' })),
  createPermissionProfile: vi.fn(async () => ({ id: 'pprf_new', slug: 'new', name: 'New' })),
  listPermissionProfiles: vi.fn(async () => []),
  getPermissionProfile: vi.fn(async () => null),
  recordAuditFromCtx: vi.fn(async () => undefined),
}))

vi.mock('~/server/api/audit-context', () => ({ recordAuditFromCtx }))

// The permissions barrel reaches redis/db at import time and hangs under vitest,
// so it is replaced wholesale; the registry values the router needs come from the
// client-safe deep import instead.
vi.mock('@auxx/lib/permissions', async () => {
  const registry = await import('@auxx/lib/permissions/capabilities/registry')
  const seatPolicy = await import('@auxx/lib/permissions/capabilities/seat-policy')
  return {
    Level: registry.Level,
    PermissionKey: registry.PermissionKey,
    ROLE_DEFAULTS: seatPolicy.ROLE_DEFAULTS,
    getCapabilities,
    setGranteeLevels,
    clearGranteeLevels,
    listGranteeGrants,
    savePermissionProfile,
    createPermissionProfile,
    listPermissionProfiles,
    getPermissionProfile,
  }
})

vi.mock('../trpc', async () => {
  const { initTRPC } = await import('@trpc/server')
  const t = initTRPC.context<Record<string, unknown>>().create()
  return { createTRPCRouter: t.router, protectedProcedure: t.procedure }
})

// Deep path on purpose — the barrel hangs (see above).
const { CapabilitySet } = await import('@auxx/lib/permissions/capabilities/capability-set')
const { permissionsRouter } = await import('./permissions')

const ORG_ID = 'org_cuid000000000000000000000'
const USER_ID = 'usr_cuid000000000000000000000'
const MEMBER_PROFILE_ID = 'pprf_membercuid00000000000000'

/**
 * A real `CapabilitySet` for a plain MEMBER who has been granted the
 * `permissions` area — the exact principal the deleted side door empowered.
 * Deliberately NOT admin/owner: `Area.permissions` is grantable, so this is a
 * reachable shape, not a hypothetical one.
 */
function permissionsManagerCaps() {
  return new CapabilitySet(
    new Set(expandLevelsToKeys({ [Area.permissions]: Level.Full })),
    {},
    'USER',
    'full'
  )
}

const caller = permissionsRouter.createCaller({
  db: {},
  headers: new Headers(),
  session: { organizationId: ORG_ID, userId: USER_ID, user: { id: USER_ID } },
} as never)

beforeEach(() => {
  for (const fn of [
    setGranteeLevels,
    clearGranteeLevels,
    listGranteeGrants,
    savePermissionProfile,
    createPermissionProfile,
    listPermissionProfiles,
    getPermissionProfile,
    recordAuditFromCtx,
    getCapabilities,
  ]) {
    fn.mockReset()
  }
  setGranteeLevels.mockResolvedValue({ id: 'pgr_written' } as never)
  clearGranteeLevels.mockResolvedValue(true as never)
  listGranteeGrants.mockResolvedValue([] as never)
  savePermissionProfile.mockResolvedValue({
    id: MEMBER_PROFILE_ID,
    slug: 'member',
    name: 'Member',
  } as never)
  recordAuditFromCtx.mockResolvedValue(undefined as never)
  getCapabilities.mockResolvedValue(permissionsManagerCaps() as never)
})

describe('permissions.grant / revoke — the unguarded service is unreachable for a base tier', () => {
  it('refuses a `profile` grantee: a base write must go through saveProfile', async () => {
    await expect(
      caller.grant({
        granteeType: 'profile' as never,
        granteeId: MEMBER_PROFILE_ID,
        levels: { [Area.billing]: Level.Full },
      })
    ).rejects.toThrow()

    // The gate is the input, so nothing reaches the guard-free service at all.
    expect(setGranteeLevels).not.toHaveBeenCalled()
  })

  it('refuses the legacy `role:org_member` address the Member-baseline tab used', async () => {
    await expect(
      caller.grant({
        granteeType: 'role' as never,
        granteeId: 'org_member',
        // `billing`/`members` are grantable (only `settings` is `adminOnly`), so
        // `assertGrantableLevels` would have waved this through.
        levels: { [Area.billing]: Level.Full, [Area.members]: Level.Full },
      })
    ).rejects.toThrow()

    expect(setGranteeLevels).not.toHaveBeenCalled()
  })

  it('refuses `role` / `profile` on revoke too — the delete side had no guard either', async () => {
    for (const granteeType of ['role', 'profile'] as const) {
      await expect(
        caller.revoke({ granteeType: granteeType as never, granteeId: MEMBER_PROFILE_ID })
      ).rejects.toThrow()
    }
    expect(clearGranteeLevels).not.toHaveBeenCalled()
  })

  it('still writes the two raise-only override tiers verbatim', async () => {
    for (const granteeType of ['group', 'user'] as const) {
      setGranteeLevels.mockClear()
      await expect(
        caller.grant({
          granteeType,
          granteeId: `${granteeType}_1`,
          levels: { [Area.records]: Level.Edit },
        })
      ).resolves.toEqual({ id: 'pgr_written' })

      expect(setGranteeLevels).toHaveBeenCalledWith(
        expect.objectContaining({
          organizationId: ORG_ID,
          granteeType,
          granteeId: `${granteeType}_1`,
          levels: { [Area.records]: Level.Edit },
        })
      )
    }
  })

  it('audits the grantee it actually wrote — no address translation in between', async () => {
    await caller.grant({
      granteeType: 'group',
      granteeId: 'grp_1',
      levels: { [Area.records]: Level.Read },
    })

    expect(recordAuditFromCtx).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: 'permission.granted',
        newState: expect.objectContaining({ granteeType: 'group', granteeId: 'grp_1' }),
      })
    )
  })
})

describe('permissions.listGrants — rows are returned verbatim', () => {
  it('hands the member profile back under its own profile id, not role:org_member', async () => {
    listGranteeGrants.mockResolvedValue([
      {
        granteeType: 'profile',
        granteeId: MEMBER_PROFILE_ID,
        levels: { [Area.records]: Level.Full },
      },
      { granteeType: 'group', granteeId: 'grp_1', levels: { [Area.files]: Level.Edit } },
    ] as never)

    const { grants } = await caller.listGrants()

    // Reads must match writes: the profile editor addresses this row by profile
    // id, so presenting it under any other identity resurrects the bridge bug.
    expect(grants).toEqual([
      {
        granteeType: 'profile',
        granteeId: MEMBER_PROFILE_ID,
        levels: { [Area.records]: Level.Full },
      },
      { granteeType: 'group', granteeId: 'grp_1', levels: { [Area.files]: Level.Edit } },
    ])
  })

  it('does not query the profile cache to resolve a member-profile alias', async () => {
    listGranteeGrants.mockResolvedValue([] as never)
    await expect(caller.listGrants()).resolves.toEqual({ grants: [] })
    // One read, no second lookup — the bridge needed `getCachedPermissionProfileBySlug`.
    expect(listGranteeGrants).toHaveBeenCalledTimes(1)
  })
})

describe('permissions.saveProfile — the one guarded path still carries the base', () => {
  it('forwards levels into the transactional, escalation-guarded save', async () => {
    await caller.saveProfile({
      profileId: MEMBER_PROFILE_ID,
      levels: { [Area.records]: Level.Full, [Area.datasets]: Level.Read },
    })

    expect(savePermissionProfile).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: ORG_ID,
        actorUserId: USER_ID,
        profileId: MEMBER_PROFILE_ID,
        levels: { [Area.records]: Level.Full, [Area.datasets]: Level.Read },
      })
    )
    // And never through the guard-free service.
    expect(setGranteeLevels).not.toHaveBeenCalled()
  })

  it('keeps an explicit Level.None — the one downward lever must reach the save', async () => {
    await caller.saveProfile({
      profileId: MEMBER_PROFILE_ID,
      levels: { [Area.workflows]: Level.None },
    })

    // `0` is a genuine rung, not "unset". Dropping it here would silently let the
    // area fall through to the role default and read as a denial that isn't one.
    expect(savePermissionProfile).toHaveBeenCalledWith(
      expect.objectContaining({ levels: { [Area.workflows]: Level.None } })
    )
  })
})

describe('the permissionsManage gate itself', () => {
  it('denies a member without the permissions area on every surface', async () => {
    getCapabilities.mockResolvedValue(new CapabilitySet(new Set(), {}, 'USER', 'full') as never)

    await expect(caller.listGrants()).rejects.toThrow()
    await expect(
      caller.grant({ granteeType: 'group', granteeId: 'grp_1', levels: {} })
    ).rejects.toThrow()
    await expect(caller.saveProfile({ profileId: MEMBER_PROFILE_ID, levels: {} })).rejects.toThrow()

    expect(setGranteeLevels).not.toHaveBeenCalled()
    expect(savePermissionProfile).not.toHaveBeenCalled()
  })

  it('a plain member holding only the permissions area DOES pass — this is the reachable actor', () => {
    // The premise of the whole file: `Area.permissions` is grantable, so the
    // principal these tests model is a real one, not an admin in disguise.
    const caps = permissionsManagerCaps()
    expect(caps.can(PermissionKey.permissionsManage)).toBe(true)
    expect(caps.role).toBe('USER')
    expect(caps.can(PermissionKey.billingManage)).toBe(false)
  })
})
