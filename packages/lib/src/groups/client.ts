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
// The one permission ordinal + comparator (plan v3/03 P3a §3)
export { PERMISSION_RANK, satisfiesPermission } from '@auxx/types/permissions'
