// apps/web/src/components/permissions/hooks/use-instance-share.ts
'use client'

import { ResourceGranteeType, ResourcePermission } from '@auxx/database/enums'
import type { Level } from '@auxx/lib/permissions/client'
import type { ResourceAccessInfo } from '@auxx/lib/resource-access'
import type { ActorId } from '@auxx/types/actor'
import type { RecordId } from '@auxx/types/resource'
import { toastError } from '@auxx/ui/components/toast'
import { useMemo } from 'react'
import {
  actorIdToGrantee,
  GRANTEE_UNSUPPORTED_MESSAGE,
  granteeToActorId,
  isActorGrantee,
  type UnmanageableGrant,
} from '~/components/permissions/utils/grantee'
import { api } from '~/trpc/react'

/** Instance grant level — the raw Read/Write/Full ResourceAccess permission. */
export type InstanceLevel = Exclude<ResourcePermission, 'none'>

/**
 * The workspace-baseline (`role:org_member`) state for an instance:
 *  - `view`/`edit`/`admin` — everyone in the workspace gets at least this level;
 *  - `'restricted'` — an explicit `'none'` marker (no org-wide access);
 *  - `undefined` — no explicit baseline row: the instance falls back to its L2
 *    area base level (for `baselineAtCreate: false` resources that's org-Read,
 *    i.e. shared-with-org by default — until a first grant materializes it).
 */
export type WorkspaceBaseline = InstanceLevel | 'restricted' | undefined

export interface InstanceShareGrant {
  actorId: ActorId
  choice: InstanceLevel
  /**
   * The user grantee's own composed Layer-2 level for this instance's L2 area
   * (capability layer v2 Part B.2.8), server-annotated on `forInstance`.
   * `undefined` for group/team/role/profile grantees — they are level
   * *sources*, not subjects — and while the annotation hasn't loaded yet.
   * `Level.None` here means the grant is a dead grant: `effectiveInstanceLevel`
   * short-circuits at area None before ever consulting this row.
   */
  granteeAreaLevel?: Level
}

/** The fixed grantee for the workspace baseline (everyone in the org). */
const WORKSPACE_GRANTEE = {
  granteeType: ResourceGranteeType.role,
  granteeId: 'org_member',
} as const

/**
 * Sharing state + mutations for one instance-access resource instance (datasets
 * etc.), keyed by its whole `RecordId`. The drop-in sibling of `useMailShare`,
 * minus the mail-lens semantics — it writes the RAW instance grant
 * (Read/Write/Full) over `resourceAccess.forInstance` (read) +
 * `grantInstance`/`revokeInstance` (write).
 *
 * Workspace-baseline preservation (§4, "workspace-baseline preservation"):
 * datasets are `baselineAtCreate: false`, so the moment an instance gains ANY
 * explicit row every member WITHOUT their own row loses the org-wide base-Read.
 * To avoid silently privatizing a dataset when it's first shared to one person,
 * {@link grant} materializes a workspace baseline at Read on the first grant
 * (unless the admin has already set an explicit baseline — incl. Restricted).
 */
