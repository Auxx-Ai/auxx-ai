// apps/web/src/components/groups/utils/group-utils.ts

import type { EntityInstanceEntity } from '@auxx/database'
import type { GroupMember } from '@auxx/types/groups'
import { MemberType } from '@auxx/lib/groups/client'

/** Metadata stored on group EntityInstance */
export interface GroupMetadata {
  visibility?: 'public' | 'private'
  memberType?: string
  memberCount?: number
  color?: string
  icon?: string
}

/**
 * Extract typed metadata from a group EntityInstance
 */
export function getGroupMetadata(group: EntityInstanceEntity): GroupMetadata {
  return (group.metadata as GroupMetadata) || {}
}

/**
 * Get display name for a member type
 */
export function formatMemberType(type: string): string {
  switch (type) {
    case 'user':
      return 'User'
    case 'entity':
      return 'Record'
    case 'any':
      return 'Any'
    default:
      return type
  }
}

/**
 * Get display info for a group member (works for both user and entity members)
 */
export function getMemberDisplayInfo(member: GroupMember): { name: string; image: string | null } {
  if (member.memberType === MemberType.user && member.user) {
    return {
      name: member.user.name || member.user.email || 'User',
      image: member.user.image,
    }
  }
  if (member.memberType === MemberType.entity && member.entity) {
    return {
      name: member.entity.displayName || 'Record',
      image: null,
    }
  }
  return { name: 'Unknown', image: null }
}

/**
 * Get initials from a name for avatar display
 */
export function getInitials(name: string): string {
  return name
    .split(' ')
    .map((part) => part[0])
    .join('')
    .toUpperCase()
    .substring(0, 2)
}
