// apps/web/src/components/groups/index.ts

// Hooks
export {
  useGroup,
  useGroupMembers,
  useGroupMutations,
  useGroupPermissions,
  useGroups,
  useGroupsForEntity,
  useGroupsForUser,
  useMyGroupPermission,
} from './hooks'
// Provider
export { GroupsProvider, useGroupsContext } from './providers'

// Store utilities
export { getGroupsStoreState, useGroupsStore } from './store'
// UI Components
export {
  EntityMemberList,
  FormGroupPicker,
  GroupBadge,
  GroupCard,
  GroupDetailDialog,
  type GroupOption,
  GroupPicker,
  GroupsBulkBar,
  GroupsTab,
  MemberList,
  PermissionsPanel,
  UserMemberList,
} from './ui'
// Utilities
export {
  canAdminGroup,
  canEditGroup,
  canManageMembers,
  canViewGroup,
  formatMemberType,
  type GroupMetadata,
  getGroupMetadata,
  getInitials,
  getMemberDisplayInfo,
} from './utils'
