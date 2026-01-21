// apps/web/src/components/groups/index.ts

// Provider
export { GroupsProvider, useGroupsContext } from './providers'

// Hooks
export {
  useGroups,
  useGroup,
  useGroupMembers,
  useGroupPermissions,
  useMyGroupPermission,
  useGroupsForEntity,
  useGroupsForUser,
  useGroupMutations,
} from './hooks'

// Store utilities
export { useGroupsStore, getGroupsStoreState } from './store'

// Utilities
export {
  canViewGroup,
  canEditGroup,
  canManageMembers,
  canAdminGroup,
  getGroupMetadata,
  formatMemberType,
  getMemberDisplayInfo,
  getInitials,
  type GroupMetadata,
} from './utils'

// UI Components
export {
  GroupItem,
  GroupsList,
  GroupBadge,
  GroupDetailDialog,
  MemberList,
  UserMemberList,
  EntityMemberList,
  PermissionsPanel,
  GroupPicker,
  FormGroupPicker,
  type GroupOption,
} from './ui'
