// apps/web/src/server/api/routers/permissions-member-baseline.test.ts

import fs from 'node:fs'
import path from 'node:path'
import { Area, Level } from '@auxx/lib/permissions/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The plan-19-step-2 regression guard: step 2 deleted the `role:org_member`
 * **`PermissionGrant`** tier, so the shipped Member-baseline tab was writing a row
 * nothing composed from. `permissions-member-baseline.ts` redirects that address
 * onto the org's `member` profile in both directions.
 *
 * The second describe block pins the other half of the invariant: `role:org_member`
 * on **`ResourceAccess`** is still live (the def/workspace-baseline marker) and must
 * NOT be redirected.
 *
 * `@auxx/lib/cache` is mocked so the barrel (db, redis, providers) never loads in
 * jsdom — the module under test only reaches it for the profile lookup.
 */

const { getCachedPermissionProfileBySlug } = vi.hoisted(() => ({
  getCachedPermissionProfileBySlug: vi.fn(),
}))

vi.mock('@auxx/lib/cache', () => ({ getCachedPermissionProfileBySlug }))

const {
  bridgeMemberBaselineGrants,
  isLegacyBaselineGrantee,
  LEGACY_BASELINE_GRANTEE,
  resolveGrantGrantee,
} = await import('./permissions-member-baseline')

const ORG_ID = 'org_cuid000000000000000000000'
const MEMBER_PROFILE_ID = 'pprf_membercuid00000000000000'

/** Only the fields the bridge reads off a cached profile. */
function memberProfile(id = MEMBER_PROFILE_ID) {
  return { id, slug: 'member', isSystem: true }
}

beforeEach(() => {
  getCachedPermissionProfileBySlug.mockReset()
})

describe('resolveGrantGrantee — PermissionGrant write redirect', () => {
  it('redirects role:org_member onto the org member profile', async () => {
    getCachedPermissionProfileBySlug.mockResolvedValue(memberProfile())

    const resolved = await resolveGrantGrantee(ORG_ID, { ...LEGACY_BASELINE_GRANTEE })

    expect(resolved).toEqual({ granteeType: 'profile', granteeId: MEMBER_PROFILE_ID })
    expect(getCachedPermissionProfileBySlug).toHaveBeenCalledWith(ORG_ID, 'member')
  })

  it('throws instead of silently writing a dead row when the member profile is missing', async () => {
    getCachedPermissionProfileBySlug.mockResolvedValue(null)

    await expect(resolveGrantGrantee(ORG_ID, { ...LEGACY_BASELINE_GRANTEE })).rejects.toThrow(
      /Member permission profile/i
    )
  })

  it('leaves group, user and explicit profile grantees untouched (no profile lookup)', async () => {
    for (const grantee of [
      { granteeType: 'group' as const, granteeId: 'grp_1' },
      { granteeType: 'user' as const, granteeId: 'usr_1' },
      { granteeType: 'profile' as const, granteeId: 'pprf_custom' },
    ]) {
      await expect(resolveGrantGrantee(ORG_ID, grantee)).resolves.toEqual(grantee)
    }
    expect(getCachedPermissionProfileBySlug).not.toHaveBeenCalled()
  })

  it('only the exact org_member id is legacy — a role grant to anything else passes through', async () => {
    expect(isLegacyBaselineGrantee({ granteeType: 'role', granteeId: 'org_member' })).toBe(true)
    expect(isLegacyBaselineGrantee({ granteeType: 'role', granteeId: 'ADMIN' })).toBe(false)
    expect(isLegacyBaselineGrantee({ granteeType: 'profile', granteeId: 'org_member' })).toBe(false)
  })
})

