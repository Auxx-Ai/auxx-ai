// apps/web/src/components/resources/hooks/use-resource-access.ts

'use client'

import { useMemo } from 'react'
import { api } from '~/trpc/react'
import { toActorId, type ActorId } from '@auxx/types/actor'
import { ResourceGranteeType } from '@auxx/database/enums'
import type { ResourceAccessInfo } from '@auxx/lib/resource-access'

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
  /** Loading state */
  isLoading: boolean
  /** Invalidate and refetch */
  refetch: () => void
}

/**
 * Hook to get resource access grants and convert to ActorIds.
 */
export function useResourceAccess({ recordId, enabled = true }: UseResourceAccessOptions): UseResourceAccessResult {
  const utils = api.useUtils()

  const { data: grants = [], isLoading } = api.resourceAccess.forInstance.useQuery(
    { recordId },
    { enabled: enabled && !!recordId }
  )

  const { granteeActorIds, groupIds, userIds } = useMemo(() => {
    const actorIds: ActorId[] = []
    const groups: string[] = []
    const users: string[] = []

    for (const grant of grants) {
      if (grant.granteeType === ResourceGranteeType.group) {
        actorIds.push(toActorId('group', grant.granteeId))
        groups.push(grant.granteeId)
      } else if (grant.granteeType === ResourceGranteeType.user) {
        actorIds.push(toActorId('user', grant.granteeId))
        users.push(grant.granteeId)
      }
    }

    return { granteeActorIds: actorIds, groupIds: groups, userIds: users }
  }, [grants])

  const refetch = () => utils.resourceAccess.forInstance.invalidate({ recordId })

  return {
    grants,
    granteeActorIds,
    groupIds,
    userIds,
    isLoading,
    refetch,
  }
}
