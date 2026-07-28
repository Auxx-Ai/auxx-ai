// apps/web/src/components/permissions/hooks/use-permission-grants.ts
'use client'

import type { Area, GranteeGrant, GrantGranteeType, Level } from '@auxx/lib/permissions/client'
import { toastError } from '@auxx/ui/components/toast'
import { useCallback, useMemo } from 'react'
import { api } from '~/trpc/react'

/**
 * The fixed `ResourceAccess` grantee id for the org-wide **workspace default** —
 * the `role:org_member` row that says "this is what every member gets on this
 * record type / dataset / KB / dashboard / workflow" (`use-def-baselines`,
 * `use-def-access`, `use-instance-baseline-rows`, `use-instance-share`).
 *
 * `ResourceAccess` ONLY. The identically-addressed `PermissionGrant` tier was
 * deleted in plan 19 §0.8 — the bound **Member profile** is the area-level
 * baseline, and it is edited in exactly one place, Profiles → Member. Nothing
 * here writes a `role` grant row anymore, and `permissions.grant`'s input enum
 * no longer accepts one.
 */
export const MEMBER_BASELINE_GRANTEE_ID = 'org_member'

/** The `PermissionProfile.slug` that IS the org-wide member baseline (doc 19 §0.8). */
const MEMBER_PROFILE_SLUG = 'member'

/**
 * The grantee tiers `permissions.grant` / `permissions.revoke` accept: the two
 * raise-only overrides. `'profile'` (a composition BASE) and the dead legacy
 * `'role'` are excluded on the wire — see the router's `granteeType`.
 */
export type OverrideGranteeType = Extract<GrantGranteeType, 'group' | 'user'>

/**
 * Loads every grant row for the org and exposes the permission surfaces it
 * feeds — the profile bases, group overrides and user overrides, plus the Member
 * profile's own levels as the {@link baseline} every override is measured
 * against — with save/remove mutations that write sparse level maps through the
 * grant service.
 *
 * `save`/`remove` reach the **override** tiers only (`group`, `user`). A
 * profile's base is written by `permissions.saveProfile` (see
 * {@link useProfileEditor}), the only path that runs the doc 19 §6.1 escalation
 * guard over each holder's resulting effective state.
 *
 * `save` always upserts — an empty map stores an empty override row, which
 * composes to nothing but keeps the grantee listed across reloads; `remove`
 * deletes the row. Writes update the `listGrants` cache optimistically
 * (the server stores exactly the sparse map the client sends), so successful
 * saves never refetch — only a failed write invalidates to re-sync. The
 * `permission-grant.changed` realtime event separately refreshes affected
 * members' own capabilities.
 */