describe('bridgeMemberBaselineGrants — reads match writes', () => {
  it('presents the member profile row back as role:org_member', async () => {
    getCachedPermissionProfileBySlug.mockResolvedValue(memberProfile())

    const bridged = await bridgeMemberBaselineGrants(ORG_ID, [
      {
        granteeType: 'profile',
        granteeId: MEMBER_PROFILE_ID,
        levels: { [Area.records]: Level.Read },
      },
      { granteeType: 'group', granteeId: 'grp_1', levels: { [Area.records]: Level.Full } },
    ])

    expect(bridged).toEqual([
      { granteeType: 'group', granteeId: 'grp_1', levels: { [Area.records]: Level.Full } },
      {
        granteeType: 'role',
        granteeId: 'org_member',
        levels: { [Area.records]: Level.Read },
      },
    ])
  })

  it('round-trips an explicit Level.None — the one downward lever must survive', async () => {
    getCachedPermissionProfileBySlug.mockResolvedValue(memberProfile())

    const written = await resolveGrantGrantee(ORG_ID, { ...LEGACY_BASELINE_GRANTEE })
    const bridged = await bridgeMemberBaselineGrants(ORG_ID, [
      { ...written, levels: { [Area.records]: Level.None } },
    ])

    // `undefined` here would render as "inherit" and make No Access unreachable
    // (the doc 16 §10 bug class).
    expect(bridged[0]?.levels[Area.records]).toBe(Level.None)
    expect(bridged[0]?.granteeType).toBe('role')
  })

  it('drops a residual pre-migration role:org_member row — the profile is authoritative', async () => {
    getCachedPermissionProfileBySlug.mockResolvedValue(memberProfile())

    const bridged = await bridgeMemberBaselineGrants(ORG_ID, [
      { granteeType: 'role', granteeId: 'org_member', levels: { [Area.records]: Level.Full } },
      {
        granteeType: 'profile',
        granteeId: MEMBER_PROFILE_ID,
        levels: { [Area.records]: Level.Read },
      },
    ])

    expect(bridged).toHaveLength(1)
    expect(bridged[0]?.levels[Area.records]).toBe(Level.Read)
  })

  it('leaves other profiles rows alone and returns the list as-is for an unseeded org', async () => {
    getCachedPermissionProfileBySlug.mockResolvedValue(memberProfile())
    const otherProfile = {
      granteeType: 'profile' as const,
      granteeId: 'pprf_support',
      levels: { [Area.records]: Level.Edit },
    }
    await expect(bridgeMemberBaselineGrants(ORG_ID, [otherProfile])).resolves.toEqual([
      otherProfile,
    ])

    getCachedPermissionProfileBySlug.mockResolvedValue(null)
    const legacy = {
      granteeType: 'role' as const,
      granteeId: 'org_member',
      levels: { [Area.records]: Level.Read },
    }
    await expect(bridgeMemberBaselineGrants(ORG_ID, [legacy])).resolves.toEqual([legacy])
  })
})

/**
 * `role:org_member` lives on two tables and only the `PermissionGrant` one is dead.
 * On `ResourceAccess` it is the per-def / per-instance baseline marker that
 * `compute-user-capabilities.ts` still reads; redirecting it would re-privatize
 * defs org-wide (doc 03 first-touch persistence, doc 11 workspace-baseline
 * preservation). These assertions fail if someone "finishes the job" on the
 * ResourceAccess side.
 */
describe('the ResourceAccess baseline path is untouched', () => {
  const WEB_SRC = path.resolve(process.cwd(), 'src')
  const read = (rel: string) => fs.readFileSync(path.join(WEB_SRC, rel), 'utf8')

  it.each([
    'components/permissions/hooks/use-def-baselines.ts',
    'components/permissions/hooks/use-def-access.ts',
  ])('%s still writes the role:org_member ResourceAccess marker', (rel) => {
    const src = read(rel)
    expect(src).toContain('ResourceGranteeType.role')
    expect(src).toContain('MEMBER_BASELINE_GRANTEE_ID')
    // Not routed through the PermissionGrant redirect, and never rewritten to a
    // profile grantee (profile-grantee ResourceAccess writes are refused until
    // doc 19 step 9 updates the remaining resolvers).
    expect(src).not.toContain('permissions-member-baseline')
    expect(src).not.toMatch(/granteeType:\s*'profile'/)
  })

  it('the resourceAccess router still accepts the role grantee', () => {
    // Doc 19 step 9 collapsed the router's six copies of the grantee enum into
    // one shared schema, so the marker now lives there — the router must still
    // parse with it, and must still not route through the PermissionGrant bridge.
    expect(read('server/api/grantee-schema.ts')).toContain('ResourceGranteeType.role')
    const src = read('server/api/routers/resourceAccess.ts')
    expect(src).toContain('granteeTypeSchema')
    expect(src).not.toContain('permissions-member-baseline')
  })

  it('composition still reads role:org_member from ResourceAccess but not PermissionGrant', () => {
    const src = fs.readFileSync(
      path.resolve(
        process.cwd(),
        '../../packages/lib/src/permissions/capabilities/compute-user-capabilities.ts'
      ),
      'utf8'
    )
    // The ResourceAccess grantee union keeps the marker...
    expect(src).toMatch(
      /schema\.ResourceAccess\.granteeType,\s*'role'\s*\)\s*,\s*eq\(\s*schema\.ResourceAccess\.granteeId,\s*'org_member'/
    )
    // ...while the PermissionGrant union does not (that tier is deleted, which is
    // exactly why the redirect exists).
    expect(src).not.toMatch(/schema\.PermissionGrant\.granteeType,\s*'role'/)
  })
})
