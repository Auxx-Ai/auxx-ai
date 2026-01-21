// apps/web/src/components/groups/store/groups-store.ts
'use client'

import { create } from 'zustand'
import type { EntityInstanceEntity } from '@auxx/database'
import type { GroupMember, GroupPermissionInfo } from '@auxx/types/groups'

/** Groups store state interface */
interface GroupsStoreState {
  /** Groups cache by ID */
  groups: Map<string, EntityInstanceEntity>
  /** List of all groups */
  groupsList: EntityInstanceEntity[]
  /** Whether groups are loading */
  isLoadingGroups: boolean

  /** Members cache by groupId */
  members: Map<string, GroupMember[]>
  /** Loading state for members by groupId */
  isLoadingMembers: Map<string, boolean>

  /** Permissions cache by groupId */
  permissions: Map<string, GroupPermissionInfo[]>

  /** Set all groups */
  setGroups: (groups: EntityInstanceEntity[]) => void
  /** Set a single group */
  setGroup: (group: EntityInstanceEntity) => void
  /** Remove a group */
  removeGroup: (groupId: string) => void
  /** Set members for a group */
  setMembers: (groupId: string, members: GroupMember[]) => void
  /** Set permissions for a group */
  setPermissions: (groupId: string, permissions: GroupPermissionInfo[]) => void
  /** Clear all cached data */
  clear: () => void
}

/** Zustand store for groups state management */
export const useGroupsStore = create<GroupsStoreState>((set) => ({
  groups: new Map(),
  groupsList: [],
  isLoadingGroups: false,
  members: new Map(),
  isLoadingMembers: new Map(),
  permissions: new Map(),

  setGroups: (groups) =>
    set({
      groupsList: groups,
      groups: new Map(groups.map((g) => [g.id, g])),
    }),

  setGroup: (group) =>
    set((state) => {
      const newGroups = new Map(state.groups)
      newGroups.set(group.id, group)
      const existingIndex = state.groupsList.findIndex((g) => g.id === group.id)
      const newList =
        existingIndex >= 0
          ? state.groupsList.map((g) => (g.id === group.id ? group : g))
          : [...state.groupsList, group]
      return { groups: newGroups, groupsList: newList }
    }),

  removeGroup: (groupId) =>
    set((state) => {
      const newGroups = new Map(state.groups)
      newGroups.delete(groupId)
      return {
        groups: newGroups,
        groupsList: state.groupsList.filter((g) => g.id !== groupId),
      }
    }),

  setMembers: (groupId, members) =>
    set((state) => {
      const newMembers = new Map(state.members)
      newMembers.set(groupId, members)
      return { members: newMembers }
    }),

  setPermissions: (groupId, permissions) =>
    set((state) => {
      const newPermissions = new Map(state.permissions)
      newPermissions.set(groupId, permissions)
      return { permissions: newPermissions }
    }),

  clear: () =>
    set({
      groups: new Map(),
      groupsList: [],
      members: new Map(),
      permissions: new Map(),
    }),
}))

/** Get store state outside of React components */
export const getGroupsStoreState = () => useGroupsStore.getState()
