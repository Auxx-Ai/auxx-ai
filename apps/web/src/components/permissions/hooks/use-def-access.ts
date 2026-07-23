// apps/web/src/components/permissions/hooks/use-def-access.ts
'use client'

import { ResourceGranteeType, ResourcePermission } from '@auxx/database/enums'
import { toastError } from '@auxx/ui/components/toast'
import { useCallback, useMemo } from 'react'
import { api } from '~/trpc/react'
import { MEMBER_BASELINE_GRANTEE_ID } from './use-permission-grants'

/** A resolved team/member grant (grantees never carry `none`). */
export interface DefAccessGrant {
  granteeId: string
  permission: ResourcePermission
}

/** Client-safe rank for the "ignored" comparison (`none` < view < edit < admin). */
const PERMISSION_RANK: Record<ResourcePermission, number> = {
  [ResourcePermission.none]: 0,
  [ResourcePermission.view]: 1,
  [ResourcePermission.edit]: 2,
  [ResourcePermission.admin]: 3,
}

/**
 * The workspace baseline an unconfigured def displays and persists on first
 * touch — every member's default access to the def (matches Attio's read-write
 * default). Set to `edit` (Read and write).
 */
const DEFAULT_BASELINE_LEVEL: ResourcePermission = ResourcePermission.edit

/**
 * The level a newly added team/member grant defaults to. `admin` (Full access)
 * so a fresh grant sits above the read-write baseline and isn't instantly
 * flagged "ignored" (mirrors Attio, where added grantees default to Full).
 */
const DEFAULT_GRANTEE_LEVEL: ResourcePermission = ResourcePermission.admin

/**
 * Manages the entity-def Access configuration (capability layer v2 phase 3) for
 * one CRM def: the workspace baseline (`role:org_member`), team (`group`) grants,
 * and individual member (`user`) grants — all stored as type-level `ResourceAccess`
 * rows keyed by the def's `entityDefinitionId` CUID.
 *
 * Semantics (plan §1):
 * - **Unconfigured** (`isConfigured=false`): no rows, def visible to everyone;
 *   the baseline displays as the default (Read and write) and nothing is
 *   persisted until touched.
 * - **First-touch additive**: adding a grant while no baseline row exists ALSO
 *   writes `role:org_member @ <default baseline>`, so everyone keeps the default
 *   access while the grantee is raised — a new grant never silently locks others out.
 * - **Lockdown**: only Workspace access = `none` restricts non-grantees.
 * - **Reset**: `resetToDefault()` clears every row, returning the def to the
 *   dormant/unrestricted state.
 *
 * Writes are optimistic; the `resource-access.type.changed` realtime event
 * re-composes affected members' capabilities, and the query invalidates on
 * settle to reconcile. Errors surface via `toastError`.
 */
