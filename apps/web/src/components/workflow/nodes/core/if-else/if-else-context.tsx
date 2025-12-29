// apps/web/src/components/workflow/nodes/if-else/if-else-context.tsx

'use client'

import React, { createContext, useContext, useCallback, useMemo } from 'react'
import { produce } from 'immer'
import { generateId, generateCaseId, generateConditionId } from '../../../utils'
import { getOperatorsForType } from '@auxx/lib/workflow-engine/client'
import type { IfElseCase, IfElseCondition, IfElseNodeData, UnifiedVariable } from './types'
import { branchNameCorrect } from '~/components/workflow/utils/branch-name-correct'
import { useUpdateNodeInternals } from '@xyflow/react'

interface IfElseContextType {
  // State
  data: IfElseNodeData
  nodeId: string
  readOnly: boolean

  // Case management
  addCase: () => void
  removeCase: (caseId: string) => void
  sortCases: (sortedCases: IfElseCase[]) => void

  // Condition management
  addCondition: (caseId: string, variable: UnifiedVariable) => void
  removeCondition: (caseId: string, conditionId: string) => void
  updateCondition: (caseId: string, conditionId: string, updates: Partial<IfElseCondition>) => void
  toggleConditionLogicalOperator: (caseId: string) => void

  // Available data
  // availableVariables: UnifiedVariable[]
  // variableGroups: VariableGroup[]
  // upstreamNodeIds: Set<string>

  // Filter functions
  // filterVar: (variable: UnifiedVariable) => boolean
  // filterNumberVar: (variable: UnifiedVariable) => boolean
}

const IfElseContext = createContext<IfElseContextType | null>(null)

interface IfElseProviderProps {
  children: React.ReactNode
  nodeId: string
  data: IfElseNodeData
  setInputs: (data: IfElseNodeData) => void
  readOnly?: boolean
}

export const IfElseProvider: React.FC<IfElseProviderProps> = ({
  children,
  nodeId,
  data,
  setInputs,
  readOnly = false,
}) => {
  const updateNodeInternals = useUpdateNodeInternals()

  // Case management
  const addCase = useCallback(() => {
    const newConfig = produce(data, (draft) => {
      const case_id = generateCaseId()
      const newCase: IfElseCase = {
        id: generateId(),
        case_id,
        logical_operator: 'and',
        conditions: [],
      }

      draft.cases.push(newCase)

      if (draft._targetBranches) {
        const elseCaseIndex = draft._targetBranches.findIndex((branch) => branch.id === 'false')
        if (elseCaseIndex > -1) {
          draft._targetBranches = branchNameCorrect([
            ...draft._targetBranches.slice(0, elseCaseIndex),
            { id: case_id, name: '' },
            ...draft._targetBranches.slice(elseCaseIndex),
          ])
        }
      }
    })

    setInputs(newConfig)
    updateNodeInternals(nodeId) // Ensure React Flow updates the node
  }, [data, setInputs])

  const removeCase = useCallback(
    (caseId: string) => {
      const newConfig = produce(data, (draft) => {
        draft.cases = draft.cases.filter((c) => c.case_id !== caseId)

        if (draft._targetBranches) {
          draft._targetBranches = branchNameCorrect(
            draft._targetBranches.filter((branch) => branch.id !== caseId)
          )
        }
      })

      setInputs(newConfig)
      updateNodeInternals(nodeId) // Ensure React Flow updates the node
    },
    [data, setInputs]
  )

  const sortCases = useCallback(
    (sortedCases: IfElseCase[]) => {
      const newConfig = produce(data, (draft) => {
        draft.cases = sortedCases
        draft._targetBranches = branchNameCorrect([
          ...sortedCases.filter(Boolean).map((item) => ({ id: item.case_id, name: '' })),
          { id: 'false', name: '' },
        ])
      })

      setInputs(newConfig)
      updateNodeInternals(nodeId) // Ensure React Flow updates the node
    },
    [data, setInputs]
  )

  // Condition management
  const addCondition = useCallback(
    (caseId: string, variable: UnifiedVariable) => {
      const newConfig = produce(data, (draft) => {
        const caseItem = draft.cases.find((c) => c.case_id === caseId)
        if (caseItem) {
          const newCondition: IfElseCondition = {
            id: generateConditionId(),
            variableId: variable.id,
            comparison_operator: (getOperatorsForType(variable.type)[0] || 'is') as any,
            value: '',
          }
          caseItem.conditions.push(newCondition)
        }
      })

      setInputs(newConfig)
    },
    [data, setInputs]
  )

  const removeCondition = useCallback(
    (caseId: string, conditionId: string) => {
      const newConfig = produce(data, (draft) => {
        const caseItem = draft.cases.find((c) => c.case_id === caseId)
        if (caseItem) {
          caseItem.conditions = caseItem.conditions.filter((c) => c.id !== conditionId)
        }
      })
      setInputs(newConfig)
    },
    [data, setInputs]
  )

  const updateCondition = useCallback(
    (caseId: string, conditionId: string, updates: Partial<IfElseCondition>) => {
      const newConfig = produce(data, (draft) => {
        const caseItem = draft.cases.find((c) => c.case_id === caseId)
        if (caseItem) {
          const condition = caseItem.conditions.find((c) => c.id === conditionId)
          if (condition) {
            Object.assign(condition, updates)
          }
        }
      })
      setInputs(newConfig)
    },
    [data, setInputs]
  )

  const toggleConditionLogicalOperator = useCallback(
    (caseId: string) => {
      const newConfig = produce(data, (draft) => {
        const caseItem = draft.cases.find((c) => c.case_id === caseId)
        if (caseItem) {
          caseItem.logical_operator = caseItem.logical_operator === 'and' ? 'or' : 'and'
        }
      })
      setInputs(newConfig)
    },
    [data, setInputs]
  )

  const contextValue = useMemo(
    (): IfElseContextType => ({
      data,
      nodeId,
      readOnly,
      addCase,
      removeCase,
      sortCases,
      addCondition,
      removeCondition,
      updateCondition,
      toggleConditionLogicalOperator,
      // availableVariables: variables,
      // variableGroups: groups,
      // upstreamNodeIds,
      // filterVar,
      // filterNumberVar,
    }),
    [
      data,
      nodeId,
      readOnly,
      addCase,
      removeCase,
      sortCases,
      addCondition,
      removeCondition,
      updateCondition,
      toggleConditionLogicalOperator,
    ]
  )

  return <IfElseContext.Provider value={contextValue}>{children}</IfElseContext.Provider>
}

export const useIfElseActions = () => {
  const context = useContext(IfElseContext)
  if (!context) {
    throw new Error('useIfElseActions must be used within IfElseProvider')
  }
  return context
}
