// apps/web/src/components/permissions/hooks/use-permission-grants.test.ts

import { Area, Level } from '@auxx/lib/permissions/client'
import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The READ half of retiring the Member-baseline tab (plan 22 item 9).
 *
 * The tab addressed the org's `member` profile as `role:org_member`, and
 * `permissions-member-baseline.ts` rewrote that address in both directions at the
 * tRPC boundary. With the bridge deleted, `listGrants` returns the profile row
 * under its own profile id — so this hook has to find the baseline by resolving
 * the `member` slug through `listProfiles` instead of pattern-matching a grantee
 * literal.
 *
 * That matters beyond this hook: `baseline` is what `useDefBaselines` and
 * `useInstanceBaselineRows` render as each row's "Inherit · <level>", and what
 * every grantee-override grid measures a raise against. A silently-empty
 * `baseline` would show "Inherit · No access" on every workspace-default row
 * while composition said otherwise — a correct write path plus a lossy read
 * projection reads exactly like a broken mutation.
 */

const {
  listGrantsQuery,
  listProfilesQuery,
  roleDefaultsQuery,
  grantMutate,
  revokeMutate,
  granteeAccessInvalidate,
  grantOptions,
  revokeOptions,
} = vi.hoisted(() => ({
  listGrantsQuery: vi.fn(),
  listProfilesQuery: vi.fn(),
  roleDefaultsQuery: vi.fn(),
  grantMutate: vi.fn(),
  revokeMutate: vi.fn(),
  granteeAccessInvalidate: vi.fn(),
  /** The options object each mutation was registered with, so its hooks can be fired. */
  grantOptions: { current: undefined as undefined | { onSettled?: () => void } },
  revokeOptions: { current: undefined as undefined | { onSettled?: () => void } },
}))

vi.mock('~/trpc/react', () => ({
  api: {
    useUtils: () => ({
      permissions: {
        listGrants: { setData: vi.fn(), cancel: vi.fn(), invalidate: vi.fn() },
        granteeAccess: { invalidate: granteeAccessInvalidate },
      },
    }),
    permissions: {
      listGrants: { useQuery: listGrantsQuery },
      listProfiles: { useQuery: listProfilesQuery },
      roleDefaults: { useQuery: roleDefaultsQuery },
      grant: {
        useMutation: (options?: { onSettled?: () => void }) => {
          grantOptions.current = options
          return { mutate: grantMutate, isPending: false }
        },
      },
      revoke: {
        useMutation: (options?: { onSettled?: () => void }) => {
          revokeOptions.current = options
          return { mutate: revokeMutate, isPending: false }
        },
      },
    },
  },
}))

const { usePermissionGrants } = await import('./use-permission-grants')

const MEMBER_PROFILE_ID = 'pprf_membercuid00000000000000'
const CUSTOM_PROFILE_ID = 'pprf_supportcuid0000000000000'

/** The seeded Member baseline, trimmed to the areas these tests read. */
const MEMBER_LEVELS = {
  [Area.records]: Level.Full,
  [Area.datasets]: Level.Read,
  [Area.knowledgeBase]: Level.Edit,
}

/** `ROLE_DEFAULTS.USER` is the all-`None` floor post plan 22 — only these matter here. */
const ROLE_DEFAULTS = {
  [Area.records]: Level.None,
  [Area.datasets]: Level.None,
  [Area.knowledgeBase]: Level.None,
  [Area.files]: Level.None,
}

function setup(options: {
  grants?: Array<{ granteeType: string; granteeId: string; levels: unknown }>
  profiles?: Array<{ id: string; slug: string }>
  isLoading?: boolean
}) {
  listGrantsQuery.mockReturnValue({
    data: { grants: options.grants ?? [] },
    isLoading: options.isLoading ?? false,
  })
  listProfilesQuery.mockReturnValue({
    data: options.profiles ?? [],
    isLoading: options.isLoading ?? false,
  })
  roleDefaultsQuery.mockReturnValue({ data: ROLE_DEFAULTS, isLoading: false })
  return renderHook(() => usePermissionGrants()).result
}

