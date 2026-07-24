// apps/web/src/components/permissions/hooks/use-def-baselines.ts
'use client'

import { ResourceGranteeType, ResourcePermission } from '@auxx/database/enums'
import { Area, Level } from '@auxx/lib/permissions/client'
import { isAccessManageable, type Resource } from '@auxx/lib/resources/client'
import { toastError } from '@auxx/ui/components/toast'
import { useCallback, useMemo } from 'react'
import { useResources } from '~/components/resources/hooks'
import { api } from '~/trpc/react'
import { LEVEL_TO_PERMISSION } from '../access-levels'
import { MEMBER_BASELINE_GRANTEE_ID, usePermissionGrants } from './use-permission-grants'

/** One CRM def's row under the expandable Records area. */
export interface DefBaselineRow {
  resource: Resource
  /**
   * The def's persisted `role:org_member` permission, or `undefined` when no row
   * exists — the def falls through to the Records area level (= "Inherit").
   */
  baselineLevel: ResourcePermission | undefined
  /**
   * What an unconfigured def resolves to: the member baseline's Records rung
   * mapped to a record permission. Rendered inline on the Inherit option, so the
   * child always names the level the parent row directly above it is set to.
   */
  inheritedLevel: ResourcePermission
  /** Baseline explicitly `none` → the def is restricted (hidden unless granted). */
  isLockedDown: boolean
}

/**
 * The org-wide **workspace baseline** per CRM def — the `role:org_member`
 * type-level `ResourceAccess` row that the per-def Permissions tab writes as
 * "Default for all members" (`use-def-access`), read in bulk so the permissions
 * page can nest every def under its Layer-2 Records row.
 *
 * Reads `resourceAccess.allTypeAccess` (all type rows, org-wide) plus
 * `useResources`, and derives per def: the configured baseline (if any), the
 * level it inherits from the member baseline's Records rung, and whether it is
 * locked down. Writes go through `grantType` / `revokeType` with an optimistic
 * cache patch, so picking **No Access** shows its restriction lock without a
 * reload.
 *
 * Unlike {@link useGranteeDefAccess} there is no first-touch baseline write to
 * make — this surface *is* the baseline. Invalidation is broadened to the whole
 * `resourceAccess` namespace because the per-def tab reads the same rows under a
 * different query key (`forType`). Errors surface via `toastError`.
 */
export function useDefBaselines() {
  const utils = api.useUtils()
  const { resources, isLoading: resourcesLoading } = useResources()
  const { isLoading: grantsLoading, roleDefaults, baseline } = usePermissionGrants()

  /**
   * The parent Records rung as a record permission — the member baseline's own
   * level if stored, else the USER role default. This must follow the parent
   * row, not a constant: it is rendered directly beneath it.
   */
  const recordsPermission = useMemo<ResourcePermission>(() => {
    const level = baseline[Area.records] ?? roleDefaults?.[Area.records] ?? Level.None
    return LEVEL_TO_PERMISSION[level]
  }, [baseline, roleDefaults])

  const rowsQuery = api.resourceAccess.allTypeAccess.useQuery(undefined, { staleTime: 30_000 })

  // Broad: `forType` (per-def tab) and `allTypeAccess` (here) are separate keys
  // over the same rows — a write on either surface must refresh both.
  const invalidate = useCallback(() => utils.resourceAccess.invalidate(), [utils])

  /** Optimistically upsert (or, with `permission` undefined, drop) one baseline row. */
  const patchLocal = useCallback(
    (entityDefinitionId: string, permission?: ResourcePermission) => {
      utils.resourceAccess.allTypeAccess.setData(undefined, (prev) => {
        const rows = (prev ?? []).filter(
          (r) =>
            !(
              r.entityDefinitionId === entityDefinitionId &&
              r.granteeType === ResourceGranteeType.role &&
              r.granteeId === MEMBER_BASELINE_GRANTEE_ID
            )
        )
        if (permission) {
          rows.unshift({
            id: `optimistic-${entityDefinitionId}-baseline`,
            entityDefinitionId,
            entityInstanceId: null,
            granteeType: ResourceGranteeType.role,
            granteeId: MEMBER_BASELINE_GRANTEE_ID,
            permission,
            createdAt: new Date(),
          } as (typeof rows)[number])
        }
        return rows
      })
    },
    [utils]
  )

  const grantType = api.resourceAccess.grantType.useMutation({
    onError: (error) => {
      toastError({ title: 'Error saving access', description: error.message })
      void invalidate()
    },
    onSettled: () => void invalidate(),
  })
  const revokeType = api.resourceAccess.revokeType.useMutation({
    onError: (error) => {
      toastError({ title: 'Error removing access', description: error.message })
      void invalidate()
    },
    onSettled: () => void invalidate(),
  })

  const allRows = useMemo(() => rowsQuery.data ?? [], [rowsQuery.data])

  /** Per-def baseline permission (`role:org_member` row), keyed by def id. */
  const baselineByDef = useMemo(() => {
    const map = new Map<string, ResourcePermission>()
    for (const r of allRows) {
      if (
        r.granteeType === ResourceGranteeType.role &&
        r.granteeId === MEMBER_BASELINE_GRANTEE_ID
      ) {
        map.set(r.entityDefinitionId, r.permission)
      }
    }
    return map
  }, [allRows])

  const rows = useMemo<DefBaselineRow[]>(
    () =>
      resources
        .filter(isAccessManageable)
        .map((resource) => {
          const baselineLevel = baselineByDef.get(resource.entityDefinitionId)
          return {
            resource,
            baselineLevel,
            inheritedLevel: recordsPermission,
            isLockedDown: baselineLevel === ResourcePermission.none,
          }
        })
        .sort((a, b) => a.resource.plural.localeCompare(b.resource.plural)),
    [resources, baselineByDef, recordsPermission]
  )

  /**
   * Set a def's workspace baseline. `'inherit'` deletes the row so the def falls
   * back to the Records area level; every explicit level (including `none`, the
   * restriction marker) writes it.
   */
  const setBaseline = useCallback(
    (entityDefinitionId: string, level: ResourcePermission | 'inherit') => {
      if (level === 'inherit') {
        patchLocal(entityDefinitionId)
        revokeType.mutate({
          entityDefinitionId,
          granteeType: ResourceGranteeType.role,
          granteeId: MEMBER_BASELINE_GRANTEE_ID,
        })
        return
      }
      patchLocal(entityDefinitionId, level)
      grantType.mutate({
        entityDefinitionId,
        granteeType: ResourceGranteeType.role,
        granteeId: MEMBER_BASELINE_GRANTEE_ID,
        permission: level,
      })
    },
    [grantType, revokeType, patchLocal]
  )

  return {
    isLoading: resourcesLoading || rowsQuery.isLoading || grantsLoading,
    rows,
    setBaseline,
  }
}
