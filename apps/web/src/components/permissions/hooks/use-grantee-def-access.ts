// apps/web/src/components/permissions/hooks/use-grantee-def-access.ts
'use client'

import {
  ResourceGranteeType,
  ResourcePermission,
  type SharingGranteeType,
} from '@auxx/database/enums'
import {
  Area,
  ENTITY_BASE_AREAS,
  Level,
  levelToRecordBasePermission,
  PERMISSION_AREAS,
  PERMISSION_RANK,
} from '@auxx/lib/permissions/client'
import { isAccessManageable, type Resource } from '@auxx/lib/resources/client'
import { toastError } from '@auxx/ui/components/toast'
import { useCallback, useMemo } from 'react'
import { useResources } from '~/components/resources/hooks'
import { api } from '~/trpc/react'
import { MEMBER_BASELINE_GRANTEE_ID, usePermissionGrants } from './use-permission-grants'

/**
 * The grantee axis this section edits: an individual member or a team.
 *
 * A `'profile'` kind is deliberately absent. It is not a missing tab — the
 * grantee-centric def grid writes `ResourceAccess` rows through
 * `resourceAccess.grantType`/`revokeType`, and profile-grantee `ResourceAccess`
 * writes are refused at the service layer (`assertProfileGranteeSupported`) until
 * every resolver reads them. Adding it here would ship a picker whose every
 * selection 400s. Per-def profile access is therefore explicitly **unsupported**
 * on this surface; it belongs to the profile-side def grid in doc 19 §7.
 */
export type GranteeKind = 'user' | 'group'

/**
 * How the grantee's Layer-2 area levels compose — which decides what an
 * unconfigured def falls through to:
 * - `member` (default) — human/team: own override → org policy → role default.
 * - `agent` — an AGENT grantee (`userType:'AGENT'`), which composes by SET over
 *   an all-Full base (capability layer v2 §0.2/§0.3): no org policy, no group
 *   tier, so an unset Records area is **Full**, not the member baseline.
 */
export type GranteePrincipal = 'member' | 'agent'

/**
 * Typed against `SharingGranteeType`, not `ResourceGranteeType`: the wider union
 * carries `'profile'`, whose ResourceAccess writes are still refused server-side.
 * Total over {@link GranteeKind} by construction — there is no fall-through
 * branch that could turn an unmodelled kind into a `user` write.
 */
const GRANTEE_TYPE: Record<GranteeKind, SharingGranteeType> = {
  user: ResourceGranteeType.user,
  group: ResourceGranteeType.group,
}

