// apps/web/src/components/workflow/store/single-node-run-store.ts

import type { WorkflowNodeExecutionEntity as WorkflowNodeExecution } from '@auxx/database/types'
import { create } from 'zustand'
import { subscribeWithSelector } from 'zustand/middleware'
import { NodeRunningStatus } from '../types'
export interface LoopProgress {
  currentIteration: number
  totalIterations: number
  startTime: number
  status: 'running' | 'completed' | 'failed' | 'stopped'
}
interface SingleNodeRunStore {
  // Map of nodeId to run results
  nodeResults: Map<string, WorkflowNodeExecution>
  // Currently running nodes
  runningNodes: Set<string>
  // Loop progress tracking
  loopProgress: Map<string, LoopProgress>
  // Actions
  setNodeRunning: (
    nodeId: string,
    inputs?: Record<string, any>,
    metadata?: {
      nodeType?: string
      title?: string
    }
  ) => void
  setNodeResult: (nodeId: string, result: Partial<WorkflowNodeExecution>) => void
  clearNodeResult: (nodeId: string) => void
  clearAllResults: () => void
  getNodeResult: (nodeId: string) => WorkflowNodeExecution | undefined
  isNodeRunning: (nodeId: string) => boolean
  // Loop progress actions
  setLoopProgress: (nodeId: string, current: number, total: number) => void
  clearLoopProgress: (nodeId: string) => void
  getLoopProgress: (nodeId: string) => LoopProgress | undefined
}
/**
 * Store for managing single node execution results
 * This persists results across component unmounts
 */
export const useSingleNodeRunStore = create<SingleNodeRunStore>()(
  subscribeWithSelector((set, get) => ({
    nodeResults: new Map(),
    runningNodes: new Set(),
    loopProgress: new Map(),
    setNodeRunning: (nodeId, inputs, metadata) => {
      set((state) => {
        const newResults = new Map(state.nodeResults)
        const newRunning = new Set(state.runningNodes)
        newResults.set(nodeId, {
          id: `temp-${nodeId}-${Date.now()}`,
          organizationId: '',
          workflowAppId: '',
          workflowId: '',
          workflowRunId: null,
          triggeredFrom: 'SINGLE_STEP' as any,
          index: 1,
          predecessorNodeId: null,
          nodeId,
          nodeType: metadata?.nodeType || '',
          title: metadata?.title || '',
          inputs: inputs as any,
          processData: null,
          outputs: null,
          status: NodeRunningStatus.Running as any,
          error: null,
          elapsedTime: null,
          executionMetadata: null,
          createdAt: new Date(),
          createdById: null,
          finishedAt: null,
        } as WorkflowNodeExecution)
        newRunning.add(nodeId)
        return { nodeResults: newResults, runningNodes: newRunning }
      })
    },
    setNodeResult: (nodeId, result) => {
      set((state) => {
        const newResults = new Map(state.nodeResults)
        const newRunning = new Set(state.runningNodes)
        const existing = newResults.get(nodeId)
        if (existing) {
          newResults.set(nodeId, {
            ...existing,
            ...result,
            inputs: result.inputs || existing.inputs, // Preserve inputs if not provided in result
            processData:
              result.processData !== undefined ? result.processData : existing.processData, // Preserve processData if not provided
          })
        } else {
          // Create new result if doesn't exist
          newResults.set(nodeId, result as WorkflowNodeExecution)
        }
        // Remove from running if status is not running
        if (result.status && result.status !== NodeRunningStatus.Running) {
          newRunning.delete(nodeId)
        }
        return { nodeResults: newResults, runningNodes: newRunning }
      })
    },
    clearNodeResult: (nodeId) => {
      set((state) => {
        const newResults = new Map(state.nodeResults)
        const newRunning = new Set(state.runningNodes)
        newResults.delete(nodeId)
        newRunning.delete(nodeId)
        return { nodeResults: newResults, runningNodes: newRunning }
      })
    },
    clearAllResults: () => {
      set({ nodeResults: new Map(), runningNodes: new Set(), loopProgress: new Map() })
    },
    getNodeResult: (nodeId) => {
      return get().nodeResults.get(nodeId)
    },
    isNodeRunning: (nodeId) => {
      return get().runningNodes.has(nodeId)
    },
    // Loop progress methods
    setLoopProgress: (nodeId, current, total) => {
      set((state) => {
        const newLoopProgress = new Map(state.loopProgress)
        const existing = newLoopProgress.get(nodeId)
        newLoopProgress.set(nodeId, {
          currentIteration: current,
          totalIterations: total,
          startTime: existing?.startTime || Date.now(),
          status: 'running',
        })
        return { loopProgress: newLoopProgress }
      })
    },
    clearLoopProgress: (nodeId) => {
      set((state) => {
        const newLoopProgress = new Map(state.loopProgress)
        newLoopProgress.delete(nodeId)
        return { loopProgress: newLoopProgress }
      })
    },
    getLoopProgress: (nodeId) => {
      return get().loopProgress.get(nodeId)
    },
  }))
)
