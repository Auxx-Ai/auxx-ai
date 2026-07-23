// apps/web/src/components/permissions/hooks/use-grantee-def-access.ts
'use client'

import { ResourceGranteeType, ResourcePermission } from '@auxx/database/enums'
import { Area, Level } from '@auxx/lib/permissions/client'
import { isAccessManageable, type Resource } from '@auxx/lib/resources/client'
import { toastError } from '@auxx/ui/components/toast'
import { useCallback, useMemo } from 'react'
import { useResources } from '~/components/resources/hooks'
import { api } from '~/trpc/react'
import { MEMBER_BASELINE_GRANTEE_ID, usePermissionGrants } from './use-permission-grants'

/** The grantee axis this section edits: an individual member or a team. */
export type GranteeKind = 'user' | 'group'

const GRANTEE_TYPE: Record<GranteeKind, ResourceGranteeType> = {
  user: ResourceGranteeType.user,
  group: ResourceGranteeType.group,
}

/** Client-safe rank (`none` < view < edit < admin) for the "no effect" compare. */
const PERMISSION_RANK: Record<ResourcePermission, number> = {
  [ResourcePermission.none]: 0,
  [ResourcePermission.view]: 1,
  [ResourcePermission.edit]: 2,
  [ResourcePermission.admin]: 3,
}

/**
 * The workspace baseline an unconfigured def defaults to (and first-touch
 * persists) — everyone's default access. Must match `use-def-access`'s
 * `DEFAULT_BASELINE_LEVEL` so the two surfaces agree.
 */
const DEFAULT_BASELINE_LEVEL: ResourcePermission = ResourcePermission.edit

/** Layer-2 records rung → its record-permission equivalent (for the inherited label). */
const LEVEL_TO_PERMISSION: Record<Level, ResourcePermission> = {
  [Level.None]: ResourcePermission.none,
  [Level.Read]: ResourcePermission.view,
  [Level.Edit]: ResourcePermission.edit,
  [Level.Full]: ResourcePermission.admin,
}

/** One def's row in the grantee-centric Access grid. */
export interface GranteeDefAccessRow {
  resource: Resource
  /** The def's `role:org_member` baseline, or the default when unconfigured. */
  baselineLevel: ResourcePermission
  /** Baseline = No Access → non-grantees are locked out ("Restricted"). */
  isLockedDown: boolean
  /** This grantee's explicit grant, or `undefined` (= Inherit / follows the inherited level). */
  grantLevel: ResourcePermission | undefined
  /**
   * What the grantee gets WITHOUT an explicit grant here — the resolved "Inherit"
   * value: the def's workspace baseline if configured, else the grantee's general
   * Records level. Displayed in the picker's Inherit option.
   */
  inheritedLevel: ResourcePermission
  /** Explicit grant that lifts nothing above the baseline → does nothing. */
  isNoEffect: boolean
}

/**
 * Grantee-centric view of entity-def access (capability layer v2
 * grantee-def-access): the transpose of {@link useDefAccess}. For one grantee (a
 * member or a team) it lists every in-scope CRM def with that grantee's effective
 * level and lets an admin set it, editing the same type-level `ResourceAccess`
 * rows the per-def Permissions tab writes.
 *
 * Reads once from `resourceAccess.allTypeAccess` (all type rows, org-wide) and
 * `useResources`, then derives per def: the baseline (`role:org_member` row), the
 * locked-down flag (baseline = No Access), this grantee's grant, and whether that
 * grant is a no-op (≤ baseline). Writes reuse `grantType`/`revokeType`.
 *
 * **First-touch rule (correctness, not polish):** setting an explicit grant on a
 * def with no baseline row yet ALSO writes `role:org_member @ edit`, so the def
 * doesn't silently become restricted and lock every other member out. Selecting
 * Inherit (revoke) never touches the baseline. Errors surface via `toastError`.
 */
