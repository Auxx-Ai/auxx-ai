// apps/web/src/components/groups/hooks/use-group-members.ts
'use client'

import { api } from '~/trpc/react'
import { useGroupsStore } from '../store'
import { useEffect } from 'react'

/** Options for the useGroupMembers hook */
interface UseGroupMembersOptions {
  /** Limit number of results */
  limit?: number
  /** Offset for pagination */
  offset?: number
  /** Enable/disable the query */
  enabled?: boolean
}

/**
 * Hook to fetch members of a group
 * Syncs data to the groups store for caching
 */
export function useGroupMembers(groupId: string, options: UseGroupMembersOptions = {}) {
  const { limit, offset, enabled = true } = options
  const setMembers = useGroupsStore((s) => s.setMembers)

  const query = api.entityGroup.members.useQuery(
    { groupId, limit, offset },
    { enabled: enabled && !!groupId }
  )

  // Sync to store when data changes
  useEffect(() => {
    if (query.data && groupId) {
      setMembers(groupId, query.data)
    }
  }, [query.data, groupId, setMembers])

  return query
}
