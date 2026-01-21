// apps/web/src/components/groups/hooks/use-group-permissions.ts
'use client'

import { api } from '~/trpc/react'
import { useGroupsStore } from '../store'
import { useEffect } from 'react'

/** Options for the useGroupPermissions hook */
interface UseGroupPermissionsOptions {
  /** Enable/disable the query */
  enabled?: boolean
}

/**
 * Hook to fetch permissions for a group
 * Syncs data to the groups store for caching
 */
export function useGroupPermissions(groupId: string, options: UseGroupPermissionsOptions = {}) {
  const { enabled = true } = options
  const setPermissions = useGroupsStore((s) => s.setPermissions)

  const query = api.entityGroup.permissions.useQuery({ groupId }, { enabled: enabled && !!groupId })

  // Sync to store when data changes
  useEffect(() => {
    if (query.data && groupId) {
      setPermissions(groupId, query.data)
    }
  }, [query.data, groupId, setPermissions])

  return query
}

/**
 * Hook to get the current user's permission level on a group
 */
export function useMyGroupPermission(groupId: string, options: UseGroupPermissionsOptions = {}) {
  const { enabled = true } = options

  return api.entityGroup.myPermission.useQuery({ groupId }, { enabled: enabled && !!groupId })
}
