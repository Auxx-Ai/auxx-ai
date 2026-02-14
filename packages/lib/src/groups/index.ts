// packages/lib/src/groups/index.ts

// NOTE: Types are NOT exported from here.
// Import types directly from @auxx/types/groups

// Group CRUD functions
// Member functions
export {
  addMembers,
  createGroup,
  deleteGroup,
  getGroupsForEntity,
  getGroupsForUser,
  getMembers,
  listAccessibleGroups,
  removeMembers,
} from './group-functions'
// Permission management functions
export { getPermissions, grantPermission, revokePermission } from './permission-functions'
// Permission checking functions
export { getGroupPermission, hasGroupPermission, requireGroupPermission } from './permissions'
