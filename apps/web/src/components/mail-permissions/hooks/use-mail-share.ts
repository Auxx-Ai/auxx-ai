// apps/web/src/components/mail-permissions/hooks/use-mail-share.ts
'use client'

import { ResourceGranteeType, ResourcePermission } from '@auxx/database/enums'
import type { LensChoice } from '@auxx/lib/permissions/visibility/client'
import type { ResourceAccessInfo } from '@auxx/lib/resource-access'
import { type ActorId, parseActorId, toActorId } from '@auxx/types/actor'
import { toastError } from '@auxx/ui/components/toast'
import { useMemo } from 'react'
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
          choice:
            r.permission === ResourcePermission.admin || r.permission === ResourcePermission.edit
              ? r.permission === ResourcePermission.admin
                ? ('manager' as const)
                : ('full' as const)
              : ((r.lens ?? 'full') as LensChoice),
        })),
    [rows]
  )

  const toGrantee = (actorId: ActorId) => {
    const { type, id } = parseActorId(actorId)
    return {
      granteeType: type === 'group' ? ResourceGranteeType.group : ResourceGranteeType.user,
      granteeId: id,
    }
  }

  /** Grant or change an actor's level (upsert semantics server-side). */
  const grant = (actorId: ActorId, choice: LensChoice) => {
    const { granteeType, granteeId } = toGrantee(actorId)
    grantInstance.mutate({
      recordId,
      granteeType,
      granteeId,
      permission: choice === 'manager' ? ResourcePermission.admin : ResourcePermission.view,
      lens: choice === 'manager' ? undefined : choice,
    })
  }

  const revoke = (actorId: ActorId) => {
    const { granteeType, granteeId } = toGrantee(actorId)
    revokeInstance.mutate({ recordId, granteeType, granteeId })
  }

  return {
    grants,
    isLoading,
    grant,
    changeLens: grant,
    revoke,
    isMutating: grantInstance.isPending || revokeInstance.isPending,
  }
}
