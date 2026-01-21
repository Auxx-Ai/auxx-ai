// apps/web/src/components/groups/hooks/use-groups-for-entity.ts
'use client'

import { api } from '~/trpc/react'

/** Options for the useGroupsForEntity hook */
interface UseGroupsForEntityOptions {
  /** Enable/disable the query */
  enabled?: boolean
}

/**
 * Hook to fetch groups that contain a specific entity
 */
export function useGroupsForEntity(entityId: string, options: UseGroupsForEntityOptions = {}) {
  const { enabled = true } = options

  return api.entityGroup.forEntity.useQuery({ entityId }, { enabled: enabled && !!entityId })
}
