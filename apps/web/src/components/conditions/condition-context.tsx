// apps/web/src/components/conditions/condition-context.tsx

'use client'

import { getOperatorsForBaseType } from '@auxx/lib/conditions/client'
import { produce } from 'immer'
import type React from 'react'
import { createContext, useCallback, useContext, useMemo } from 'react'
import { v4 as generateId } from 'uuid'
import type {
  Condition,
  ConditionContextValue,
  ConditionGroup,
  ConditionGroupMetadata,
  ConditionSystemConfig,
  FieldDefinition,
  OperatorDefinition,
} from './types'
import { getOperatorDefinition, getOperatorsForFieldType } from './types'

const ConditionContext = createContext<ConditionContextValue | null>(null)

/**
 * Props for the condition provider
 */
interface ConditionProviderProps {
  children: React.ReactNode
  conditions: Condition[]
  groups?: ConditionGroup[]
  config: ConditionSystemConfig
  onConditionsChange: (conditions: Condition[]) => void
  onGroupsChange?: (groups: ConditionGroup[]) => void
  nodeId?: string
  readOnly?: boolean
  getAvailableFields?: () => FieldDefinition[]
  getFieldDefinition?: (fieldId: string) => FieldDefinition | undefined
}

/**
 * Generic condition provider that can be used by any node type
 */
