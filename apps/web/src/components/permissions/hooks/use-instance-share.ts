// apps/web/src/components/permissions/hooks/use-instance-share.ts
'use client'

import { ResourceGranteeType, ResourcePermission } from '@auxx/database/enums'
import type { ResourceAccessInfo } from '@auxx/lib/resource-access'
import { type ActorId, parseActorId, toActorId } from '@auxx/types/actor'
import type { RecordId } from '@auxx/types/resource'
import { toastError } from '@auxx/ui/components/toast'
import { useMemo } from 'react'
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
      rows
        .filter(
          (r) =>
            r.granteeType === ResourceGranteeType.user ||
            r.granteeType === ResourceGranteeType.group
        )
        .map((r) => ({
          actorId: toActorId(
            r.granteeType === ResourceGranteeType.group ? 'group' : 'user',
            r.granteeId
          ),
          choice: r.permission as InstanceLevel,
        })),
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

  const toGrantee = (actorId: ActorId) => {
    const { type, id } = parseActorId(actorId)
    return {
      granteeType: type === 'group' ? ResourceGranteeType.group : ResourceGranteeType.user,
      granteeId: id,
    }
  }

  /**
   * Grant or change a user/group's level (upsert). On the FIRST explicit row for
   * a still-unshared instance, also materialize the workspace baseline at Read so
   * the rest of the org keeps its base-level access instead of silently losing it.
   */
  const grant = (actorId: ActorId, choice: InstanceLevel) => {
    if (rows.length === 0 && !baselineRow) {
      grantInstance.mutate({
        recordId,
        granteeType: WORKSPACE_GRANTEE.granteeType,
        granteeId: WORKSPACE_GRANTEE.granteeId,
        permission: ResourcePermission.view,
      })
    }
    const { granteeType, granteeId } = toGrantee(actorId)
    grantInstance.mutate({ recordId, granteeType, granteeId, permission: choice })
  }

  const revoke = (actorId: ActorId) => {
    const { granteeType, granteeId } = toGrantee(actorId)
    revokeInstance.mutate({ recordId, granteeType, granteeId })
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
    baseline,
    isLoading,
    grant,
    changeLevel: grant,
    revoke,
    setBaseline,
    isMutating: grantInstance.isPending || revokeInstance.isPending,
  }
}
