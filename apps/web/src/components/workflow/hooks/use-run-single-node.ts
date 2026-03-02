// apps/web/src/components/workflow/hooks/use-run-node.ts

import type { WorkflowNodeExecutionEntity as WorkflowNodeExecution } from '@auxx/database/types'
import { toastError } from '@auxx/ui/components/toast'
import { useStoreApi } from '@xyflow/react'
import { useCallback } from 'react'
import { api } from '~/trpc/react'
import { useSingleNodeRunStore } from '../store/single-node-run-store'
import { useTestInputStore } from '../store/test-input-store'
import { useVarStore } from '../store/use-var-store'
import { useWorkflowStore } from '../store/workflow-store'
import { type FlowNode, NodeRunningStatus } from '../types'
import { useWorkflowSave } from './use-workflow-save'
export interface LoopExecutionContext {
  iteration: number
  totalIterations?: number
  currentItem?: any
  iteratorName?: string
}
export interface RunNodeInput {
  nodeId: string
  data: FlowNode['data']
  inputs:
    | Record<string, any>
    | Array<{
        variableId: string
        value: any
        nodeId?: string
        type?: string
        lastUpdated?: number
      }>
  nodeDefinition?: any
  loopContext?: LoopExecutionContext
}
export function useRunSingleNode(nodeId?: string) {
  // Get workflow information from the store - subscribe to individual fields to avoid unnecessary re-renders
  const workflowAppId = useWorkflowStore((state) => state.workflowAppId)
  const workflowId = useWorkflowStore((state) => state.workflowId)

  const state = useStoreApi()
  // Get workflow save functionality
  const { save: saveWorkflow, isDirty, isSaving } = useWorkflowSave()
  // Get single node run store actions and state
  const { setNodeRunning, setNodeResult, clearNodeResult, getNodeResult } = useSingleNodeRunStore()
  // Get current node result if nodeId is provided
  const result = nodeId ? useSingleNodeRunStore((state) => state.nodeResults.get(nodeId)) : null
  const isRunning = nodeId
    ? useSingleNodeRunStore((state) => state.runningNodes.has(nodeId))
    : false

  const runNodeMutation = api.workflow.runSingleNode.useMutation({
    onSuccess: (executionResult: WorkflowNodeExecution, variables) => {
      const nodeId = variables.nodeId
      // Store the complete WorkflowNodeExecution directly without transformation
      setNodeResult(nodeId, executionResult)
    },
    onError: (error, variables) => {
      const nodeId = variables.nodeId
      setNodeResult(nodeId, {
        status: NodeRunningStatus.Failed as any,
        error: error.message,
        finishedAt: new Date(),
      })
      toastError({ title: 'Node execution failed', description: error.message })
    },
  })
  const runSingleNode = useCallback(
    async (params: RunNodeInput) => {
      const { nodeId, data, inputs, nodeDefinition, loopContext } = params
      console.log('Running single node:', workflowAppId, workflowId)

      // Validate we have the necessary workflow context
      if (!workflowAppId || !workflowId) {
        toastError({
          title: 'Missing workflow context',
          description: 'Please save the workflow before running individual nodes',
        })
        return
      }
      // Validate configuration if node definition provides validation
      if (nodeDefinition?.validator) {
        const validationResult = nodeDefinition.validator(data)
        if (validationResult && !validationResult.isValid) {
          const fieldErrors = validationResult.errors
            .filter((e: any) => e.type !== 'warning')
            .map((e: any) => e.message)
            .join(', ')
          toastError({
            title: 'Invalid configuration',
            description: fieldErrors || 'Please fix the node configuration before running',
          })
          return
        }
      }
      // Save workflow if there are unsaved changes
      if (isDirty && !isSaving) {
        try {
          // Save the workflow
          const saved = await saveWorkflow()
          console.log('Workflow saved before running node:', saved)
          if (!saved) {
            toastError({
              title: 'Failed to save workflow',
              description: 'Please save manually before running the node',
            })
            return
          }
          // Small delay to ensure save is processed
          await new Promise((resolve) => setTimeout(resolve, 500))
        } catch (error) {
          toastError({
            title: 'Failed to save workflow',
            description: 'Please save manually before running the node',
          })
          return
        }
      }
      // Prepare inputs with loop context if provided
      let finalInputs = inputs
      if (loopContext) {
        // Inject loop variables into inputs
        const loopVars: Record<string, any> = {
          'loop.index': loopContext.iteration,
          'loop.count': loopContext.iteration + 1,
          'loop.total': loopContext.totalIterations,
          'loop.item': loopContext.currentItem,
        }
        // Add iterator variable if specified
        if (loopContext.iteratorName && loopContext.currentItem !== undefined) {
          loopVars[loopContext.iteratorName] = loopContext.currentItem
        }
        // Merge with existing inputs
        if (Array.isArray(inputs)) {
          // Already in array format, merge with loop vars
          const loopVarArray = Object.entries(loopVars).map(([variableId, value]) => ({
            variableId,
            value,
            lastUpdated: Date.now(),
          }))
          finalInputs = [...inputs, ...loopVarArray]
        } else {
          // Convert object format to array for consistency
          finalInputs = { ...inputs, ...loopVars }
        }
      }
      // Set node as running in the store with inputs and set view mode to single-node
      setNodeRunning(nodeId, finalInputs, { nodeType: data.type, title: data.title })
      // Import the run store to set view mode
      const { useRunStore } = await import('../store/run-store')
      useRunStore.setState((state) => ({ runViewMode: 'single-node' as const }))
      // Convert inputs to array format if needed for API
      const apiInputs = Array.isArray(finalInputs)
        ? finalInputs
        : Object.entries(finalInputs).map(([variableId, value]) => ({
            variableId,
            value,
            lastUpdated: Date.now(),
          }))
      // Execute the node with correct IDs
      runNodeMutation.mutate({
        workflowAppId: workflowAppId,
        workflowId: workflowId,
        nodeId,
        inputs: apiInputs,
      })
    },
    [workflowAppId, workflowId, runNodeMutation, setNodeRunning, isDirty, isSaving, saveWorkflow]
  )
  const clearResult = useCallback(
    (nodeIdToClear?: string) => {
      if (nodeIdToClear) {
        clearNodeResult(nodeIdToClear)
      }
    },
    [clearNodeResult]
  )
  // Run a loop node
  const runLoopNode = useCallback(
    async (
      params: RunNodeInput & {
        data: any
      }
    ) => {
      const { nodeId, data: loopConfig, inputs } = params
      const { edges, nodes } = state.getState()
      // Import necessary utilities
      const { getLoopChildren } = await import('../utils/graph-utils')
      // Get the array from inputs based on itemsSource
      let items: any[] = []
      let totalIterations = 0
      const itemsSource = loopConfig.itemsSource
      if (itemsSource) {
        // Extract variable ID from the itemsSource (e.g., "{{customers}}" -> "customers")
        const variableId = itemsSource.replace(/^\{\{|\}\}$/g, '')
        // Check both direct inputs and variable paths
        const sourceValue = Array.isArray(inputs)
          ? inputs.find(
              (input) => input.variableId === variableId || input.variableId === itemsSource
            )?.value
          : (inputs as Record<string, any>)[variableId] ||
            (inputs as Record<string, any>)[itemsSource]
        if (sourceValue) {
          items = Array.isArray(sourceValue) ? sourceValue : []
        }
      }
      totalIterations = Math.min(items.length, loopConfig.maxIterations || 1000)
      // Find the first child node to execute
      const loopChildren = getLoopChildren(nodeId, nodes)
      const firstChild = loopChildren.find((child) => {
        // Find nodes that have incoming edges from loop-start handle
        const incomingEdges = edges.filter(
          (e) => e.target === child.id && e.sourceHandle === 'loop-start'
        )
        return incomingEdges.length > 0
      })
      if (!firstChild) {
        toastError({
          title: 'Loop configuration error',
          description: 'No nodes connected to loop start',
        })
        return
      }
      // Execute loop iterations
      const results: any[] = []
      // Set loop as running
      setNodeRunning(nodeId, inputs, { nodeType: 'loop', title: loopConfig.title })
      // Update loop progress in store
      const { setLoopProgress, clearLoopProgress } = useSingleNodeRunStore.getState()
      for (let i = 0; i < totalIterations; i++) {
        // Update loop progress
        setLoopProgress(nodeId, i, totalIterations)
        // Execute nodes inside the loop with loop context
        await runSingleNode({
          nodeId: firstChild.id,
          data: firstChild.data as any,
          inputs,
          loopContext: {
            iteration: i,
            totalIterations,
            currentItem: items[i],
            iteratorName: loopConfig.iteratorName || 'item',
          },
        })
        // Get the result
        const iterationResult = getNodeResult(firstChild.id)
        if (iterationResult?.outputs) {
          results.push(iterationResult.outputs)
        }
        // Check for break conditions if needed
        // TODO: Implement break condition evaluation
      }
      // Clear loop progress
      clearLoopProgress(nodeId)
      // Set final result
      setNodeResult(nodeId, {
        status: NodeRunningStatus.Succeeded as any,
        outputs: {
          totalIterations,
          completedIterations: totalIterations,
          results: loopConfig.accumulateResults ? results : undefined,
          lastResult: results[results.length - 1],
          result: !loopConfig.accumulateResults ? results[results.length - 1] : undefined,
        } as any,
        finishedAt: new Date(),
      })
    },
    [runSingleNode, setNodeRunning, setNodeResult, getNodeResult, state]
  )
  // Enhanced run function with defaults (moved from base-panel)
  const runWithDefaults = useCallback(
    async (data: any, nodeDefinition: any, onTabSwitch?: () => void) => {
      if (!nodeDefinition || !data) return
      // Extract variable IDs just before running
      const requiredVariableIds = nodeDefinition.extractVariables?.(data) || []
      // Get test input store
      const testInputStore = useTestInputStore.getState()
      const workflowState = useWorkflowStore.getState()
      const variableStore = useVarStore.getState()
      const getVariableById = variableStore.actions.getVariableById
      const workflowId = workflowState.workflow?.id
      // Get cached test inputs if available
      const cachedInputs = workflowId
        ? testInputStore.getTestInputsForNode(workflowId, nodeId!, requiredVariableIds)
        : {}
      // Transform to new input format, filtering out system and env variables
      const inputArray = requiredVariableIds
        .filter((variableId: string) => {
          const variable = getVariableById(variableId)
          // Skip system and environment variables as they are already known and set
          return variable?.category !== 'system' && variable?.category !== 'environment'
        })
        .map((variableId: string) => {
          const variable = getVariableById(variableId)
          const value = cachedInputs[variableId] ?? variable?.default
          return {
            variableId: variableId,
            value: value,
            nodeId: variable?.nodeId || nodeId!,
            type: variable?.type || 'string',
            lastUpdated: Date.now(),
          }
        })
      await runSingleNode({ nodeId: nodeId!, data, inputs: inputArray, nodeDefinition })
      // Call tab switch callback if provided (for backwards compatibility)
      if (onTabSwitch) {
        onTabSwitch()
      }
    },
    [nodeId, runSingleNode]
  )
  return { runSingleNode, runLoopNode, isRunning, result, clearResult, runWithDefaults }
}
