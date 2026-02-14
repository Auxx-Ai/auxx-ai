// apps/web/src/components/workflow/store/test-input-store.ts

import { create } from 'zustand'
import { persist, subscribeWithSelector } from 'zustand/middleware'
import type { BaseType } from '../types/unified-types'
import { useWorkflowStore } from './workflow-store'

/**
 * Represents a test input value with metadata
 */
export interface TestInputValue {
  variableId: string
  value: any
  nodeId?: string // The node that defines this variable
  type: BaseType
  lastUpdated: number
}

/**
 * Store interface for managing test inputs
 */
interface TestInputStore {
  // Map of workflowId -> Map of variableId -> TestInputValue
  testInputs: Map<string, Map<string, TestInputValue>>

  // Actions
  setTestInput: (workflowId: string, variableId: string, value: TestInputValue) => void
  getTestInput: (workflowId: string, variableId: string) => TestInputValue | undefined
  getTestInputsForNode: (
    workflowId: string,
    nodeId: string,
    variableIds: string[]
  ) => Record<string, any>
  clearTestInputsForWorkflow: (workflowId: string) => void

  // Database sync
  loadFromWorkflow: (workflow: { id: string; variables?: any }) => void
  getVariablesForSave: (workflowId: string) => TestInputValue[]

  // Sync with workflow store
  syncWithWorkflow: () => void
}

/**
 * Store for managing test inputs with persistence
 */
export const useTestInputStore = create<TestInputStore>()(
  persist(
    subscribeWithSelector((set, get) => ({
      testInputs: new Map(),

      /**
       * Set a test input value
       */
      setTestInput: (workflowId, variableId, value) => {
        set((state) => {
          const newInputs = new Map(state.testInputs)
          const workflowInputs = newInputs.get(workflowId) || new Map()
          workflowInputs.set(variableId, value)
          newInputs.set(workflowId, workflowInputs)
          return { testInputs: newInputs }
        })

        // Mark workflow as dirty when test inputs change
        const markDirty = useWorkflowStore.getState().markDirty
        markDirty()
      },

      /**
       * Get a specific test input value
       */
      getTestInput: (workflowId, variableId) => {
        const workflowInputs = get().testInputs.get(workflowId)
        return workflowInputs?.get(variableId)
      },

      /**
       * Get test inputs for a specific node
       */
      getTestInputsForNode: (workflowId, nodeId, variableIds) => {
        const workflowInputs = get().testInputs.get(workflowId)
        if (!workflowInputs) return {}

        const result: Record<string, any> = {}
        variableIds.forEach((variableId) => {
          const input = workflowInputs.get(variableId)
          if (input) {
            result[variableId] = input.value
          }
        })

        return result
      },

      /**
       * Clear all test inputs for a workflow
       */
      clearTestInputsForWorkflow: (workflowId) => {
        set((state) => {
          const newInputs = new Map(state.testInputs)
          newInputs.delete(workflowId)
          return { testInputs: newInputs }
        })
      },

      /**
       * Load test inputs from workflow variables
       */
      loadFromWorkflow: (workflow) => {
        if (!workflow.variables) return

        const variablesMap = new Map<string, TestInputValue>()

        // Handle array format (new standard)
        if (Array.isArray(workflow.variables)) {
          workflow.variables.forEach((variable: any) => {
            if (variable?.variableId) {
              variablesMap.set(variable.variableId, variable)
            }
          })
        } else if (typeof workflow.variables === 'object') {
          // Legacy object format for backward compatibility
          Object.entries(workflow.variables).forEach(([key, value]) => {
            if (typeof value === 'object' && value !== null && 'value' in value) {
              variablesMap.set(key, value as TestInputValue)
            }
          })
        }

        set((state) => {
          const newInputs = new Map(state.testInputs)
          newInputs.set(workflow.id, variablesMap)
          return { testInputs: newInputs }
        })
      },

      /**
       * Get variables for saving with workflow (as array)
       */
      getVariablesForSave: (workflowId) => {
        const inputs = get().testInputs.get(workflowId)
        if (!inputs) return []

        const variables: TestInputValue[] = []
        inputs.forEach((value) => {
          variables.push(value)
        })

        return variables
      },

      /**
       * Sync with workflow store
       */
      syncWithWorkflow: () => {
        const workflow = useWorkflowStore.getState().workflow
        if (workflow?.id && workflow.variables) {
          get().loadFromWorkflow(workflow)
        }
      },
    })),
    {
      name: 'test-input-store',
      // Custom serialization to handle Map objects
      storage: {
        getItem: (name) => {
          const str = localStorage.getItem(name)
          if (!str) return null

          const { state } = JSON.parse(str)
          // Reconstruct nested Maps: Map<workflowId, Map<variableId, TestInputValue>>
          const testInputs = new Map(
            state.testInputs.map(([workflowId, inputs]: [string, any[]]) => [
              workflowId,
              new Map(inputs),
            ])
          )
          return {
            state: {
              ...state,
              testInputs,
            },
          }
        },
        setItem: (name, value) => {
          const { state } = value as { state: TestInputStore }
          const serialized = {
            state: {
              ...state,
              testInputs: Array.from(state.testInputs.entries()).map(([workflowId, inputs]) => [
                workflowId,
                Array.from(inputs.entries()),
              ]),
            },
          }
          localStorage.setItem(name, JSON.stringify(serialized))
        },
        removeItem: (name) => localStorage.removeItem(name),
      },
    }
  )
)

/**
 * Hook to automatically sync test inputs with workflow store
 */
export function useTestInputSync() {
  // Subscribe to workflow changes and sync test inputs
  useWorkflowStore.subscribe(
    (state) => state.workflow,
    (workflow) => {
      if (workflow?.id) {
        useTestInputStore.getState().syncWithWorkflow()
      }
    }
  )
}
