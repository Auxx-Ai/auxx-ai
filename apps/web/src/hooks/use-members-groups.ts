// /app/settings/inbox/_hooks/use-members-and-groups.ts
import { keepPreviousData } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { api } from '~/trpc/react'
// import { Group, Member } from '../_components/member-group-popover'

interface UseMembersAndGroupsResult {
  members: Member[]
  groups: Group[]
  isLoading: boolean
  error: Error | null
}
export interface Member {
  id: string // OrganizationMember ID
  userId: string // User ID for notifications
  name: string
  email?: string
  picture?: string
}

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
  } = api.organization.allMembers.useQuery(
    { search: searchQuery || '' },
    {
      // Only refetch when search query changes
      placeholderData: keepPreviousData,
      onError: (err) => setError(err),
    }
  )

  // Fetch groups
  const {
    data: groupsData,
    isLoading: isLoadingGroups,
    error: groupsError,
  } = api.group.all.useQuery(
    { search: searchQuery || '' },
    {
      // Only refetch when search query changes
      placeholderData: keepPreviousData,
      onError: (err) => setError(err),
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

  const groups: Group[] =
    groupsData?.groups?.map((group) => ({
      id: group.id,
      name: group.name,
      memberCount: group.memberCount || 0,
    })) || []

  return {
    members,
    groups,
    isLoading: isLoadingMembers || isLoadingGroups,
    error,
  }
}
