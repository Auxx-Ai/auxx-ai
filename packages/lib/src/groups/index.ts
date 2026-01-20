// packages/lib/src/groups/index.ts

// NOTE: Types are NOT exported from here.
// Import types directly from @auxx/types/groups

// Permission checking functions
export { getGroupPermission, hasGroupPermission, requireGroupPermission } from './permissions'

// Group CRUD functions
export { createGroup, deleteGroup, listAccessibleGroups } from './group-functions'

// Member functions
export { addMembers, removeMembers, getMembers, getGroupsForUser, getGroupsForEntity } from './group-functions'

// Permission management functions
export { grantPermission, revokePermission, getPermissions } from './permission-functions'
