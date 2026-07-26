// apps/web/src/components/members/hooks/use-member-profiles.ts
'use client'

import type { OrganizationRole, SeatType } from '@auxx/database/types'
import {
  AREA_ORDER,
  type Area,
  Level,
  PERMISSION_AREAS,
  PermissionKey,
} from '@auxx/lib/permissions/client'
import { useCallback, useMemo } from 'react'
import { useAccess } from '~/providers/capabilities-provider'
import type { RouterOutputs } from '~/trpc/react'
import { api } from '~/trpc/react'

/**
 * One row of `permissions.listProfiles` — identity plus `baseLevel`, which is
 * everything the delta math needs. A profile is base access; there is no policy
 * blob a member surface has to fetch separately.
 */
export type MemberProfile = RouterOutputs['permissions']['listProfiles'][number]

/**
 * The legacy `PermissionGrant` address the shipped baseline tab still writes.
 * `permissions-member-baseline.ts` presents the org's `member` profile row under
 * this grantee in BOTH directions, so a lookup by `profile:<member profile id>`
 * finds nothing — see {@link profileLevels}.
 *
 * TODO(plan-19-step-7): drops out with the bridge.
 */
const LEGACY_BASELINE = { granteeType: 'role', granteeId: 'org_member' } as const

/** A profile option for one member, with the §0.21 seat-mismatch verdict. */
export interface ProfileOption {
  profile: MemberProfile
  /** True when this profile cannot be bound to the member as they stand today. */
  disabled: boolean
  /** Why it is disabled — rendered inline on the option, never only as a tooltip. */
  reason?: string
}

/** One area's before/after rung in a reassignment delta. */
export interface AreaDelta {
  area: Area
  label: string
  group: string
  before: Level
  after: Level
}

/** The complete effective delta of swapping one profile for another (§7). */
export interface ProfileDelta {
  areas: AreaDelta[]
  /** True when nothing measurable changes. */
  isEmpty: boolean
}

/** Human label for a rung, mirroring `LEVEL_LABELS` in the permissions UI. */
export const RUNG_LABELS: Record<Level, string> = {
  [Level.None]: 'No access',
  [Level.Read]: 'Read',
  [Level.Edit]: 'Edit',
  [Level.Full]: 'Full',
}

/** Seat-class wording — the DB value stays `'worker'`, the label is "Field seat". */
export function seatLabel(seat: SeatType): string {
  return seat === 'worker' ? 'Field seat' : 'Full seat'
}

/**
 * Loads the org's permission profiles plus the grant rows that give them their
 * per-area base, and derives the two things every member surface needs:
 * seat-filtered options (§0.21) and the complete effective delta of a
 * reassignment (§7).
 *
 * Reads only. Assignment lives in `use-assign-profile`.
 *
 * `listProfiles` / `listGrants` are `permissions.manage`-gated procedures, so
 * both queries stay disabled for a member who only holds `members.manage` —
 * their member surfaces simply render without profile chrome rather than
 * throwing.
 */
