// apps/web/src/components/permissions/hooks/use-grantee-def-access.ts
'use client'

import { ResourceGranteeType, ResourcePermission } from '@auxx/database/enums'
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
import {
  useGranteeAccess,
  useInvalidateGranteeAccess,
  usePatchGranteeAccess,
} from './use-grantee-access'
import { MEMBER_BASELINE_GRANTEE_ID, useRoleDefaults } from './use-permission-grants'

/**
 * The grantee axis this section edits: an individual member, a team, or (doc 19
 * §9 step 9 lifted the write guard) a **profile itself** — the profile editor's
 * own Records-area nesting (capability layer v2 Part B extension, plan 24).
 *
 * A `'profile'` grantee is NOT a member/team override: it has no separate
 * workspace-baseline-relative composition, because a profile's def override
 * doesn't raise above anything external — it's authored directly on the
 * profile being edited. Its "own area levels" therefore come from the caller's
 * live (possibly unsaved) draft, passed in as `profileOwnLevels`, never from
 * `usePermissionGrants()`'s persisted `groupGrants`/`userGrants`.
 */
export type GranteeKind = 'user' | 'group' | 'profile'

/**
 * Typed against the full `ResourceGranteeType` (not the narrower
 * `SharingGranteeType`, which excludes `profile` by construction) so a
 * `'profile'` kind resolves to a real, authorable grantee address. Total over
 * {@link GranteeKind} by construction — there is no fall-through branch that
 * could turn an unmodelled kind into a `user` write.
 */
const GRANTEE_TYPE: Record<GranteeKind, ResourceGranteeType> = {
  user: ResourceGranteeType.user,
  group: ResourceGranteeType.group,
  profile: ResourceGranteeType.profile,
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
 * member, a team, or a profile — see {@link GranteeKind}) it lists every in-scope
 * CRM def with that grantee's effective level and lets an admin set it, editing
 * the same type-level `ResourceAccess` rows the per-def Permissions tab writes.
 *
 * Reads ONE grantee, not the org (plan 31 §2.4): `permissions.granteeAccess`
 * supplies this grantee's own type rows, the org's `role:org_member` workspace
 * defaults and the Member profile's area levels; `useResources` supplies the def
 * list. It used to pull `resourceAccess.allTypeAccess` — every type row for
 * every grantee — and narrow client-side. That was properly gated, so this is a
 * SHAPE fix, not an authorization one; `allTypeAccess` survives for the
 * Workspace defaults tab, which is org-wide by definition.
 *
 * Derives per def: the baseline (`role:org_member` row), the locked-down flag
 * (baseline = No Access), this grantee's grant, and whether that grant is a
 * no-op (≤ baseline). Writes reuse `grantType`/`revokeType`.
 *
 * **First-touch rule (correctness, not polish):** setting an explicit grant on a
 * def with no baseline row yet ALSO writes `role:org_member @ edit`, so the def
 * doesn't silently become restricted and lock every other member out. Selecting
 * Inherit (revoke) never touches the baseline. Errors surface via `toastError`.
 */
