// apps/web/src/hooks/use-members-groups.ts
import { keepPreviousData } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { api } from '~/trpc/react'

/** Result interface for the useMembersGroups hook */
interface UseMembersAndGroupsResult {
  members: Member[]
  groups: Group[]
  isLoading: boolean
  error: Error | null
}

/** Member data structure */
export interface Member {
  id: string // OrganizationMember ID
  userId: string // User ID for notifications
  name: string
  email?: string
  picture?: string
}

/** Group data structure */
export interface Group {
  id: string
  name: string
  memberCount: number
}

/**
 * Hook to fetch and filter members and groups for the organization
 * @param searchQuery Optional search query to filter results
 * @returns Object containing members and groups data, loading state, and any error
 */
export function useMembersGroups(searchQuery?: string): UseMembersAndGroupsResult {
  const [error, setError] = useState<Error | null>(null)

  // Fetch members
  const {
    data: membersData,
    isLoading: isLoadingMembers,
    error: membersError,
  } = api.member.all.useQuery(
    { search: searchQuery || '' },
    {
      placeholderData: keepPreviousData,
    }
  )

  // Fetch groups (using new entityGroup API)
  const {
    data: groupsData,
    isLoading: isLoadingGroups,
    error: groupsError,
  } = api.entityGroup.list.useQuery(
    { search: searchQuery },
    {
      placeholderData: keepPreviousData,
    }
  )

  useEffect(() => {
    // Set error if either query fails
    if (membersError) setError(membersError)
    if (groupsError) setError(groupsError)
  }, [membersError, groupsError])

  // Map API data to component props format
  const members: Member[] =
    membersData?.members?.map((member) => ({
      id: member.id, // OrganizationMember ID (keep for existing compatibility)
      userId: member.user.id, // User ID for notifications
      name: member.user.name || `User ${member.id.substring(0, 4)}`,
      email: member.user.email || undefined,
      picture: member.user.image || undefined,
    })) || []

  // Map groups from EntityInstance format to Group format
  const groups: Group[] =
    groupsData?.map((group) => {
      const metadata = (group.metadata as { memberCount?: number }) || {}
      return {
        id: group.id,
        name: group.displayName || 'Group',
        memberCount: metadata.memberCount || 0,
      }
    }) || []

  return {
    members,
    groups,
    isLoading: isLoadingMembers || isLoadingGroups,
    error,
  }
}