export function useMemberProfiles() {
  const { can } = useAccess()
  const canManageProfiles = can(PermissionKey.permissionsManage)

  const profilesQuery = api.permissions.listProfiles.useQuery(undefined, {
    enabled: canManageProfiles,
    staleTime: 60_000,
  })
  const grantsQuery = api.permissions.listGrants.useQuery(undefined, {
    enabled: canManageProfiles,
    staleTime: 30_000,
  })
  // The USER role's code defaults — a server constant, never worth refetching.
  const roleDefaultsQuery = api.permissions.roleDefaults.useQuery(undefined, {
    enabled: canManageProfiles,
    staleTime: Number.POSITIVE_INFINITY,
  })

  /** Every profile a HUMAN member may bind (agent-only profiles are a different principal). */
  const profiles = useMemo(
    () => (profilesQuery.data ?? []).filter((p) => p.appliesTo !== 'agent'),
    [profilesQuery.data]
  )

  const profileById = useMemo(() => {
    const map = new Map<string, MemberProfile>()
    for (const profile of profiles) map.set(profile.id, profile)
    return map
  }, [profiles])

  const profileBySlug = useMemo(() => {
    const map = new Map<string, MemberProfile>()
    for (const profile of profiles) map.set(profile.slug, profile)
    return map
  }, [profiles])

  /**
   * The §1.3 null-binding fallback, resolved client-side exactly as the server
   * resolves it: OWNER → `owner`, ADMIN → `admin`, worker seat → `field_tech`,
   * otherwise `member`.
   */
  const systemProfileFor = useCallback(
    (role: OrganizationRole, seatType: SeatType): MemberProfile | undefined => {
      if (role === 'OWNER') return profileBySlug.get('owner')
      if (role === 'ADMIN') return profileBySlug.get('admin')
      return profileBySlug.get(seatType === 'worker' ? 'field_tech' : 'member')
    },
    [profileBySlug]
  )

  /** The profile a member is effectively composing from right now. */
  const resolveMemberProfile = useCallback(
    (member: {
      role: OrganizationRole
      seatType: SeatType
      permissionProfileId?: string | null
    }): MemberProfile | undefined => {
      const bound = member.permissionProfileId
        ? profileById.get(member.permissionProfileId)
        : undefined
      return bound ?? systemProfileFor(member.role, member.seatType)
    },
    [profileById, systemProfileFor]
  )

  /** The profile's own sparse per-area levels, off its `PermissionGrant` row. */
  const profileLevels = useCallback(
    (profile: MemberProfile | undefined): Partial<Record<Area, Level>> => {
      if (!profile) return {}
      const grants = grantsQuery.data?.grants ?? []
      const own = grants.find(
        (g) => g.granteeType === 'profile' && g.granteeId === profile.id
      )?.levels
      if (own) return own as Partial<Record<Area, Level>>
      // The `member` profile's row is presented under the legacy baseline address.
      if (profile.slug === 'member') {
        const bridged = grants.find(
          (g) =>
            g.granteeType === LEGACY_BASELINE.granteeType &&
            g.granteeId === LEGACY_BASELINE.granteeId
        )?.levels
        if (bridged) return bridged as Partial<Record<Area, Level>>
      }
      return {}
    },
    [grantsQuery.data]
  )

  /**
   * One profile's effective rung for one area, following the human composer:
   * `base = levels[area] ?? baseLevel ?? roleDefault[area]`, raised by the
   * member's group/personal grants. Composition is purely additive.
   *
   * The seat ceiling is deliberately NOT applied — it is not exported to the
   * client, and it is identical on both sides of a reassignment (§0.21 forbids a
   * profile from moving a member's seat class), so it can never be the thing a
   * delta is about. Worker-seat deltas carry an explicit footnote instead.
   */
  const effectiveLevels = useCallback(
    (
      profile: MemberProfile | undefined,
      role: OrganizationRole,
      raises: Array<Partial<Record<Area, Level>>>
    ): Record<Area, Level> => {
      const roleDefaults = roleDefaultsQuery.data
      const levels = profileLevels(profile)
      const out = {} as Record<Area, Level>

      for (const area of AREA_ORDER) {
        // OWNER/ADMIN profiles carry an explicit `baseLevel`, so the USER role
        // defaults are only consulted for a USER — which is the only role the
        // server exposes them for.
        const roleDefault = role === 'USER' ? (roleDefaults?.[area] ?? Level.None) : Level.Full
        let level = levels[area] ?? profile?.baseLevel ?? roleDefault
        for (const raise of raises) level = Math.max(level, raise[area] ?? Level.None)
        out[area] = level as Level
      }
      return out
    },
    [profileLevels, roleDefaultsQuery.data]
  )

  /**
   * The raise-only tiers a member carries independently of their profile — their
   * group grants plus their personal grant. Both sides of a delta fold them in,
   * so a row only moves when the two profiles' own bases differ above them.
   */
  const raisesFor = useCallback(
    (userId: string, groupIds: string[]): Array<Partial<Record<Area, Level>>> => {
      const grants = grantsQuery.data?.grants ?? []
      const raises: Array<Partial<Record<Area, Level>>> = []
      for (const grant of grants) {
        const isGroupRaise = grant.granteeType === 'group' && groupIds.includes(grant.granteeId)
        const isUserRaise = grant.granteeType === 'user' && grant.granteeId === userId
        if (isGroupRaise || isUserRaise) raises.push(grant.levels as Partial<Record<Area, Level>>)
      }
      return raises
    },
    [grantsQuery.data]
  )

  /** The complete effective delta between two profiles for one member (§7). */
  const buildDelta = useCallback(
    (input: {
      role: OrganizationRole
      from: MemberProfile | undefined
      to: MemberProfile | undefined
      raises: Array<Partial<Record<Area, Level>>>
      /** The member's seat — a `workerOnly` area is only real on a field seat. */
      seat?: SeatType
    }): ProfileDelta => {
      const before = effectiveLevels(input.from, input.role, input.raises)
      const after = effectiveLevels(input.to, input.role, input.raises)
      const areas: AreaDelta[] = []
      for (const area of AREA_ORDER) {
        const meta = PERMISSION_AREAS[area]
        // `adminOnly` is never grantable below ADMIN; `workerOnly` is enforced
        // only on a field seat, so a full-seat row for it would be noise.
        if (meta.adminOnly) continue
        if (meta.workerOnly && input.seat !== 'worker') continue
        const b = before[area]
        const a = after[area]
        if (b === a) continue
        areas.push({ area, label: meta.label, group: meta.group, before: b, after: a })
      }
      return { areas, isEmpty: areas.length === 0 }
    },
    [effectiveLevels]
  )

  /**
   * Every profile offered for one member, in list order, each carrying its
   * seat-mismatch verdict. A mismatched profile is **kept and disabled with a
   * reason** rather than hidden (§0.21/§0.22) — hiding it would read as "this
   * profile does not exist", which is exactly the confusion the rule prevents.
   */
  const optionsFor = useCallback(
    (member: { role: OrganizationRole; seatType: SeatType }): ProfileOption[] =>
      profiles.map((profile) => {
        if (profile.seat !== member.seatType) {
          return {
            profile,
            disabled: true,
            reason:
              profile.seat === 'worker'
                ? 'Field-seat profile — this member holds a full seat. Change the seat first.'
                : 'Full-seat profile — this member holds a field seat. Change the seat first.',
          }
        }
        // `seatType='worker' ⇒ role='USER'`: a field-seat profile never binds to
        // an Admin/Owner. Unreachable while the seats match, kept as the explicit
        // statement of the invariant.
        if (profile.seat === 'worker' && member.role !== 'USER') {
          return {
            profile,
            disabled: true,
            reason: 'Field-seat profiles are only available to members with the Member role.',
          }
        }
        return { profile, disabled: false }
      }),
    [profiles]
  )

  return {
    canManageProfiles,
    profiles,
    profileById,
    isLoading: profilesQuery.isLoading || grantsQuery.isLoading,
    systemProfileFor,
    resolveMemberProfile,
    optionsFor,
    raisesFor,
    buildDelta,
  }
}