export function useGranteeDefAccess(
  granteeKind: GranteeKind,
  granteeId: string,
  /**
   * Required (and only meaningful) for `granteeKind: 'profile'` — the
   * profile's own live draft: its per-area base `levels` and blanket
   * `baseLevel`, exactly as the profile editor's own grid renders them. A
   * profile grantee has no external baseline to raise above, so its "Inherit"
   * fall-through is this draft, not `usePermissionGrants()`'s persisted maps.
   */
  profileOwnLevels?: { levels: Partial<Record<Area, Level>>; baseLevel: Level | null }
) {
  const utils = api.useUtils()
  const { resources, isLoading: resourcesLoading } = useResources()
  const granteeType = GRANTEE_TYPE[granteeKind]

  // The grantee's Layer-2 levels — what unconfigured (non-restricted) defs
  // inherit from their mapped base area. Own override → member baseline → role default.
  const { roleDefaults, isLoading: roleDefaultsLoading } = useRoleDefaults()
  const { isLoading: granteeLoading, own, baseline } = useGranteeAccess(granteeKind, granteeId)
  const ownAreaLevels = useMemo(
    () => (granteeKind === 'profile' ? (profileOwnLevels?.levels ?? {}) : (own?.areas ?? {})),
    [granteeKind, own, profileOwnLevels]
  )
  /** The org-wide member baseline per area — role default merged with org policy. */
  const effectiveBaseline = useMemo<Partial<Record<Area, Level>>>(
    () => ({ ...(roleDefaults ?? {}), ...(baseline?.areas ?? {}) }),
    [roleDefaults, baseline]
  )

  const targetBasePermission = useCallback(
    (area: Area): ResourcePermission => {
      const level =
        granteeKind === 'profile'
          ? (ownAreaLevels[area] ??
            profileOwnLevels?.baseLevel ??
            roleDefaults?.[area] ??
            Level.None)
          : (ownAreaLevels[area] ?? effectiveBaseline[area] ?? roleDefaults?.[area] ?? Level.None)
      return levelToRecordBasePermission(level) ?? ResourcePermission.none
    },
    [granteeKind, ownAreaLevels, profileOwnLevels, effectiveBaseline, roleDefaults]
  )

  const workspaceBasePermission = useCallback(
    (area: Area): ResourcePermission => {
      const level = effectiveBaseline[area] ?? roleDefaults?.[area] ?? Level.None
      return levelToRecordBasePermission(level) ?? ResourcePermission.none
    },
    [effectiveBaseline, roleDefaults]
  )

  // Broad on purpose: the per-def Permissions tab reads the same rows under
  // `resourceAccess.forType`, and the Workspace defaults tab under
  // `resourceAccess.allTypeAccess`, so a write here must refresh those keys too.
  // `granteeAccess` rides along because a def write moves its COMPOSED
  // `effective` half, which no optimistic patch here can predict.
  const invalidateGranteeAccess = useInvalidateGranteeAccess()
  const invalidate = useCallback(() => {
    invalidateGranteeAccess()
    return utils.resourceAccess.invalidate()
  }, [utils, invalidateGranteeAccess])

  const patchGranteeAccess = usePatchGranteeAccess()

  /**
   * Optimistically upsert (or, with `permission` undefined, drop) one type row
   * in this grantee's cached payload — what makes a def write feel instant.
   *
   * Patches `own.defs` or `baseline.defs` depending on which row is being
   * written; both are stored verbatim by the server, so the client predicts them
   * exactly. `effective.defs` is left alone and refetched — see
   * {@link usePatchGranteeAccess}.
   */
  const patchLocal = useCallback(
    (entityDefinitionId: string, target: 'own' | 'baseline', permission?: ResourcePermission) => {
      patchGranteeAccess(granteeKind, granteeId, (prev) => {
        const defs = { ...prev[target].defs }
        if (permission) defs[entityDefinitionId] = permission
        else delete defs[entityDefinitionId]
        return { ...prev, [target]: { ...prev[target], defs } }
      })
    },
    [patchGranteeAccess, granteeKind, granteeId]
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

  /** Per-def baseline permission (`role:org_member` row), keyed by def id. */
  const baselineByDef = useMemo(() => baseline?.defs ?? {}, [baseline])

  /** This grantee's explicit grant per def, keyed by def id. */
  const grantByDef = useMemo(() => own?.defs ?? {}, [own])

  const rows = useMemo<GranteeDefAccessRow[]>(() => {
    return resources
      .filter(isAccessManageable)
      .map((resource) => {
        const configuredBaseline = baselineByDef[resource.entityDefinitionId]
        const baseArea = ENTITY_BASE_AREAS[resource.entityType ?? ''] ?? Area.records
        const baselineLevel = configuredBaseline ?? workspaceBasePermission(baseArea)
        const grantLevel = grantByDef[resource.entityDefinitionId]
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
              : `Inherit · ${PERMISSION_AREAS[baseArea].label}`,
          isNoEffect:
            grantLevel !== undefined &&
            PERMISSION_RANK[grantLevel] <= PERMISSION_RANK[baselineLevel],
        }
      })
      .sort((a, b) => a.resource.plural.localeCompare(b.resource.plural))
  }, [resources, baselineByDef, grantByDef, targetBasePermission, workspaceBasePermission])

  /**
   * Set this grantee's level for a def. `'inherit'` revokes the explicit row;
   * a positive level writes it (auto-persisting the baseline on first touch).
   */
  const setLevel = useCallback(
    (entityDefinitionId: string, level: ResourcePermission | 'inherit') => {
      if (level === 'inherit') {
        patchLocal(entityDefinitionId, 'own')
        revokeType.mutate({ entityDefinitionId, granteeType, granteeId })
        return
      }
      // First-touch: keep everyone at the default while this grantee is raised.
      if (baselineByDef[entityDefinitionId] === undefined) {
        const resource = resources.find((item) => item.entityDefinitionId === entityDefinitionId)
        const baseArea = ENTITY_BASE_AREAS[resource?.entityType ?? ''] ?? Area.records
        const defaultBaseline = workspaceBasePermission(baseArea)
        patchLocal(entityDefinitionId, 'baseline', defaultBaseline)
        grantType.mutate({
          entityDefinitionId,
          granteeType: ResourceGranteeType.role,
          granteeId: MEMBER_BASELINE_GRANTEE_ID,
          permission: defaultBaseline,
        })
      }
      patchLocal(entityDefinitionId, 'own', level)
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
    isLoading: resourcesLoading || granteeLoading || roleDefaultsLoading,
    rows,
    setLevel,
  }
}
