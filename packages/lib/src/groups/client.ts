// packages/lib/src/groups/client.ts
'use client'

// Client-safe entry point for groups module
// Re-exports types, constants, and pure functions that don't require database access

// Group enums from @auxx/database/enums (already client-safe)
export {
  GroupVisibility,
  GroupVisibilityValues,
  MemberType,
  MemberTypeValues,
  ResourceGranteeType,
  ResourceGranteeTypeValues,
  ResourcePermission,
  ResourcePermissionValues,
} from '@auxx/database/enums'
// Types from @auxx/types/groups
export type {
  AddMembersInput,
  AddMembersResult,
  CreateGroupInput,
  GrantPermissionInput,
  GroupMember,
  GroupMemberUser,
  GroupPermissionInfo,
} from '@auxx/types/groups'
// Pure functions and constants from @auxx/types/groups
export { PERMISSION_HIERARCHY, satisfiesPermission } from '@auxx/types/groups'