export function useGranteeDefAccess(granteeKind: GranteeKind, granteeId: string) {
  const utils = api.useUtils()
  const { resources, isLoading: resourcesLoading } = useResources()
  const granteeType = GRANTEE_TYPE[granteeKind]

  // The grantee's Layer-2 Records level — what unconfigured (non-restricted) defs
  // inherit. Own override → effective member baseline → role default.
  const {
    isLoading: grantsLoading,
    roleDefaults,
    effectiveBaseline,
    groupGrants,
    userGrants,
  } = usePermissionGrants()
  const recordsPermission = useMemo<ResourcePermission>(() => {
    const persisted = granteeKind === 'group' ? groupGrants : userGrants
    const own = persisted.find((g) => g.granteeId === granteeId)?.levels?.[Area.records]
    const level =
      own ?? effectiveBaseline[Area.records] ?? roleDefaults?.[Area.records] ?? Level.None
    return LEVEL_TO_PERMISSION[level]
  }, [granteeKind, granteeId, groupGrants, userGrants, effectiveBaseline, roleDefaults])

  const rowsQuery = api.resourceAccess.allTypeAccess.useQuery(undefined, { staleTime: 30_000 })

  const invalidate = useCallback(() => utils.resourceAccess.allTypeAccess.invalidate(), [utils])

  /** Optimistically upsert (or, with `permission` undefined, drop) one type row. */
  const patchLocal = useCallback(
    (
      entityDefinitionId: string,
      rowGranteeType: ResourceGranteeType,
      rowGranteeId: string,
      permission?: ResourcePermission
    ) => {
      utils.resourceAccess.allTypeAccess.setData(undefined, (prev) => {
        const rows = (prev ?? []).filter(
          (r) =>
            !(
              r.entityDefinitionId === entityDefinitionId &&
              r.granteeType === rowGranteeType &&
              r.granteeId === rowGranteeId
            )
        )
        if (permission) {
          rows.unshift({
            id: `optimistic-${entityDefinitionId}-${rowGranteeType}-${rowGranteeId}`,
            entityDefinitionId,
            entityInstanceId: null,
            granteeType: rowGranteeType,
            granteeId: rowGranteeId,
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

  /** This grantee's explicit grant per def, keyed by def id. */
  const grantByDef = useMemo(() => {
    const map = new Map<string, ResourcePermission>()
    for (const r of allRows) {
      if (r.granteeType === granteeType && r.granteeId === granteeId) {
        map.set(r.entityDefinitionId, r.permission)
      }
    }
    return map
  }, [allRows, granteeType, granteeId])

  const rows = useMemo<GranteeDefAccessRow[]>(() => {
    return resources
      .filter(isAccessManageable)
      .map((resource) => {
        const configuredBaseline = baselineByDef.get(resource.entityDefinitionId)
        const baselineLevel = configuredBaseline ?? DEFAULT_BASELINE_LEVEL
        const grantLevel = grantByDef.get(resource.entityDefinitionId)
        // Configured def → inherit its workspace baseline; unconfigured → the
        // grantee's general Records level.
        const inheritedLevel = configuredBaseline ?? recordsPermission
        return {
          resource,
          baselineLevel,
          isLockedDown: baselineLevel === ResourcePermission.none,
          grantLevel,
          inheritedLevel,
          isNoEffect:
            grantLevel !== undefined &&
            PERMISSION_RANK[grantLevel] <= PERMISSION_RANK[baselineLevel],
        }
      })
      .sort((a, b) => a.resource.plural.localeCompare(b.resource.plural))
  }, [resources, baselineByDef, grantByDef, recordsPermission])

  /**
   * Set this grantee's level for a def. `'inherit'` revokes the explicit row;
   * a positive level writes it (auto-persisting the baseline on first touch).
   */
  const setLevel = useCallback(
    (entityDefinitionId: string, level: ResourcePermission | 'inherit') => {
      if (level === 'inherit') {
        patchLocal(entityDefinitionId, granteeType, granteeId)
        revokeType.mutate({ entityDefinitionId, granteeType, granteeId })
        return
      }
      // First-touch: keep everyone at the default while this grantee is raised.
      if (!baselineByDef.has(entityDefinitionId)) {
        patchLocal(
          entityDefinitionId,
          ResourceGranteeType.role,
          MEMBER_BASELINE_GRANTEE_ID,
          DEFAULT_BASELINE_LEVEL
        )
        grantType.mutate({
          entityDefinitionId,
          granteeType: ResourceGranteeType.role,
          granteeId: MEMBER_BASELINE_GRANTEE_ID,
          permission: DEFAULT_BASELINE_LEVEL,
        })
      }
      patchLocal(entityDefinitionId, granteeType, granteeId, level)
      grantType.mutate({ entityDefinitionId, granteeType, granteeId, permission: level })
    },
    [baselineByDef, granteeType, granteeId, grantType, revokeType, patchLocal]
  )

  return {
    isLoading: resourcesLoading || rowsQuery.isLoading || grantsLoading,
    rows,
    setLevel,
  }
}