export function useDefAccess(entityDefinitionId: string | undefined) {
  const utils = api.useUtils()
  const enabled = !!entityDefinitionId
  const defId = entityDefinitionId ?? ''
  const queryInput = useMemo(() => ({ entityDefinitionId: defId }), [defId])

  const grantsQuery = api.resourceAccess.forType.useQuery(queryInput, {
    enabled,
    staleTime: 30_000,
  })

  const invalidate = useCallback(
    () => utils.resourceAccess.forType.invalidate(queryInput),
    [utils, queryInput]
  )

  /** Optimistically upsert (or, with `permission` undefined, drop) one row. */
  const patchLocal = useCallback(
    (granteeType: ResourceGranteeType, granteeId: string, permission?: ResourcePermission) => {
      utils.resourceAccess.forType.setData(queryInput, (prev) => {
        const rows = (prev ?? []).filter(
          (r) => !(r.granteeType === granteeType && r.granteeId === granteeId)
        )
        if (permission) {
          rows.unshift({
            id: `optimistic-${granteeType}-${granteeId}`,
            entityDefinitionId: queryInput.entityDefinitionId,
            entityInstanceId: null,
            granteeType,
            granteeId,
            permission,
            createdAt: new Date(),
          } as (typeof rows)[number])
        }
        return rows
      })
    },
    [utils, queryInput]
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
  const setType = api.resourceAccess.setType.useMutation({
    onError: (error) => {
      toastError({ title: 'Error resetting access', description: error.message })
      void invalidate()
    },
    onSettled: () => void invalidate(),
  })

  const rows = useMemo(() => grantsQuery.data ?? [], [grantsQuery.data])

  const baselineRow = useMemo(
    () =>
      rows.find(
        (r) =>
          r.granteeType === ResourceGranteeType.role && r.granteeId === MEMBER_BASELINE_GRANTEE_ID
      ),
    [rows]
  )

  /** The persisted baseline permission, or the default (Read and write) when absent. */
  const baselineLevel: ResourcePermission = baselineRow?.permission ?? DEFAULT_BASELINE_LEVEL
  const isConfigured = rows.length > 0

  const teamGrants = useMemo<DefAccessGrant[]>(
    () =>
      rows
        .filter((r) => r.granteeType === ResourceGranteeType.group)
        .map((r) => ({ granteeId: r.granteeId, permission: r.permission })),
    [rows]
  )
  const userGrants = useMemo<DefAccessGrant[]>(
    () =>
      rows
        .filter((r) => r.granteeType === ResourceGranteeType.user)
        .map((r) => ({ granteeId: r.granteeId, permission: r.permission })),
    [rows]
  )

  /** Persist the workspace baseline (persists `none` too — the lockdown marker). */
  const setBaseline = useCallback(
    (permission: ResourcePermission) => {
      patchLocal(ResourceGranteeType.role, MEMBER_BASELINE_GRANTEE_ID, permission)
      grantType.mutate({
        entityDefinitionId: queryInput.entityDefinitionId,
        granteeType: ResourceGranteeType.role,
        granteeId: MEMBER_BASELINE_GRANTEE_ID,
        permission,
      })
    },
    [grantType, patchLocal, queryInput.entityDefinitionId]
  )

  /**
   * Add a team/member grant. First-touch rule: if no baseline row exists yet,
   * also persist `role:org_member @ <default baseline>` so everyone keeps the
   * default access while the grantee is raised (additive, never exclusionary).
   */
  const addGrant = useCallback(
    (
      granteeType: ResourceGranteeType,
      granteeId: string,
      permission: ResourcePermission = DEFAULT_GRANTEE_LEVEL
    ) => {
      if (!baselineRow) {
        patchLocal(ResourceGranteeType.role, MEMBER_BASELINE_GRANTEE_ID, DEFAULT_BASELINE_LEVEL)
        grantType.mutate({
          entityDefinitionId: queryInput.entityDefinitionId,
          granteeType: ResourceGranteeType.role,
          granteeId: MEMBER_BASELINE_GRANTEE_ID,
          permission: DEFAULT_BASELINE_LEVEL,
        })
      }
      patchLocal(granteeType, granteeId, permission)
      grantType.mutate({
        entityDefinitionId: queryInput.entityDefinitionId,
        granteeType,
        granteeId,
        permission,
      })
    },
    [baselineRow, grantType, patchLocal, queryInput.entityDefinitionId]
  )

  /** Change an existing grantee's level. */
  const setGrant = useCallback(
    (granteeType: ResourceGranteeType, granteeId: string, permission: ResourcePermission) => {
      patchLocal(granteeType, granteeId, permission)
      grantType.mutate({
        entityDefinitionId: queryInput.entityDefinitionId,
        granteeType,
        granteeId,
        permission,
      })
    },
    [grantType, patchLocal, queryInput.entityDefinitionId]
  )

  /** Remove a team/member grant (the baseline row stays — everyone still views). */
  const removeGrant = useCallback(
    (granteeType: ResourceGranteeType, granteeId: string) => {
      patchLocal(granteeType, granteeId)
      revokeType.mutate({
        entityDefinitionId: queryInput.entityDefinitionId,
        granteeType,
        granteeId,
      })
    },
    [revokeType, patchLocal, queryInput.entityDefinitionId]
  )

  /** Clear every type row for the def → back to the dormant/unrestricted state. */
  const resetToDefault = useCallback(() => {
    utils.resourceAccess.forType.setData(queryInput, () => [])
    // Clear each grantee type independently (setType replaces one type at a time).
    for (const granteeType of [
      ResourceGranteeType.role,
      ResourceGranteeType.group,
      ResourceGranteeType.user,
    ]) {
      setType.mutate({ entityDefinitionId: queryInput.entityDefinitionId, granteeType, grants: [] })
    }
  }, [setType, utils, queryInput])

  /** A grant is "ignored" when it lifts nothing above the effective baseline. */
  const isIgnored = useCallback(
    (permission: ResourcePermission) =>
      PERMISSION_RANK[permission] <= PERMISSION_RANK[baselineLevel],
    [baselineLevel]
  )

  return {
    isLoading: grantsQuery.isLoading,
    baselineLevel,
    isConfigured,
    teamGrants,
    userGrants,
    isSaving: grantType.isPending || revokeType.isPending || setType.isPending,
    setBaseline,
    addGrant,
    setGrant,
    removeGrant,
    resetToDefault,
    isIgnored,
  }
}
