// apps/web/src/components/workflow/nodes/core/if-else/adapters/condition-adapter.tsx

import { useCallback, useMemo, useRef } from 'react'
import { generateId } from '@auxx/lib/utils'
import type {
  ConditionGroup,
  ConditionSystemConfig,
  GenericCondition,
} from '~/components/workflow/ui/conditions/types'
import type { IfElseCase, IfElseCondition, IfElseNodeData } from '../types'

interface UseIfElseConditionAdapterProps {
  nodeId: string
  data: IfElseNodeData
  setInputs: (data: IfElseNodeData) => void
  readOnly: boolean
}

/**
 * Adapter that transforms if-else cases to condition groups
 * Maps between legacy if-else format and modern provider format
 */
export const useIfElseConditionAdapter = ({
  nodeId,
  data,
  setInputs,
  readOnly,
}: UseIfElseConditionAdapterProps) => {
  // Transform if-else cases to condition groups
  const groups = useMemo((): ConditionGroup[] => {
    const totalCases = data.cases.length
    return data.cases.map((ifElseCase, index) => {
      return {
        id: ifElseCase.id,
        conditions: ifElseCase.conditions.map(
          (condition): GenericCondition => ({
            id: condition.id,
            fieldId: condition.variableId || '',
            operator: condition.comparison_operator || 'is',
            value: condition.value || '',
            variableId: condition.variableId,
            key: condition.key,
            numberVarType: condition.varType === 'number' ? 'number' : 'string',
            logicalOperator: condition.logical_operator === 'or' ? 'OR' : 'AND',
          })
        ),
        logicalOperator: ifElseCase.logical_operator === 'or' ? 'OR' : 'AND',
        order: index,
        metadata: {
          name: index === 0 ? 'IF' : 'ELIF',
          case_id: ifElseCase.case_id,
          subtext: totalCases === 1 ? '' : `CASE ${index + 1}`,
        },
      }
    })
  }, [data.cases, data._targetBranches])

  // Use refs to create stable callbacks that don't change reference
  // This prevents unnecessary re-renders of ConditionProvider consumers
  const dataRef = useRef(data)
  dataRef.current = data

  const groupsRef = useRef(groups)
  groupsRef.current = groups

  // Transform condition groups back to if-else cases
  // Stable callback - uses ref to access current data
  const onGroupsChange = useCallback(
    (updatedGroups: ConditionGroup[]) => {
      const currentData = dataRef.current
      const updatedCases: IfElseCase[] = updatedGroups.map((group, index) => {
        const originalCase = currentData.cases.find((c) => c.id === group.id)

        return {
          id: group.id,
          case_id: group.metadata?.case_id || originalCase?.case_id || `case_${index}`,
          logical_operator: group.logicalOperator.toLowerCase() as 'and' | 'or',
          conditions: group.conditions.map(
            (condition): IfElseCondition => ({
              id: condition.id,
              variableId: condition.fieldId,
              comparison_operator: condition.operator as any,
              value: condition.value,
              key: condition.key,
              varType: condition.numberVarType === 'number' ? 'number' : undefined,
              logical_operator: condition.logicalOperator?.toLowerCase() as
                | 'and'
                | 'or'
                | undefined,
            })
          ),
        }
      })

      // Update _targetBranches with case names
      const updatedTargetBranches = [
        ...updatedGroups.map((group) => ({
          id: group.metadata?.case_id || '',
          name: group.metadata?.name || '',
          type: 'default',
        })),
        { id: 'false', name: 'Else' },
      ]

      setInputs({
        ...currentData,
        cases: updatedCases,
        _targetBranches: updatedTargetBranches,
      })
    },
    [setInputs]
  )

  // Callback to handle group name changes
  // Stable callback - uses ref to access current groups
  const handleGroupNameChange = useCallback(
    (groupId: string, name: string) => {
      // Find the current groups and update the specific group's name
      const updatedGroups = groupsRef.current.map((g) =>
        g.id === groupId ? { ...g, metadata: { ...g.metadata, name } } : g
      )
      onGroupsChange(updatedGroups)
    },
    [onGroupsChange]
  )

  // Configuration for if-else condition system
  const config: ConditionSystemConfig = useMemo(
    () => ({
      mode: 'variable' as const,
      fields: 'dynamic',

      // Features
      showLogicalOperators: true,
      showGrouping: true,
      allowGroupNaming: false,
      allowGroupCollapse: true,
      allowGroupReordering: true,
      showGroupSubtext: true,

      // Defaults
      defaultGroupName: 'When',
      groupNamePlaceholder: 'Name this case...',
      addGroupButtonText: 'Add Case',

      // VarEditor
      allowVarEditor: true,
      allowConstantToggle: true,

      // State
      readOnly,

      // Callbacks - sync case names to _targetBranches
      onGroupNameChange: handleGroupNameChange,
    }),
    [readOnly, handleGroupNameChange]
  )

  return { groups, onGroupsChange, config, nodeId }
}
