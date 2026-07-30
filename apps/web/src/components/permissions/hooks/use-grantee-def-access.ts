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
  permissionToRung,
} from '@auxx/lib/permissions/client'
import { isAccessManageable, type Resource } from '@auxx/lib/resources/client'
import { toastError } from '@auxx/ui/components/toast'
import { useCallback, useMemo } from 'react'
import { useResources } from '~/components/resources/hooks'
import { api } from '~/trpc/react'
import type { DefAccessRow } from '../ui/grantee-def-access-rows'
import {
  useGranteeAccess,
  useInvalidateGranteeAccess,
  usePatchGranteeAccess,
} from './use-grantee-access'
import { MEMBER_BASELINE_GRANTEE_ID, useRoleDefaults } from './use-permission-grants'
import { type AccessChoice, type StagedSurface, useStagedEdits } from './use-staged-edits'

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

/**
 * One def's row in the grantee-centric Access grid: the shared
 * {@link DefAccessRow} the renderer consumes, plus the two fields only this side
 * has.
 *
 * `resource` stays because the HOSTS filter on it — a search matches a def's
 * plural *or* its singular label, which the flattened `title` alone cannot
 * answer. `baselineLevel` is what `isLockedDown`/`isNoEffect` are derived from
 * and is asserted directly by this hook's tests.
 */
export interface GranteeDefAccessRow extends DefAccessRow {
  resource: Resource
  /** The def's `role:org_member` baseline, or its base-area default when unconfigured. */
  baselineLevel: ResourcePermission
  /** Baseline = No Access → non-grantees are locked out ("Restricted"). */
  isLockedDown: boolean
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
 * no-op (≤ baseline).
 *
 * **Edits are STAGED, not written** ({@link useStagedEdits}): `setLevel` moves the
 * select, `save()` flushes through `grantType`/`revokeType`. Every host of this
 * hook renders a `FormSaveBar`, so the nested per-def rows now commit with the
 * area levels above them instead of firing a mutation per click.
 *
 * **First-touch rule (correctness, not polish):** setting an explicit grant on a
 * def with no baseline row yet ALSO writes `role:org_member @ edit`, so the def
 * doesn't silently become restricted and lock every other member out. It is
 * evaluated at FLUSH time, against the baseline as it stands then — staging it
 * would have to guess. Selecting Inherit (revoke) never touches the baseline.
 * Errors surface via `toastError`.
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
): {
  isLoading: boolean
  rows: GranteeDefAccessRow[]
  setLevel: (entityDefinitionId: string, level: AccessChoice) => void
} & StagedSurface {
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
  const invalidate = useCallback(
    () => Promise.all([invalidateGranteeAccess(), utils.resourceAccess.invalidate()]),
    [utils, invalidateGranteeAccess]
  )

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

  const {
    edits: staged,
    entries: stagedEntries,
    stage,
    discard,
    replace,
    isDirty,
  } = useStagedEdits<AccessChoice>()

  const rows = useMemo<GranteeDefAccessRow[]>(() => {
    return resources
      .filter(isAccessManageable)
      .map((resource) => {
        const configuredBaseline = baselineByDef[resource.entityDefinitionId]
        const baseArea = ENTITY_BASE_AREAS[resource.entityType ?? ''] ?? Area.records
        const baselineLevel = configuredBaseline ?? workspaceBasePermission(baseArea)
        // Staged edits win over the persisted grant, so the select moves the
        // instant it is clicked even though nothing has been written yet — and
        // `isNoEffect` below judges what the admin is about to save.
        const choice = staged[resource.entityDefinitionId]
        const grantLevel =
          choice === undefined
            ? grantByDef[resource.entityDefinitionId]
            : choice === 'inherit'
              ? undefined
              : choice
        // Configured def → inherit its workspace baseline; unconfigured → the
        // grantee's general Records level.
        const inheritedLevel = configuredBaseline ?? targetBasePermission(baseArea)
        return {
          id: resource.entityDefinitionId,
          icon: { iconId: resource.icon, color: resource.color },
          title: resource.plural,
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
  }, [resources, baselineByDef, grantByDef, targetBasePermission, workspaceBasePermission, staged])

  /**
   * Stage this grantee's level for a def. `'inherit'` will revoke the explicit
   * row; a positive level will write it. Nothing is sent until {@link save}.
   */
  const setLevel = useCallback(
    (entityDefinitionId: string, level: AccessChoice) => {
      stage(entityDefinitionId, level, grantByDef[entityDefinitionId] ?? 'inherit')
    },
    [stage, grantByDef]
  )

  /**
   * Flush every staged def, one write at a time — including the first-touch
   * baseline write, which is decided here rather than at stage time so it reads
   * the baseline as it actually stands when the row is committed.
   *
   * A def whose write fails STAYS staged (its `toastError` already fired) so Save
   * retries only what is left; the awaited `invalidate` keeps the select from
   * flashing back before the refetch lands.
   */
  const save = useCallback(async () => {
    const failed: Record<string, AccessChoice> = {}
    for (const [entityDefinitionId, level] of stagedEntries) {
      try {
        if (level === 'inherit') {
          patchLocal(entityDefinitionId, 'own')
          await revokeType.mutateAsync({ entityDefinitionId, granteeType, granteeId })
          continue
        }
        // First-touch: keep everyone at the default while this grantee is raised.
        if (baselineByDef[entityDefinitionId] === undefined) {
          const resource = resources.find((item) => item.entityDefinitionId === entityDefinitionId)
          const baseArea = ENTITY_BASE_AREAS[resource?.entityType ?? ''] ?? Area.records
          const defaultBaseline = workspaceBasePermission(baseArea)
          patchLocal(entityDefinitionId, 'baseline', defaultBaseline)
          await grantType.mutateAsync({
            entityDefinitionId,
            granteeType: ResourceGranteeType.role,
            granteeId: MEMBER_BASELINE_GRANTEE_ID,
            rung: permissionToRung(defaultBaseline),
          })
        }
        patchLocal(entityDefinitionId, 'own', level)
        await grantType.mutateAsync({
          entityDefinitionId,
          granteeType,
          granteeId,
          rung: permissionToRung(level),
        })
      } catch {
        failed[entityDefinitionId] = level
      }
    }
    await invalidate()
    replace(failed)
    return Object.keys(failed).length === 0
  }, [
    stagedEntries,
    baselineByDef,
    resources,
    workspaceBasePermission,
    granteeType,
    granteeId,
    grantType,
    revokeType,
    patchLocal,
    invalidate,
    replace,
  ])

  return {
    isLoading: resourcesLoading || granteeLoading || roleDefaultsLoading,
    rows,
    setLevel,
    isDirty,
    isSaving: grantType.isPending || revokeType.isPending,
    save,
    discard,
  }
}
