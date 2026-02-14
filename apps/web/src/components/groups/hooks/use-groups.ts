// apps/web/src/components/groups/hooks/use-groups.ts
'use client'

import { useEffect } from 'react'
import { api } from '~/trpc/react'
import { useGroupsStore } from '../store'

/** Options for the useGroups hook */
interface UseGroupsOptions {
  /** Search query to filter groups */
  search?: string
  /** Limit number of results */
  limit?: number
  /** Enable/disable the query */
  enabled?: boolean
}

/**
 * Hook to fetch list of accessible groups
 * Syncs data to the groups store for caching
 */
export function useGroups(options: UseGroupsOptions = {}) {
  const { search, limit, enabled = true } = options
  const setGroups = useGroupsStore((s) => s.setGroups)

  const query = api.entityGroup.list.useQuery({ search, limit }, { enabled })

  // Sync to store when data changes
  useEffect(() => {
    if (query.data) {
      setGroups(query.data)
    }
  }, [query.data, setGroups])

  return query
}
