// packages/lib/src/groups/client.ts
'use client'

// Client-safe entry point for groups module
// Re-exports types, constants, and pure functions that don't require database access

// Types from @auxx/types/groups
export type {
  CreateGroupInput,
  AddMembersInput,
  AddMembersResult,
  GroupMember,
  GroupMemberUser,
  GrantPermissionInput,
  GroupPermissionInfo,
} from '@auxx/types/groups'

// Pure functions and constants from @auxx/types/groups
export { PERMISSION_HIERARCHY, satisfiesPermission } from '@auxx/types/groups'

// Group enums from @auxx/database/enums (already client-safe)
export {
  MemberType,
  MemberTypeValues,
  GroupVisibility,
  GroupVisibilityValues,
  ResourcePermission,
  ResourcePermissionValues,
  ResourceGranteeType,
  ResourceGranteeTypeValues,
} from '@auxx/database/enums'
