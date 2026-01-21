// apps/web/src/components/groups/hooks/use-group-mutations.ts
'use client'

import { api } from '~/trpc/react'
import { useGroupsStore } from '../store'

/**
 * Hook that provides all group mutation operations
 * Handles cache invalidation and store updates
 */
export function useGroupMutations() {
  const utils = api.useUtils()
  const removeGroup = useGroupsStore((s) => s.removeGroup)

  /** Create a new group */
  const create = api.entityGroup.create.useMutation({
    onSuccess: () => {
      utils.entityGroup.list.invalidate()
    },
  })

  /** Delete a group */
  const deleteGroup = api.entityGroup.delete.useMutation({
    onSuccess: (_, { groupId }) => {
      removeGroup(groupId)
      utils.entityGroup.list.invalidate()
    },
  })

  /** Add members to a group */
  const addMembers = api.entityGroup.addMembers.useMutation({
    onSuccess: (_, { groupId }) => {
      utils.entityGroup.members.invalidate({ groupId })
      utils.entityGroup.list.invalidate()
    },
  })

  /** Remove members from a group */
  const removeMembers = api.entityGroup.removeMembers.useMutation({
    onSuccess: (_, { groupId }) => {
      utils.entityGroup.members.invalidate({ groupId })
      utils.entityGroup.list.invalidate()
    },
  })

  /** Grant permission on a group */
  const grantPermission = api.entityGroup.grantPermission.useMutation({
    onSuccess: (_, { groupId }) => {
      utils.entityGroup.permissions.invalidate({ groupId })
    },
  })

  /** Revoke permission on a group */
  const revokePermission = api.entityGroup.revokePermission.useMutation({
    onSuccess: (_, { groupId }) => {
      utils.entityGroup.permissions.invalidate({ groupId })
    },
  })

  return {
    create,
    deleteGroup,
    addMembers,
    removeMembers,
    grantPermission,
    revokePermission,
  }
}