export function useInstanceShare({
  recordId,
  enabled = true,
}: {
  recordId: RecordId
  enabled?: boolean
}) {
  const utils = api.useUtils()

  const { data: rows = [], isLoading } = api.resourceAccess.forInstance.useQuery(
    { recordId },
    { enabled: enabled && !!recordId }
  )

  const invalidate = () => utils.resourceAccess.forInstance.invalidate({ recordId })

  const setRows = (updater: (rows: ResourceAccessInfo[]) => ResourceAccessInfo[]) => {
    utils.resourceAccess.forInstance.setData({ recordId }, (prev) => updater(prev ?? []))
  }

  const optimisticRow = (
    granteeType: ResourceGranteeType,
    granteeId: string,
    permission: ResourcePermission
  ): ResourceAccessInfo => ({
    id: `optimistic-${granteeType}-${granteeId}`,
    entityDefinitionId: recordId.split(':')[0] ?? '',
    entityInstanceId: recordId.split(':')[1] ?? null,
    granteeType,
    granteeId,
    permission,
    lens: null,
    createdAt: new Date(),
  })

  const grantInstance = api.resourceAccess.grantInstance.useMutation({
    onMutate: async (input) => {
      await utils.resourceAccess.forInstance.cancel({ recordId })
      const previous = utils.resourceAccess.forInstance.getData({ recordId })
      setRows((rows) => [
        optimisticRow(input.granteeType, input.granteeId, input.permission),
        ...rows.filter(
          (r) => !(r.granteeType === input.granteeType && r.granteeId === input.granteeId)
        ),
      ])
      return { previous }
    },
    onError: (error, _input, context) => {
      utils.resourceAccess.forInstance.setData({ recordId }, context?.previous)
      toastError({ title: 'Error updating access', description: error.message })
    },
    onSettled: invalidate,
  })

  const revokeInstance = api.resourceAccess.revokeInstance.useMutation({
    onMutate: async (input) => {
      await utils.resourceAccess.forInstance.cancel({ recordId })
      const previous = utils.resourceAccess.forInstance.getData({ recordId })
      setRows((rows) =>
        rows.filter(
          (r) => !(r.granteeType === input.granteeType && r.granteeId === input.granteeId)
        )
      )
      return { previous }
    },
    onError: (error, _input, context) => {
      utils.resourceAccess.forInstance.setData({ recordId }, context?.previous)
      toastError({ title: 'Error removing access', description: error.message })
    },
    onSettled: invalidate,
  })

  /** Actor-keyed user/group grants (excludes the workspace baseline row). */
  const grants = useMemo<InstanceShareGrant[]>(
    () =>
      rows.flatMap((r) => {
        const actorId = granteeToActorId(r.granteeType, r.granteeId)
        if (!actorId) return []
        return [
          {
            actorId,
            choice: r.permission as InstanceLevel,
            granteeAreaLevel: r.granteeAreaLevel,
          },
        ]
      }),
    [rows]
  )

  /**
   * Rows this card can neither render as an actor nor revoke — a `profile`
   * grantee today (plan 19 §8.2), any future kind tomorrow. Surfaced rather than
   * dropped: silently filtering them told the admin "not shared with anyone"
   * while a live grant existed server-side, so they could not see OR revoke it.
   */
  const unmanageableGrants = useMemo<UnmanageableGrant[]>(
    () =>
      rows
        .filter(
          (r) =>
            !isActorGrantee(r.granteeType) &&
            !(
              r.granteeType === WORKSPACE_GRANTEE.granteeType &&
              r.granteeId === WORKSPACE_GRANTEE.granteeId
            )
        )
        .map((r) => ({ granteeType: r.granteeType, granteeId: r.granteeId })),
    [rows]
  )

  /** The workspace baseline (`role:org_member`) row, if one exists. */
  const baselineRow = useMemo(
    () =>
      rows.find(
        (r) =>
          r.granteeType === WORKSPACE_GRANTEE.granteeType &&
          r.granteeId === WORKSPACE_GRANTEE.granteeId
      ),
    [rows]
  )

  const baseline: WorkspaceBaseline = baselineRow
    ? baselineRow.permission === ResourcePermission.none
      ? 'restricted'
      : (baselineRow.permission as InstanceLevel)
    : undefined

  /**
   * Grant or change a user/group's level (upsert). On the FIRST explicit row for
   * a still-unshared instance, also materialize the workspace baseline at Read so
   * the rest of the org keeps its base-level access instead of silently losing it.
   *
   * An ActorId with no grantee representation is REFUSED, not coerced: the old
   * `type === 'group' ? group : user` fall-through turned an `agent:`/`worker:`
   * pick into a `user` row keyed on an `Agent.id`/`DispatchWorker.id` — a row
   * pointing at the wrong table that no resolver matches and no admin can see.
   */
  const grant = (actorId: ActorId, choice: InstanceLevel) => {
    const grantee = actorIdToGrantee(actorId)
    if (!grantee) {
      toastError({
        title: 'Cannot share with this actor',
        description: GRANTEE_UNSUPPORTED_MESSAGE,
      })
      return
    }
    if (rows.length === 0 && !baselineRow) {
      grantInstance.mutate({
        recordId,
        granteeType: WORKSPACE_GRANTEE.granteeType,
        granteeId: WORKSPACE_GRANTEE.granteeId,
        permission: ResourcePermission.view,
      })
    }
    grantInstance.mutate({ recordId, ...grantee, permission: choice })
  }

  const revoke = (actorId: ActorId) => {
    const grantee = actorIdToGrantee(actorId)
    if (!grantee) {
      toastError({ title: 'Cannot remove this access', description: GRANTEE_UNSUPPORTED_MESSAGE })
      return
    }
    revokeInstance.mutate({ recordId, ...grantee })
  }

  /** Set the workspace baseline. `'restricted'` writes the `'none'` marker. */
  const setBaseline = (next: InstanceLevel | 'restricted') => {
    grantInstance.mutate({
      recordId,
      granteeType: WORKSPACE_GRANTEE.granteeType,
      granteeId: WORKSPACE_GRANTEE.granteeId,
      permission: next === 'restricted' ? ResourcePermission.none : next,
    })
  }

  return {
    grants,
    unmanageableGrants,
    baseline,
    isLoading,
    grant,
    changeLevel: grant,
    revoke,
    setBaseline,
    isMutating: grantInstance.isPending || revokeInstance.isPending,
  }
}
