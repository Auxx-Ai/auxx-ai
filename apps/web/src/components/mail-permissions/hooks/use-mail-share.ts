// apps/web/src/components/mail-permissions/hooks/use-mail-share.ts
'use client'

import { ResourceGranteeType, ResourcePermission } from '@auxx/database/enums'
import type { LensChoice } from '@auxx/lib/permissions/visibility/client'
import type { ResourceAccessInfo } from '@auxx/lib/resource-access'
import type { ActorId } from '@auxx/types/actor'
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

export interface MailShareGrant {
  actorId: ActorId
  choice: LensChoice
}

/**
 * Sharing state + mutations for one mail record (`inbox:<id>`, `thread:<id>`,
 * or `<contactDefId>:<id>`): the lens-aware grants keyed by actor, and
 * optimistic grant / change / revoke over `resourceAccess.*`. Shared by the
 * thread popover, the contact card, and the inbox Access section.
 */
export function useMailShare({
  recordId,
  enabled = true,
}: {
  recordId: string
  enabled?: boolean
}) {
  const utils = api.useUtils()

  const { data: rows = [], isLoading } = api.resourceAccess.forInstance.useQuery(
    { recordId },
    { enabled: enabled && !!recordId }
  )

  const invalidate = () => utils.resourceAccess.forInstance.invalidate({ recordId })

  /** Optimistically rewrite the cached forInstance rows. */
  const setRows = (updater: (rows: ResourceAccessInfo[]) => ResourceAccessInfo[]) => {
    utils.resourceAccess.forInstance.setData({ recordId }, (prev) => updater(prev ?? []))
  }

  const grantInstance = api.resourceAccess.grantInstance.useMutation({
    onMutate: async (input) => {
      await utils.resourceAccess.forInstance.cancel({ recordId })
      const previous = utils.resourceAccess.forInstance.getData({ recordId })
      setRows((rows) => {
        const rest = rows.filter(
          (r) => !(r.granteeType === input.granteeType && r.granteeId === input.granteeId)
        )
        return [
          {
            id: `optimistic-${input.granteeType}-${input.granteeId}`,
            entityDefinitionId: recordId.split(':')[0] ?? '',
            entityInstanceId: recordId.split(':')[1] ?? null,
            granteeType: input.granteeType,
            granteeId: input.granteeId,
            permission: input.permission,
            lens: input.lens ?? null,
            createdAt: new Date(),
          },
          ...rest,
        ]
      })
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

  /** Grants as actor-keyed lens choices (admin permission renders as Manager). */
  const grants = useMemo<MailShareGrant[]>(
    () =>
      rows.flatMap((r) => {
        const actorId = granteeToActorId(r.granteeType, r.granteeId)
        if (!actorId) return []
        return [
          {
            actorId,
            choice:
              r.permission === ResourcePermission.admin || r.permission === ResourcePermission.edit
                ? r.permission === ResourcePermission.admin
                  ? ('manager' as const)
                  : ('full' as const)
                : ((r.lens ?? 'full') as LensChoice),
          },
        ]
      }),
    [rows]
  )

  /**
   * Rows this surface can neither render as an actor nor revoke — a `profile`
   * grantee today (plan 19 §8.2). Disclosed rather than dropped, so an admin is
   * never shown an empty share list while a live grant exists server-side.
   *
   * The `role:org_member` row is excluded because it is the inbox's ORG-WIDE
   * FLOOR, not a share — it IS a row since plan 40 §6 (it used to be the
   * `inbox_default_lens` FieldValue), but it is authored by the inbox form's
   * Everyone/Restricted control via `inbox.setAccessFloor`, and surfacing it
   * here as an unmanageable grant would tell every thread-popover viewer their
   * inbox has a mystery grantee they cannot remove.
   *
   * This hook itself keeps serving the THREAD popover and the contact card; the
   * inbox Access section owns its own rows (it needs the create-mode staging
   * the optimistic mutations here cannot express).
   */
  const unmanageableGrants = useMemo<UnmanageableGrant[]>(
    () =>
      rows
        .filter((r) => !isActorGrantee(r.granteeType) && r.granteeType !== ResourceGranteeType.role)
        .map((r) => ({ granteeType: r.granteeType, granteeId: r.granteeId })),
    [rows]
  )

  /**
   * Grant or change an actor's level (upsert semantics server-side).
   *
   * An ActorId with no grantee representation is REFUSED, not coerced: the old
   * `type === 'group' ? group : user` fall-through turned an `agent:`/`worker:`
   * pick into a `user` row keyed on an `Agent.id`/`DispatchWorker.id`, which
   * points at the wrong table and grants nobody anything.
   */
  const grant = (actorId: ActorId, choice: LensChoice) => {
    const grantee = actorIdToGrantee(actorId)
    if (!grantee) {
      toastError({
        title: 'Cannot share with this actor',
        description: GRANTEE_UNSUPPORTED_MESSAGE,
      })
      return
    }
    grantInstance.mutate({
      recordId,
      ...grantee,
      permission: choice === 'manager' ? ResourcePermission.admin : ResourcePermission.view,
      lens: choice === 'manager' ? undefined : choice,
    })
  }

  const revoke = (actorId: ActorId) => {
    const grantee = actorIdToGrantee(actorId)
    if (!grantee) {
      toastError({ title: 'Cannot remove this access', description: GRANTEE_UNSUPPORTED_MESSAGE })
      return
    }
    revokeInstance.mutate({ recordId, ...grantee })
  }

  return {
    grants,
    unmanageableGrants,
    isLoading,
    grant,
    changeLens: grant,
    revoke,
    isMutating: grantInstance.isPending || revokeInstance.isPending,
  }
}
