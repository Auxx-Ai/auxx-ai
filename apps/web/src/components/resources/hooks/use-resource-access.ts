// apps/web/src/components/resources/hooks/use-resource-access.ts

'use client'

import { ResourceGranteeType } from '@auxx/database/enums'
import type { ResourceAccessInfo } from '@auxx/lib/resource-access'
import type { ActorId } from '@auxx/types/actor'
import { useMemo } from 'react'
import { granteeToActorId, type UnmanageableGrant } from '~/components/permissions/utils/grantee'
import { api } from '~/trpc/react'

interface UseResourceAccessOptions {
  /** RecordId in format "entityType:instanceId" (e.g., "inbox:abc123") */
  recordId: string
  /** Enable/disable the query */
  enabled?: boolean
}

interface UseResourceAccessResult {
  /** All access grants for this resource */
  grants: ResourceAccessInfo[]
  /** ActorIds of all grantees (for use with useActors) */
  granteeActorIds: ActorId[]
  /** Group grantee IDs only */
  groupIds: string[]
  /** User grantee IDs only */
  userIds: string[]
  /**
   * Grants with no ActorId representation — `role` baselines, and `profile`
   * grants (plan 19 §8.2). Callers that show a count or an "is this shared?"
   * affordance must consult this alongside {@link granteeActorIds}, or a live
   * grant reads as "not shared with anyone".
   */
  unmanageableGrants: UnmanageableGrant[]
  /** Loading state */
  isLoading: boolean
  /** Invalidate and refetch */
  refetch: () => void
}

/**
 * Hook to get resource access grants and convert to ActorIds.
 */
export function useResourceAccess({
  recordId,
  enabled = true,
}: UseResourceAccessOptions): UseResourceAccessResult {
  const utils = api.useUtils()

  const { data: grants = [], isLoading } = api.resourceAccess.forInstance.useQuery(
    { recordId },
    { enabled: enabled && !!recordId }
  )

  const { granteeActorIds, groupIds, userIds, unmanageableGrants } = useMemo(() => {
    const actorIds: ActorId[] = []
    const groups: string[] = []
    const users: string[] = []
    const unmanageable: UnmanageableGrant[] = []

    // Exhaustive by construction: `granteeToActorId` returns `null` for every
    // kind with no actor, and that branch is now an explicit `else` rather than
    // the absent one an `if group … else if user …` chain left behind.
    for (const grant of grants) {
      const actorId = granteeToActorId(grant.granteeType, grant.granteeId)
      if (!actorId) {
        unmanageable.push({ granteeType: grant.granteeType, granteeId: grant.granteeId })
        continue
      }
      actorIds.push(actorId)
      if (grant.granteeType === ResourceGranteeType.group) groups.push(grant.granteeId)
      else users.push(grant.granteeId)
    }

    return {
      granteeActorIds: actorIds,
      groupIds: groups,
      userIds: users,
      unmanageableGrants: unmanageable,
    }
  }, [grants])

  const refetch = () => utils.resourceAccess.forInstance.invalidate({ recordId })

  return {
    grants,
    granteeActorIds,
    groupIds,
    userIds,
    unmanageableGrants,
    isLoading,
    refetch,
  }
}