export const ConditionProvider: React.FC<ConditionProviderProps> = ({
  children,
  conditions,
  groups = [],
  config,
  onConditionsChange,
  onGroupsChange,
  nodeId,
  readOnly = false,
  getAvailableFields,
  getFieldDefinition,
}) => {
  // Field resolution functions
  const resolveAvailableFields = useCallback((): FieldDefinition[] => {
    if (getAvailableFields) {
      return getAvailableFields()
    }

    if (Array.isArray(config.fields)) {
      return config.fields
    }

    return []
  }, [config.fields, getAvailableFields])

  const resolveFieldDefinition = useCallback(
    (fieldId: string): FieldDefinition | undefined => {
      if (getFieldDefinition) {
        return getFieldDefinition(fieldId)
      }

      const availableFields = resolveAvailableFields()
      return availableFields.find((field) => field.id === fieldId)
    },
    [getFieldDefinition, resolveAvailableFields]
  )

  // Core condition operations
  const addCondition = useCallback(
    (fieldId: string, groupId?: string) => {
      const fieldDef = resolveFieldDefinition(fieldId)

      if (!fieldDef) {
        return
      }

      // Use fieldType to get operators (fieldType is now required)
      const availableOperators = getOperatorsForFieldType(fieldDef.fieldType ?? fieldDef.type)
      const defaultOperator = availableOperators[0]?.key || 'equals'

      const newCondition: Condition = {
        id: generateId(),
        fieldId,
        operator: defaultOperator,
        value: '',
        isConstant: true,
        variableId: config.mode === 'variable' ? fieldId : undefined,
      }

      if (groupId && onGroupsChange) {
        const updatedGroups = produce(groups, (draft) => {
          const group = draft.find((g) => g.id === groupId)
          if (group) {
            if (group.conditions.length > 0) {
              newCondition.logicalOperator = group.logicalOperator || 'AND'
            }
            group.conditions.push(newCondition)
          }
        })
        onGroupsChange(updatedGroups)
      } else {
        const updatedConditions = produce(conditions, (draft) => {
          if (draft.length > 0) {
            newCondition.logicalOperator = 'AND'
          }
          draft.push(newCondition)
        })
        onConditionsChange(updatedConditions)
      }
    },
    [conditions, groups, config.mode, onConditionsChange, onGroupsChange, resolveFieldDefinition]
  )

  const updateCondition = useCallback(
    (id: string, updates: Partial<Condition>, groupId?: string) => {
      if (groupId && onGroupsChange) {
        const updatedGroups = produce(groups, (draft) => {
          const group = draft.find((g) => g.id === groupId)
          if (group) {
            const condition = group.conditions.find((c) => c.id === id)
            if (condition) {
              Object.assign(condition, updates)

              if (updates.fieldId && config.mode === 'variable') {
                condition.variableId = updates.fieldId
              }
            }
          }
        })
        onGroupsChange(updatedGroups)
      } else {
        const updatedConditions = produce(conditions, (draft) => {
          const condition = draft.find((c) => c.id === id)
          if (condition) {
            Object.assign(condition, updates)

            if (updates.fieldId && config.mode === 'variable') {
              condition.variableId = updates.fieldId
            }
          }
        })
        onConditionsChange(updatedConditions)
      }
    },
    [conditions, groups, config.mode, onConditionsChange, onGroupsChange]
  )

  const removeCondition = useCallback(
    (id: string, groupId?: string) => {
      if (groupId && onGroupsChange) {
        const updatedGroups = produce(groups, (draft) => {
          const group = draft.find((g) => g.id === groupId)
          if (group) {
            group.conditions = group.conditions.filter((c) => c.id !== id)

            if (group.conditions.length > 0) {
              group.conditions[0]!.logicalOperator = undefined
            }
          }
        })
        onGroupsChange(updatedGroups)
      } else {
        const updatedConditions = produce(conditions, (draft) => {
          const index = draft.findIndex((c) => c.id === id)
          if (index !== -1) {
            draft.splice(index, 1)
          }

          if (draft.length > 0 && draft[0]) {
            draft[0].logicalOperator = undefined
          }
        })
        onConditionsChange(updatedConditions)
      }
    },
    [conditions, groups, onConditionsChange, onGroupsChange]
  )

  // Group operations
  const addGroup = useCallback(() => {
    if (!onGroupsChange) return

    const newGroup: ConditionGroup = {
      id: generateId(),
      conditions: [],
      logicalOperator: groups.length > 0 ? 'AND' : 'OR',
    }

    const updatedGroups = [...groups, newGroup]
    onGroupsChange(updatedGroups)
  }, [groups, onGroupsChange])

  const removeGroup = useCallback(
    (groupId: string) => {
      if (!onGroupsChange) return

      const filteredGroups = groups.filter((g) => g.id !== groupId)
      onGroupsChange(filteredGroups)
    },
    [groups, onGroupsChange]
  )

  const updateGroup = useCallback(
    (groupId: string, updates: Partial<ConditionGroup>) => {
      if (!onGroupsChange) return

      const updatedGroups = produce(groups, (draft) => {
        const group = draft.find((g) => g.id === groupId)
        if (group) {
          Object.assign(group, updates)
        }
      })
      onGroupsChange(updatedGroups)
    },
    [groups, onGroupsChange]
  )

  const toggleGroupLogicalOperator = useCallback(
    (groupId: string) => {
      if (!onGroupsChange) return

      const updatedGroups = produce(groups, (draft) => {
        const group = draft.find((g) => g.id === groupId)
        if (group) {
          group.logicalOperator = group.logicalOperator === 'AND' ? 'OR' : 'AND'

          group.conditions.forEach((condition, index) => {
            if (index > 0) {
              condition.logicalOperator = group.logicalOperator
            }
          })
        }
      })
      onGroupsChange(updatedGroups)
    },
    [groups, onGroupsChange]
  )

  // Enhanced group metadata operations
  const updateGroupMetadata = useCallback(
    (groupId: string, metadata: Partial<ConditionGroupMetadata>) => {
      if (!onGroupsChange) return

      const updatedGroups = produce(groups, (draft) => {
        const group = draft.find((g) => g.id === groupId)
        if (group) {
          group.metadata = {
            ...group.metadata,
            ...metadata,
          }
        }
      })

      onGroupsChange(updatedGroups)

      if (metadata.name !== undefined && config.onGroupNameChange) {
        config.onGroupNameChange(groupId, metadata.name)
      }
    },
    [groups, onGroupsChange, config]
  )

  const toggleGroupCollapse = useCallback(
    (groupId: string) => {
      if (!onGroupsChange) return

      const updatedGroups = produce(groups, (draft) => {
        const group = draft.find((g) => g.id === groupId)
        if (group) {
          const newCollapsed = !group.metadata?.collapsed
          if (!group.metadata) {
            group.metadata = {}
          }
          group.metadata.collapsed = newCollapsed

          if (config.onGroupCollapse) {
            config.onGroupCollapse(groupId, newCollapsed)
          }
        }
      })

      onGroupsChange(updatedGroups)
    },
    [groups, onGroupsChange, config]
  )

  const reorderGroups = useCallback(
    (groupIds: string[]) => {
      if (!onGroupsChange) return

      const reorderedGroups = groupIds
        .map((id) => groups.find((g) => g.id === id))
        .filter((g): g is ConditionGroup => g !== undefined)
        .map((group, index) => ({
          ...group,
          order: index,
        }))

      onGroupsChange(reorderedGroups)

      if (config.onGroupReorder) {
        config.onGroupReorder(groupIds)
      }
    },
    [groups, onGroupsChange, config]
  )

  const renumberGroups = useCallback(
    (groupList: ConditionGroup[]): ConditionGroup[] => {
      const defaultName = config.defaultGroupName || 'Group'
      const totalGroups = groupList.length

      return groupList.map((group, index) => ({
        ...group,
        metadata: {
          ...group.metadata,
          name: totalGroups === 1 ? defaultName : `${defaultName} ${index + 1}`,
        },
      }))
    },
    [config]
  )

  const addGroupEnhanced = useCallback(
    (metadata?: Partial<ConditionGroupMetadata>) => {
      if (!onGroupsChange) return

      const defaultName = config.defaultGroupName || 'Group'
      const newGroupCount = groups.length + 1

      const newGroup: ConditionGroup = {
        id: generateId(),
        conditions: [],
        logicalOperator: groups.length > 0 ? 'AND' : 'OR',
        order: groups.length,
        metadata: {
          name:
            metadata?.name || (newGroupCount > 1 ? `${defaultName} ${newGroupCount}` : defaultName),
          description: metadata?.description || '',
          subtext: metadata?.subtext || '',
          collapsed: metadata?.collapsed || false,
          ...metadata,
        },
      }

      const allGroups = [...groups, newGroup]
      const renumberedGroups = renumberGroups(allGroups)
      onGroupsChange(renumberedGroups)
    },
    [groups, onGroupsChange, config, renumberGroups]
  )

  // Operator resolution - derives operators from fieldType or baseType
  const getAvailableOperators = useCallback(
    (fieldId: string): OperatorDefinition[] => {
      const fieldDef = resolveFieldDefinition(fieldId)
      if (!fieldDef) return []

      // Use fieldType (UPPERCASE FieldType enum) for resource mode,
      // fall back to type (lowercase BaseType enum) for variable mode
      if (fieldDef.fieldType) {
        return getOperatorsForFieldType(fieldDef.fieldType)
      }
      return getOperatorsForBaseType(fieldDef.type)
    },
    [resolveFieldDefinition]
  )

  // Validation functions
  const validateCondition = useCallback(
    (condition: Condition): boolean => {
      if (config.validateCondition) {
        return config.validateCondition(condition)
      }

      if (!condition.fieldId || !condition.operator) {
        return false
      }

      const operatorDef = getOperatorDefinition(condition.operator)
      if (operatorDef?.requiresValue) {
        return condition.value !== '' && condition.value !== null && condition.value !== undefined
      }

      return true
    },
    [config]
  )

  const validateAllConditions = useCallback((): boolean => {
    const flatConditionsValid = conditions.every(validateCondition)

    const groupedConditionsValid = groups.every((group) =>
      group.conditions.every(validateCondition)
    )

    return flatConditionsValid && groupedConditionsValid
  }, [conditions, groups, validateCondition])

  const validateGroup = useCallback(
    (group: ConditionGroup): boolean => {
      if (config.validateGroup) {
        return config.validateGroup(group)
      }

      if (group.conditions.length === 0) {
        return false
      }

      return group.conditions.every(validateCondition)
    },
    [config, validateCondition]
  )

  // Context value
  const contextValue = useMemo(
    (): ConditionContextValue => ({
      conditions,
      groups,
      config,
      readOnly,
      nodeId,
      addCondition,
      updateCondition,
      removeCondition,
      addGroup: config.showGrouping ? addGroupEnhanced : undefined,
      removeGroup: config.showGrouping ? removeGroup : undefined,
      updateGroup: config.showGrouping ? updateGroup : undefined,
      toggleGroupLogicalOperator: config.showGrouping ? toggleGroupLogicalOperator : undefined,
      updateGroupMetadata:
        config.allowGroupNaming || config.allowGroupCollapse ? updateGroupMetadata : undefined,
      toggleGroupCollapse: config.allowGroupCollapse ? toggleGroupCollapse : undefined,
      reorderGroups: config.allowGroupReordering ? reorderGroups : undefined,
      validateGroup,
      getFieldDefinition: resolveFieldDefinition,
      getAvailableFields: resolveAvailableFields,
      getAvailableOperators,
      validateCondition,
      validateAllConditions,
    }),
    [
      conditions,
      groups,
      config,
      readOnly,
      nodeId,
      addCondition,
      updateCondition,
      removeCondition,
      addGroupEnhanced,
      removeGroup,
      updateGroup,
      toggleGroupLogicalOperator,
      updateGroupMetadata,
      toggleGroupCollapse,
      reorderGroups,
      validateGroup,
      resolveFieldDefinition,
      resolveAvailableFields,
      getAvailableOperators,
      validateCondition,
      validateAllConditions,
    ]
  )

  return <ConditionContext.Provider value={contextValue}>{children}</ConditionContext.Provider>
}

/**
 * Hook to use the condition context
 */
export const useConditionContext = (): ConditionContextValue => {
  const context = useContext(ConditionContext)
  if (!context) {
    throw new Error('useConditionContext must be used within ConditionProvider')
  }
  return context
}

/**
 * Hook to use condition actions only
 */
export const useConditionActions = () => {
  const context = useConditionContext()
  return {
    addCondition: context.addCondition,
    updateCondition: context.updateCondition,
    removeCondition: context.removeCondition,
    addGroup: context.addGroup,
    removeGroup: context.removeGroup,
    updateGroup: context.updateGroup,
    toggleGroupLogicalOperator: context.toggleGroupLogicalOperator,
  }
}

/**
 * Hook to use condition state only
 */
export const useConditionState = () => {
  const context = useConditionContext()
  return {
    conditions: context.conditions,
    groups: context.groups,
    config: context.config,
    readOnly: context.readOnly,
    nodeId: context.nodeId,
  }
}
