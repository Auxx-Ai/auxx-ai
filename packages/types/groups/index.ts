// packages/types/groups/index.ts

import type {
  MemberType,
  GroupVisibility,
  ResourcePermission,
  ResourceGranteeType,
} from '@auxx/database/enums'
import type { EntityInstanceEntity } from '@auxx/database/models'

// ============================================================================
// Context & Input Types
// ============================================================================

/** Context passed to all group functions (server-side only) */
export interface GroupContext {
  /** Database instance - use `import type { Database } from '@auxx/database'` for full type */
  db: unknown
  organizationId: string
  userId: string
}

/** Input for creating a group */
export interface CreateGroupInput {
  name: string
  description?: string
  /** 'any' or EntityDefinition.resourceType */
  memberType: 'any' | string
  visibility: GroupVisibility
  color?: string
  icon?: string
}

/** Input for adding members */
export interface AddMembersInput {
  groupId: string
  members: Array<{
    type: MemberType
    id: string
  }>
}

/** Result of adding members */
export interface AddMembersResult {
  added: number
  skipped: number
}

// ============================================================================
// Member Types
// ============================================================================

/** Basic user info for group member resolution */
export interface GroupMemberUser {
  id: string
  name: string | null
  email: string | null
  image: string | null
}

/** Member with resolved details */
export interface GroupMember {
  id: string
  memberType: MemberType
  memberRefId: string
  sortKey: string
  createdAt: Date
  /** Resolved entity data (populated when memberType === 'entity') */
  entity?: EntityInstanceEntity
  /** Resolved user data (populated when memberType === 'user') */
  user?: GroupMemberUser
}

// ============================================================================
// Permission Types
// ============================================================================

/** Permission grant input */
export interface GrantPermissionInput {
  groupId: string
  granteeType: ResourceGranteeType
  granteeId: string
  permission: ResourcePermission
}

/** Permission info returned from queries */
export interface GroupPermissionInfo {
  id: string
  granteeType: ResourceGranteeType
  granteeId: string
  permission: ResourcePermission
  createdAt: Date
}

// ============================================================================
// Permission Constants
// ============================================================================

/** Permission hierarchy for level comparison */
export const PERMISSION_HIERARCHY: Record<ResourcePermission, number> = {
  view: 1,
  edit: 2,
  admin: 3,
}

/**
 * Check if a permission level satisfies a required level
 */
export function satisfiesPermission(
  actual: ResourcePermission,
  required: ResourcePermission
): boolean {
  return PERMISSION_HIERARCHY[actual] >= PERMISSION_HIERARCHY[required]
}
