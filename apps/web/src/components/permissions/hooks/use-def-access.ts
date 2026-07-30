// apps/web/src/components/permissions/hooks/use-def-access.ts
'use client'

import {
  ResourceGranteeType,
  ResourcePermission,
  type SharingGranteeType,
  SharingGranteeTypeValues,
} from '@auxx/database/enums'
import { PERMISSION_RANK, permissionToRung, rungToPermission } from '@auxx/lib/permissions/client'
import { toastError } from '@auxx/ui/components/toast'
import { useCallback, useMemo } from 'react'
import { granteeKindLabel, type UnmanageableGrant } from '~/components/permissions/utils/grantee'
import { api } from '~/trpc/react'
import { MEMBER_BASELINE_GRANTEE_ID } from './use-permission-grants'

/** A resolved team/member grant (grantees never carry `none`). */
export interface DefAccessGrant {
  granteeId: string
  permission: ResourcePermission
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
 * Writes are optimistic; the query invalidates on settle to reconcile, and the
 * write also fires `publishCapabilitiesChanged` (phase 4 §10) so OTHER members'
 * open sessions get nudged to re-fetch. Note the client `CapabilitiesProvider`
 * currently consumes only `caps.keys` (not `defAccess`), so that live nudge only
 * takes visible effect once a client surface reads def-access live (§8 nav
 * catalog, §11.1 per-def write affordances). Errors surface via `toastError`.
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

  // Broad on purpose: the permissions page reads the same rows in bulk under
  // `resourceAccess.allTypeAccess`, so a write here must refresh that key too.
  const invalidate = useCallback(() => utils.resourceAccess.invalidate(), [utils])