export function usePermissionGrants() {
  const utils = api.useUtils()
  const grantsQuery = api.permissions.listGrants.useQuery(undefined, { staleTime: 30_000 })
  // The USER role's code defaults — a server constant, never worth refetching.
  const roleDefaultsQuery = api.permissions.roleDefaults.useQuery(undefined, {
    staleTime: Number.POSITIVE_INFINITY,
  })
  // Grant rows are keyed by profile ID; only the profile list knows which id is
  // the `member` slug. Same query key as `useProfiles`, so React Query dedupes it.
  const profilesQuery = api.permissions.listProfiles.useQuery(undefined, { staleTime: 30_000 })

  /** Upsert (or drop, when `levels` is undefined) one grantee row in the cache. */
  const setLocalGrant = useCallback(
    (granteeType: GrantGranteeType, granteeId: string, levels?: Partial<Record<Area, Level>>) => {
      utils.permissions.listGrants.setData(undefined, (prev) => {
        if (!prev) return prev
        const grants = prev.grants.filter(
          (g) => !(g.granteeType === granteeType && g.granteeId === granteeId)
        )
        if (levels) grants.push({ granteeType, granteeId, levels })
        return { grants }
      })
    },
    [utils]
  )
  const resync = useCallback(() => utils.permissions.listGrants.invalidate(), [utils])

  const grant = api.permissions.grant.useMutation({
    onMutate: async (input) => {
      await utils.permissions.listGrants.cancel()
      setLocalGrant(
        input.granteeType,
        input.granteeId,
        input.levels as Partial<Record<Area, Level>>
      )
    },
    onError: (error) => {
      toastError({ title: 'Error saving permission', description: error.message })
      void resync()
    },
  })
  const revoke = api.permissions.revoke.useMutation({
    onMutate: async (input) => {
      await utils.permissions.listGrants.cancel()
      setLocalGrant(input.granteeType, input.granteeId)
    },
    onError: (error) => {
      toastError({ title: 'Error clearing permission', description: error.message })
      void resync()
    },
  })

  const grants = useMemo(() => grantsQuery.data?.grants ?? [], [grantsQuery.data])
  const roleDefaults = roleDefaultsQuery.data

  /** The org's `member` system profile — the row every other tier is measured against. */
  const memberProfileId = useMemo(
    () => profilesQuery.data?.find((p) => p.slug === MEMBER_PROFILE_SLUG)?.id,
    [profilesQuery.data]
  )

  /**
   * The org-wide member baseline: the `member` profile's stored area levels
   * (doc 19 §0.8). Read-only here — this hook has no write path to it, by
   * design. Empty when the org has no `member` profile row, which is the same
   * state `resolveBaseProfile` composes against.
   */
  const baseline = useMemo<Partial<Record<Area, Level>>>(
    () =>
      (memberProfileId
        ? grants.find((g) => g.granteeType === 'profile' && g.granteeId === memberProfileId)?.levels
        : undefined) ?? {},
    [grants, memberProfileId]
  )
  const groupGrants = useMemo<GranteeGrant[]>(
    () => grants.filter((g) => g.granteeType === 'group'),
    [grants]
  )
  const userGrants = useMemo<GranteeGrant[]>(
    () => grants.filter((g) => g.granteeType === 'user'),
    [grants]
  )

  /**
   * Permission-profile grant rows — the area-level base for every member bound to
   * that profile (doc 19 §0.1/§0.8). Every org has six after data migration 049.
   *
   * These are NOT overrides and must never be folded into {@link groupGrants} /
   * {@link userGrants}: they compose as the base tier, not as a raise above it.
   * Before this bucket existed the three filters simply dropped them, so the
   * settings page silently showed nothing for the majority of an org's stored
   * grant rows. The org's `member` profile is one of these rows; it is also
   * surfaced on its own as {@link baseline}.
   *
   * Read-only here on purpose: the Profiles editor writes them through
   * `permissions.saveProfile`, whose transaction is the only place the §6.1
   * escalation guard can run. `permissions.grant`'s input enum excludes
   * `'profile'` for exactly that reason (see {@link save}).
   */
  const profileGrants = useMemo<GranteeGrant[]>(
    () => grants.filter((g) => g.granteeType === 'profile'),
    [grants]
  )

  /** The effective member baseline per area — role default merged with org policy. */
  const effectiveBaseline = useMemo<Partial<Record<Area, Level>>>(
    () => ({ ...(roleDefaults ?? {}), ...baseline }),
    [roleDefaults, baseline]
  )

  /**
   * Upsert an override grantee's sparse level map (`{}` stores an empty row).
   *
   * Narrowed to the two raise-only tiers, matching `permissions.grant`'s input
   * enum. `'profile'` and the legacy `'role'` are both excluded server-side
   * because `setGranteeLevels` runs no escalation guard; a profile base is
   * written through `permissions.saveProfile` instead.
   */
  const save = useCallback(
    (granteeType: OverrideGranteeType, granteeId: string, levels: Partial<Record<Area, Level>>) => {
      // Sparse by contract — the router's `z.record` input type isn't partial.
      grant.mutate({ granteeType, granteeId, levels: levels as Record<Area, Level> })
    },
    [grant]
  )

  const remove = useCallback(
    (granteeType: OverrideGranteeType, granteeId: string) =>
      revoke.mutate({ granteeType, granteeId }),
    [revoke]
  )

  return {
    isLoading: grantsQuery.isLoading || roleDefaultsQuery.isLoading || profilesQuery.isLoading,
    roleDefaults,
    baseline,
    groupGrants,
    userGrants,
    profileGrants,
    effectiveBaseline,
    isSaving: grant.isPending || revoke.isPending,
    save,
    remove,
  }
}
