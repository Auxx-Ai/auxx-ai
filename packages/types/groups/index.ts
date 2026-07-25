// packages/types/groups/index.ts

import type { Database } from '@auxx/database'
import type {
  GroupVisibility,
  MemberType,
  ResourceGranteeType,
  ResourcePermission,
} from '@auxx/database/enums'
import type { EntityInstanceEntity } from '@auxx/database/types'

// ============================================================================
// Context & Input Types
// ============================================================================

/** Context passed to all group functions (server-side only) */
export interface GroupContext {
  /** Database instance - use `import type { Database } from '@auxx/database'` for full type */
  db: Database
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
  /**
   * Full grantee vocabulary. A group ACL is a `ResourceAccess` INSTANCE grant on
   * the `entity_group` def, so doc 19 §0.28's "profile selectable as an additive
   * grantee" applies here too (plan 19 step 9).
   */
  granteeType: ResourceGranteeType
  granteeId: string
  permission: ResourcePermission
}

/** Permission info returned from queries */
export interface GroupPermissionInfo {
  id: string
  /** Full grantee vocabulary — reads mirror whatever `ResourceAccess` stores. */
  granteeType: ResourceGranteeType
  granteeId: string
  permission: ResourcePermission
  createdAt: Date
}

// ============================================================================
// Permission Constants
// ============================================================================

/**
 * Permission hierarchy for level comparison. `none` is the baseline lockdown
 * marker (capability layer v2 phase 3) and ranks below every positive level, so
 * a `none` actual satisfies nothing — group sharing never writes it, but it must
 * be present for the exhaustive `Record<ResourcePermission, number>` type.
 */
export const PERMISSION_HIERARCHY: Record<ResourcePermission, number> = {
  none: 0,
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