  /** Optimistically upsert (or, with `permission` undefined, drop) one row. */
  const patchLocal = useCallback(
    (granteeType: SharingGranteeType, granteeId: string, permission?: ResourcePermission) => {
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
            // The ROW is rung-valued; this grid's vocabulary is the DEF axis, so
            // the optimistic row crosses back through `permissionToRung` (plan
            // v3/03 §3 — one boundary, both directions).
            rung: permissionToRung(permission),
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
  const baselineLevel: ResourcePermission =
    (baselineRow ? rungToPermission(baselineRow.rung) : undefined) ?? DEFAULT_BASELINE_LEVEL
  const isConfigured = rows.length > 0

  const teamGrants = useMemo<DefAccessGrant[]>(
    () =>
      rows
        .filter((r) => r.granteeType === ResourceGranteeType.group)
        .map((r) => ({
          granteeId: r.granteeId,
          permission: rungToPermission(r.rung) ?? ResourcePermission.none,
        })),
    [rows]
  )
  // NOTE: `user` rows carry BOTH humans and agents — an agent grant is a `user`
  // row keyed on the agent's backing `User.id` (agent plan §4.1), so consumers
  // that render an Agents section must partition this list against the org's
  // agent user ids (see `def-access-section.tsx`).
  const userGrants = useMemo<DefAccessGrant[]>(
    () =>
      rows
        .filter((r) => r.granteeType === ResourceGranteeType.user)
        .map((r) => ({
          granteeId: r.granteeId,
          permission: rungToPermission(r.rung) ?? ResourcePermission.none,
        })),
    [rows]
  )

  /**
   * Rows this tab renders in none of its three blocks — a `profile` grant today
   * (plan 19 §8.2). They are the difference between "no one else has access" and
   * "someone else has access you can't see", and via 19a finding 1 a single one
   * of them keeps the def restricted org-wide, so they are disclosed rather than
   * dropped.
   */
  const unmanageableGrants = useMemo<UnmanageableGrant[]>(
    () =>
      rows
        .filter(
          (r) =>
            r.granteeType !== ResourceGranteeType.role &&
            r.granteeType !== ResourceGranteeType.group &&
            r.granteeType !== ResourceGranteeType.user
        )
        .map((r) => ({ granteeType: r.granteeType, granteeId: r.granteeId })),
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
        rung: permissionToRung(permission),
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
      granteeType: SharingGranteeType,
      granteeId: string,
      permission: ResourcePermission = DEFAULT_GRANTEE_LEVEL
    ) => {
      if (!baselineRow) {
        patchLocal(ResourceGranteeType.role, MEMBER_BASELINE_GRANTEE_ID, DEFAULT_BASELINE_LEVEL)
        grantType.mutate({
          entityDefinitionId: queryInput.entityDefinitionId,
          granteeType: ResourceGranteeType.role,
          granteeId: MEMBER_BASELINE_GRANTEE_ID,
          rung: permissionToRung(DEFAULT_BASELINE_LEVEL),
        })
      }
      patchLocal(granteeType, granteeId, permission)
      grantType.mutate({
        entityDefinitionId: queryInput.entityDefinitionId,
        granteeType,
        granteeId,
        rung: permissionToRung(permission),
      })
    },
    [baselineRow, grantType, patchLocal, queryInput.entityDefinitionId]
  )

  /** Change an existing grantee's level. */
  const setGrant = useCallback(
    (granteeType: SharingGranteeType, granteeId: string, permission: ResourcePermission) => {
      patchLocal(granteeType, granteeId, permission)
      grantType.mutate({
        entityDefinitionId: queryInput.entityDefinitionId,
        granteeType,
        granteeId,
        rung: permissionToRung(permission),
      })
    },
    [grantType, patchLocal, queryInput.entityDefinitionId]
  )

  /** Remove a team/member grant (the baseline row stays — everyone still views). */
  const removeGrant = useCallback(
    (granteeType: SharingGranteeType, granteeId: string) => {
      patchLocal(granteeType, granteeId)
      revokeType.mutate({
        entityDefinitionId: queryInput.entityDefinitionId,
        granteeType,
        granteeId,
      })
    },
    [revokeType, patchLocal, queryInput.entityDefinitionId]
  )

  /**
   * Clear every type row for the def → back to the dormant/unrestricted state.
   *
   * `setType` replaces ONE grantee type per call, so the types to clear are
   * derived from the rows that actually exist rather than from a fixed
   * `[role, group, user]` list. That list was the bug: a `profile` row survived
   * the reset, and because `restricted-entity-def-ids-provider.ts` builds the
   * restricted set **grantee-agnostically** (19a finding 1), the def stayed
   * restricted — invisible to every non-admin — while this button reported it
   * reset. Any surviving kind now reports itself instead of vanishing.
   */
  const resetToDefault = useCallback(() => {
    const presentTypes = [...new Set(rows.map((r) => r.granteeType))]
    const clearable = presentTypes.filter((t): t is SharingGranteeType =>
      SharingGranteeTypeValues.includes(t as SharingGranteeType)
    )
    const unclearable = presentTypes.filter(
      (t) => !SharingGranteeTypeValues.includes(t as SharingGranteeType)
    )

    utils.resourceAccess.forType.setData(queryInput, (prev) =>
      (prev ?? []).filter((r) => unclearable.includes(r.granteeType))
    )
    for (const granteeType of clearable) {
      setType.mutate({ entityDefinitionId: queryInput.entityDefinitionId, granteeType, grants: [] })
    }

    if (unclearable.length > 0) {
      toastError({
        title: 'Access not fully reset',
        description: `This record type still has ${unclearable
          .map(granteeKindLabel)
          .join(
            ' and '
          )} access rows, which can’t be cleared from here. It stays restricted until they are removed.`,
      })
    }
  }, [rows, setType, utils, queryInput])

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
    unmanageableGrants,
    isSaving: grantType.isPending || revokeType.isPending || setType.isPending,
    setBaseline,
    addGrant,
    setGrant,
    removeGrant,
    resetToDefault,
    isIgnored,
  }
}
