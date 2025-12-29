// apps/web/src/components/workflow/nodes/core/find/hooks/use-find-groups.ts

import { useCallback } from 'react'
import { v4 as generateId } from 'uuid'
import type { ConditionGroup, GenericCondition } from '~/components/workflow/ui/conditions/types'
import type { FindNodeData } from '../types'

/**
 * Hook for managing condition groups in find nodes
 */
export const useFindGroups = (
  nodeData: FindNodeData,
  setNodeData: (data: FindNodeData) => void
) => {
  const handleGroupsChange = useCallback(
    (groups: ConditionGroup[]) => {
      // Renumber groups to keep naming consistent
      const totalGroups = groups.length
      const renumberedGroups = groups.map((group, index) => ({
        ...group,
        metadata: {
          ...group.metadata,
          name: totalGroups === 1 ? 'Group' : `Group ${index + 1}`,
        },
      }))

      setNodeData({ ...nodeData, conditionGroups: renumberedGroups })
    },
    [nodeData, setNodeData]
  )

  const addGroup = useCallback(() => {
    const currentGroups = nodeData.conditionGroups || []
    const newGroupCount = currentGroups.length + 1

    // Update existing groups to have numbered names if we're adding a second group
    const updatedExistingGroups = currentGroups.map((group, index) => ({
      ...group,
      metadata: {
        ...group.metadata,
        name: newGroupCount > 1 ? `Group ${index + 1}` : 'Group',
      },
    }))

    const newGroup: ConditionGroup = {
      id: generateId(),
      conditions: [],
      logicalOperator: 'AND', // Default to AND for query filtering
      metadata: {
        name: newGroupCount > 1 ? `Group ${newGroupCount}` : 'Group',
      },
    }

    const updatedGroups = [...updatedExistingGroups, newGroup]
    console.log('Adding group, updated groups:', updatedGroups.map(g => ({ id: g.id, name: g.metadata?.name })))
    setNodeData({ ...nodeData, conditionGroups: updatedGroups })
  }, [nodeData, setNodeData])

  const removeGroup = useCallback(
    (groupId: string) => {
      const updatedGroups = nodeData.conditionGroups?.filter((g) => g.id !== groupId) || []
      setNodeData({ ...nodeData, conditionGroups: updatedGroups })
    },
    [nodeData, setNodeData]
  )

  const updateGroup = useCallback(
    (groupId: string, updates: Partial<ConditionGroup>) => {
      const updatedGroups =
        nodeData.conditionGroups?.map((group) =>
          group.id === groupId ? { ...group, ...updates } : group
        ) || []
      setNodeData({ ...nodeData, conditionGroups: updatedGroups })
    },
    [nodeData, setNodeData]
  )

  const toggleGroupLogicalOperator = useCallback(
    (groupId: string) => {
      updateGroup(groupId, {
        logicalOperator:
          nodeData.conditionGroups?.find((g) => g.id === groupId)?.logicalOperator === 'AND'
            ? 'OR'
            : 'AND',
      })
    },
    [nodeData.conditionGroups, updateGroup]
  )

  const addConditionToGroup = useCallback(
    (groupId: string, fieldId: string) => {
      const group = nodeData.conditionGroups?.find((g) => g.id === groupId)
      if (!group) return

      const newCondition: GenericCondition = {
        id: generateId(),
        fieldId,
        operator: 'contains', // Default operator
        value: '',
        logicalOperator: group.conditions.length > 0 ? 'AND' : undefined,
      }

      const updatedConditions = [...group.conditions, newCondition]
      updateGroup(groupId, { conditions: updatedConditions })
    },
    [nodeData.conditionGroups, updateGroup]
  )

  const updateConditionInGroup = useCallback(
    (groupId: string, conditionId: string, updates: Partial<GenericCondition>) => {
      const group = nodeData.conditionGroups?.find((g) => g.id === groupId)
      if (!group) return

      const updatedConditions = group.conditions.map((condition) =>
        condition.id === conditionId ? { ...condition, ...updates } : condition
      )
      updateGroup(groupId, { conditions: updatedConditions })
    },
    [nodeData.conditionGroups, updateGroup]
  )

  const removeConditionFromGroup = useCallback(
    (groupId: string, conditionId: string) => {
      const group = nodeData.conditionGroups?.find((g) => g.id === groupId)
      if (!group) return

      const updatedConditions = group.conditions.filter((condition) => condition.id !== conditionId)

      // Clean up logical operators after removal
      if (updatedConditions.length > 0) {
        updatedConditions[0].logicalOperator = undefined
      }

      updateGroup(groupId, { conditions: updatedConditions })
    },
    [nodeData.conditionGroups, updateGroup]
  )

  return {
    handleGroupsChange,
    addGroup,
    removeGroup,
    updateGroup,
    toggleGroupLogicalOperator,
    addConditionToGroup,
    updateConditionInGroup,
    removeConditionFromGroup,
  }
}
