// apps/web/src/components/groups/hooks/use-groups-for-user.ts
'use client'

import { api } from '~/trpc/react'

/** Options for the useGroupsForUser hook */
interface UseGroupsForUserOptions {
  /** Enable/disable the query */
  enabled?: boolean
}

/**
 * Hook to fetch groups that contain a specific user
 */
export function useGroupsForUser(userId: string, options: UseGroupsForUserOptions = {}) {
  const { enabled = true } = options

  return api.entityGroup.forUser.useQuery({ userId }, { enabled: enabled && !!userId })
}
