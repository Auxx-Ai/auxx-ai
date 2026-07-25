// apps/web/src/components/permissions/hooks/use-permission-grants.ts
'use client'

import type { Area, GranteeGrant, GrantGranteeType, Level } from '@auxx/lib/permissions/client'
import { toastError } from '@auxx/ui/components/toast'
import { useCallback, useMemo } from 'react'
import { api } from '~/trpc/react'

/**
 * The fixed grantee id for the org-wide USER baseline (`role:org_member`).
 *
 * TODO(plan-19-step-7): the composer no longer reads the `role:org_member`
 * `PermissionGrant` tier — the bound **Member profile** is the baseline (doc 19
 * §0.8), and data migration 041 moved every org's levels onto
 * `granteeType:'profile'`. Until this surface becomes the Member-profile editor
 * (doc 19 §7 "Member baseline tab"), `apps/web/src/server/api/routers/
 * permissions-member-baseline.ts` redirects this address onto the org's `member`
 * profile in BOTH directions, so the client keeps using it unchanged. Group and
 * user override rows on this page are unaffected — those tiers are unchanged.
 *
 * This id is also the `ResourceAccess` def/instance baseline marker
 * (`use-def-baselines`, `use-def-access`, `use-instance-share`), which is a
 * SEPARATE, still-live mechanism — nothing redirects those rows.
 */
export const MEMBER_BASELINE_GRANTEE_ID = 'org_member'

/**
 * Loads every grant row for the org and exposes the three permission surfaces —
 * the member baseline (org policy), group overrides, and user overrides — plus
 * save/remove mutations that write sparse level maps through the grant service.
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

  const baseline = useMemo<Partial<Record<Area, Level>>>(
    () =>
      grants.find((g) => g.granteeType === 'role' && g.granteeId === MEMBER_BASELINE_GRANTEE_ID)
        ?.levels ?? {},
    [grants]
  )
  const groupGrants = useMemo<GranteeGrant[]>(
    () => grants.filter((g) => g.granteeType === 'group'),
    [grants]
  )
  const userGrants = useMemo<GranteeGrant[]>(
    () => grants.filter((g) => g.granteeType === 'user'),
    [grants]
  )

  /** The effective member baseline per area — role default merged with org policy. */
  const effectiveBaseline = useMemo<Partial<Record<Area, Level>>>(
    () => ({ ...(roleDefaults ?? {}), ...baseline }),
    [roleDefaults, baseline]
  )

  /**
   * Upsert a grantee's sparse level map (`{}` stores an empty override row).
   *
   * Typed as `GrantGranteeType` minus `'profile'`: this page addresses the base
   * tier as `role:org_member` and the router redirects it onto the org's `member`
   * profile (`permissions-member-baseline.ts`), so `permissions.grant`'s input enum
   * deliberately still excludes `'profile'` — TODO(plan-19-step-7) widens it when
   * the Profiles editor lands and this indirection goes away.
   */
  const save = useCallback(
    (
      granteeType: Exclude<GrantGranteeType, 'profile'>,
      granteeId: string,
      levels: Partial<Record<Area, Level>>
    ) => {
      // Sparse by contract — the router's `z.record` input type isn't partial.
      grant.mutate({ granteeType, granteeId, levels: levels as Record<Area, Level> })
    },
    [grant]
  )

  const remove = useCallback(
    (granteeType: Exclude<GrantGranteeType, 'profile'>, granteeId: string) =>
      revoke.mutate({ granteeType, granteeId }),
    [revoke]
  )

  return {
    isLoading: grantsQuery.isLoading || roleDefaultsQuery.isLoading,
    roleDefaults,
    baseline,
    groupGrants,
    userGrants,
    effectiveBaseline,
    isSaving: grant.isPending || revoke.isPending,
    save,
    remove,
  }
}
