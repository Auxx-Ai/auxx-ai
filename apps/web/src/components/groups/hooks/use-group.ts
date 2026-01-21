// apps/web/src/components/groups/hooks/use-group.ts
'use client'

import { useGroupsStore } from '../store'

/**
 * Hook to get a single group from the store by ID
 * Note: Groups must be loaded first via useGroups
 */
export function useGroup(groupId: string | undefined) {
  const groups = useGroupsStore((s) => s.groups)

  if (!groupId) return null
  return groups.get(groupId) ?? null
}