beforeEach(() => {
  for (const fn of [
    listGrantsQuery,
    listProfilesQuery,
    roleDefaultsQuery,
    grantMutate,
    revokeMutate,
  ]) {
    fn.mockReset()
  }
})

describe('baseline — resolved through the member profile id', () => {
  it('reads the `member` profile row, matched by slug through listProfiles', () => {
    const result = setup({
      grants: [
        { granteeType: 'profile', granteeId: MEMBER_PROFILE_ID, levels: MEMBER_LEVELS },
        {
          granteeType: 'profile',
          granteeId: CUSTOM_PROFILE_ID,
          levels: { [Area.records]: Level.Read },
        },
      ],
      profiles: [
        { id: CUSTOM_PROFILE_ID, slug: 'support' },
        { id: MEMBER_PROFILE_ID, slug: 'member' },
      ],
    })

    expect(result.current.baseline).toEqual(MEMBER_LEVELS)
  })

  it('never picks up another profile as the baseline', () => {
    const result = setup({
      grants: [
        {
          granteeType: 'profile',
          granteeId: CUSTOM_PROFILE_ID,
          levels: { [Area.records]: Level.Full },
        },
      ],
      profiles: [
        { id: CUSTOM_PROFILE_ID, slug: 'support' },
        { id: MEMBER_PROFILE_ID, slug: 'member' },
      ],
    })

    // The member profile simply has no stored row — falling back to whichever
    // profile row happened to be first would hand the org a stranger's base.
    expect(result.current.baseline).toEqual({})
  })

  it('ignores a residual `role:org_member` PermissionGrant row', () => {
    const result = setup({
      grants: [
        {
          granteeType: 'role',
          granteeId: 'org_member',
          levels: { [Area.records]: Level.Full, [Area.files]: Level.Full },
        },
        { granteeType: 'profile', granteeId: MEMBER_PROFILE_ID, levels: MEMBER_LEVELS },
      ],
      profiles: [{ id: MEMBER_PROFILE_ID, slug: 'member' }],
    })

    // No composer reads that tier (`compute-user-capabilities.ts` queries
    // user/profile/group only), so surfacing it would show access nobody has.
    expect(result.current.baseline).toEqual(MEMBER_LEVELS)
  })

  it('is empty for an unseeded org, matching what the composer resolves', () => {
    const result = setup({
      grants: [{ granteeType: 'profile', granteeId: MEMBER_PROFILE_ID, levels: MEMBER_LEVELS }],
      profiles: [],
    })

    expect(result.current.baseline).toEqual({})
  })

  it('an explicit Level.None survives — it is the one downward lever', () => {
    const result = setup({
      grants: [
        {
          granteeType: 'profile',
          granteeId: MEMBER_PROFILE_ID,
          levels: { [Area.records]: Level.None },
        },
      ],
      profiles: [{ id: MEMBER_PROFILE_ID, slug: 'member' }],
    })

    // `0` must not be coerced to "unset" anywhere on the read path.
    expect(result.current.baseline[Area.records]).toBe(Level.None)
  })
})

describe('effectiveBaseline — role defaults under the member profile', () => {
  it('layers the member profile over the all-None floor', () => {
    const result = setup({
      grants: [{ granteeType: 'profile', granteeId: MEMBER_PROFILE_ID, levels: MEMBER_LEVELS }],
      profiles: [{ id: MEMBER_PROFILE_ID, slug: 'member' }],
    })

    expect(result.current.effectiveBaseline).toEqual({ ...ROLE_DEFAULTS, ...MEMBER_LEVELS })
    // `files` is unset on the profile, so it stays at the floor.
    expect(result.current.effectiveBaseline[Area.files]).toBe(Level.None)
  })
})