/** One def's row in the grantee-centric Access grid. */
export interface GranteeDefAccessRow {
  resource: Resource
  /** The def's `role:org_member` baseline, or its base-area default when unconfigured. */
  baselineLevel: ResourcePermission
  /** Baseline = No Access → non-grantees are locked out ("Restricted"). */
  isLockedDown: boolean
  /** This grantee's explicit grant, or `undefined` (= Inherit / follows the inherited level). */
  grantLevel: ResourcePermission | undefined
  /**
   * What the grantee gets WITHOUT an explicit grant here — the resolved "Inherit"
   * value: the def's workspace baseline if configured, else the grantee's general
   * mapped Layer-2 base area. Displayed in the picker's Inherit option.
   */
  inheritedLevel: ResourcePermission
  /** Source-aware label when an unconfigured def inherits another L2 area. */
  inheritLabelText?: string
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
export function useGranteeDefAccess(
  granteeKind: GranteeKind,
  granteeId: string,
  principal: GranteePrincipal = 'member'
) {
  const utils = api.useUtils()
  const { resources, isLoading: resourcesLoading } = useResources()
  const granteeType = GRANTEE_TYPE[granteeKind]

  // The grantee's Layer-2 levels — what unconfigured (non-restricted) defs
  // inherit from their mapped base area. Own override → member baseline → role default.
  const {
    isLoading: grantsLoading,
    roleDefaults,
    effectiveBaseline,
    groupGrants,
    userGrants,
  } = usePermissionGrants()
  const ownAreaLevels = useMemo(() => {
    const persisted = granteeKind === 'group' ? groupGrants : userGrants
    return persisted.find((g) => g.granteeId === granteeId)?.levels ?? {}
  }, [granteeKind, granteeId, groupGrants, userGrants])

  const targetBasePermission = useCallback(
    (area: Area): ResourcePermission => {
      const level =
        principal === 'agent'
          ? (ownAreaLevels[area] ?? Level.Full)
          : (ownAreaLevels[area] ?? effectiveBaseline[area] ?? roleDefaults?.[area] ?? Level.None)
      return levelToRecordBasePermission(level) ?? ResourcePermission.none
    },
    [principal, ownAreaLevels, effectiveBaseline, roleDefaults]
  )

  const workspaceBasePermission = useCallback(
    (area: Area): ResourcePermission => {
      const level = effectiveBaseline[area] ?? roleDefaults?.[area] ?? Level.None
      return levelToRecordBasePermission(level) ?? ResourcePermission.none
    },
    [effectiveBaseline, roleDefaults]
  )

  const rowsQuery = api.resourceAccess.allTypeAccess.useQuery(undefined, { staleTime: 30_000 })

  // Broad on purpose: the per-def Permissions tab reads the same rows under
  // `resourceAccess.forType`, so a write here must refresh that key too.
  const invalidate = useCallback(() => utils.resourceAccess.invalidate(), [utils])

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
        const baseArea = ENTITY_BASE_AREAS[resource.entityType ?? ''] ?? Area.records
        const baselineLevel = configuredBaseline ?? workspaceBasePermission(baseArea)
        const grantLevel = grantByDef.get(resource.entityDefinitionId)
        // Configured def → inherit its workspace baseline; unconfigured → the
        // grantee's general Records level.
        const inheritedLevel = configuredBaseline ?? targetBasePermission(baseArea)
        return {
          resource,
          baselineLevel,
          isLockedDown: baselineLevel === ResourcePermission.none,
          grantLevel,
          inheritedLevel,
          inheritLabelText:
            configuredBaseline !== undefined || baseArea === Area.records
              ? undefined
              : `${principal === 'agent' ? 'Default' : 'Inherit'} · ${
                  PERMISSION_AREAS[baseArea].label
                }`,
          isNoEffect:
            grantLevel !== undefined &&
            PERMISSION_RANK[grantLevel] <= PERMISSION_RANK[baselineLevel],
        }
      })
      .sort((a, b) => a.resource.plural.localeCompare(b.resource.plural))
  }, [
    resources,
    baselineByDef,
    grantByDef,
    principal,
    targetBasePermission,
    workspaceBasePermission,
  ])

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
        const resource = resources.find((item) => item.entityDefinitionId === entityDefinitionId)
        const baseArea = ENTITY_BASE_AREAS[resource?.entityType ?? ''] ?? Area.records
        const defaultBaseline = workspaceBasePermission(baseArea)
        patchLocal(
          entityDefinitionId,
          ResourceGranteeType.role,
          MEMBER_BASELINE_GRANTEE_ID,
          defaultBaseline
        )
        grantType.mutate({
          entityDefinitionId,
          granteeType: ResourceGranteeType.role,
          granteeId: MEMBER_BASELINE_GRANTEE_ID,
          permission: defaultBaseline,
        })
      }
      patchLocal(entityDefinitionId, granteeType, granteeId, level)
      grantType.mutate({ entityDefinitionId, granteeType, granteeId, permission: level })
    },
    [
      baselineByDef,
      resources,
      workspaceBasePermission,
      granteeType,
      granteeId,
      grantType,
      revokeType,
      patchLocal,
    ]
  )

  return {
    isLoading: resourcesLoading || rowsQuery.isLoading || grantsLoading,
    rows,
    setLevel,
  }
}
