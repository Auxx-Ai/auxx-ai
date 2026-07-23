// apps/web/src/components/permissions/hooks/use-permission-grants.ts
'use client'

import type { Area, GranteeGrant, GrantGranteeType, Level } from '@auxx/lib/permissions/client'
import { toastError } from '@auxx/ui/components/toast'
import { useCallback, useMemo } from 'react'
import { api } from '~/trpc/react'

/** The fixed grantee id for the org-wide USER baseline (`role:org_member`). */
export const MEMBER_BASELINE_GRANTEE_ID = 'org_member'

/**
 * Loads every grant row for the org and exposes the three permission surfaces —
 * the member baseline (org policy), group overrides, and user overrides — plus
 * save/remove mutations that write sparse level maps through the grant service.
 *
 * A save of an empty map removes the row (falls back to inherit); a save of a
 * non-empty map upserts it. `listGrants` is invalidated after every write so the
 * grid re-hydrates. The `permission-grant.changed` realtime event separately
 * refreshes affected members' own capabilities.
 */
export function usePermissionGrants() {
  const utils = api.useUtils()
  const grantsQuery = api.permissions.listGrants.useQuery()
  const roleDefaultsQuery = api.permissions.roleDefaults.useQuery()

  const invalidate = useCallback(() => utils.permissions.listGrants.invalidate(), [utils])
  const grant = api.permissions.grant.useMutation({
    onSuccess: invalidate,
    onError: (error) =>
      toastError({ title: 'Error saving permission', description: error.message }),
  })
  const revoke = api.permissions.revoke.useMutation({
    onSuccess: invalidate,
    onError: (error) =>
      toastError({ title: 'Error clearing permission', description: error.message }),
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

  /** Upsert a grantee's sparse level map, or remove the row when it empties. */
  const save = useCallback(
    (granteeType: GrantGranteeType, granteeId: string, levels: Partial<Record<Area, Level>>) => {
      if (Object.keys(levels).length === 0) {
        revoke.mutate({ granteeType, granteeId })
      } else {
        // Sparse by contract — the router's `z.record` input type isn't partial.
        grant.mutate({ granteeType, granteeId, levels: levels as Record<Area, Level> })
      }
    },
    [grant, revoke]
  )

  const remove = useCallback(
    (granteeType: GrantGranteeType, granteeId: string) => revoke.mutate({ granteeType, granteeId }),
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