describe('the grant buckets', () => {
  it('keeps profile rows out of the override buckets and lists them separately', () => {
    const result = setup({
      grants: [
        { granteeType: 'profile', granteeId: MEMBER_PROFILE_ID, levels: MEMBER_LEVELS },
        { granteeType: 'group', granteeId: 'grp_1', levels: { [Area.files]: Level.Full } },
        { granteeType: 'user', granteeId: 'usr_1', levels: { [Area.files]: Level.Edit } },
      ],
      profiles: [{ id: MEMBER_PROFILE_ID, slug: 'member' }],
    })

    expect(result.current.groupGrants.map((g) => g.granteeId)).toEqual(['grp_1'])
    expect(result.current.userGrants.map((g) => g.granteeId)).toEqual(['usr_1'])
    // A profile is the composition BASE, not a raise above it.
    expect(result.current.profileGrants.map((g) => g.granteeId)).toEqual([MEMBER_PROFILE_ID])
  })

  it('waits on the profile list before reporting loaded', () => {
    listGrantsQuery.mockReturnValue({ data: { grants: [] }, isLoading: false })
    listProfilesQuery.mockReturnValue({ data: undefined, isLoading: true })
    roleDefaultsQuery.mockReturnValue({ data: ROLE_DEFAULTS, isLoading: false })

    const { result } = renderHook(() => usePermissionGrants())

    // Without this the def/instance rows render one frame of "Inherit · No
    // access" before the profile id arrives and the real baseline appears.
    expect(result.current.isLoading).toBe(true)
  })
})

describe('the write surface', () => {
  it('save/remove reach the grant service for group and user grantees', () => {
    const result = setup({ profiles: [{ id: MEMBER_PROFILE_ID, slug: 'member' }] })

    result.current.save('group', 'grp_1', { [Area.files]: Level.Full })
    expect(grantMutate).toHaveBeenCalledWith({
      granteeType: 'group',
      granteeId: 'grp_1',
      levels: { [Area.files]: Level.Full },
    })

    result.current.remove('user', 'usr_1')
    expect(revokeMutate).toHaveBeenCalledWith({ granteeType: 'user', granteeId: 'usr_1' })
  })
})

/**
 * Plan 31 §2.5 — **an area write has to refetch `granteeAccess`.**
 *
 * This hook keeps `listGrants` optimistic and deliberately never refetches it on
 * success: the server stores exactly the sparse map the client sends, so the
 * local patch is already the truth. `granteeAccess.effective` is not like that.
 * It is COMPOSED — `min(min(max(profileBase, maxOverGroups, userLevel),
 * profileCeiling), seatCeiling)` — so this write moves it and no optimistic patch
 * here could predict the new value without re-implementing composition, which
 * §2.5 rules out precisely because a display path that drifts from enforcement
 * fails quietly.
 *
 * The bug this pins: raising a member's area level left the effective line
 * showing the pre-write composition for up to `granteeAccess`'s 30s `staleTime`.
 * The server was already correct — `setGranteeLevels` awaits
 * `onCacheEvent('permission-grant.changed', …)` after commit, so the composed
 * blob is busted before the mutation returns. Only the client refetch was
 * missing, and the `permission-grant.changed` realtime nudge does not cover it:
 * that targets the AFFECTED member's own client, not the admin sitting on their
 * Permissions tab.
 */
describe('granteeAccess is refetched after an area-level write', () => {
  beforeEach(() => {
    granteeAccessInvalidate.mockClear()
    // Through `setup`, not a bare `renderHook`: the file's outer `beforeEach`
    // resets the query mocks, so the hook needs them re-stubbed to render.
    setup({ grants: [], profiles: [] })
  })

  it('invalidates on a successful grant, not only on failure', () => {
    grantOptions.current?.onSettled?.()

    expect(granteeAccessInvalidate).toHaveBeenCalledTimes(1)
  })

  it('invalidates on revoke too', () => {
    revokeOptions.current?.onSettled?.()

    expect(granteeAccessInvalidate).toHaveBeenCalledTimes(1)
  })

  /**
   * Whole keyspace, no input filter. `own` is per-grantee but `effective` is not:
   * a GROUP grant changes every member of that group, so scoping the
   * invalidation to the grantee that was written is the obvious-looking version
   * and is wrong in exactly the cases the effective line exists to expose.
   */
  it('invalidates every granteeAccess query, not just the written grantee', () => {
    grantOptions.current?.onSettled?.()

    expect(granteeAccessInvalidate).toHaveBeenCalledWith()
  })
})
