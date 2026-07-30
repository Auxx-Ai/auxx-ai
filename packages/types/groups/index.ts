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

// `PERMISSION_HIERARCHY` + `satisfiesPermission` used to be defined here. They
// are now `PERMISSION_RANK` + `satisfiesPermission` in `@auxx/types/permissions`
// — the same table, one copy (plan v3/03 P3a §3).
