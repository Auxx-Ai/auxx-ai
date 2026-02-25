// apps/web/src/components/workflow/store/run-store.ts
// Import immer config before creating the store to ensure Map/Set support is enabled
import '~/lib/immer-config'
import { WorkflowRunStatus } from '@auxx/database/enums'
import type {
  WorkflowNodeExecutionEntity as WorkflowNodeExecution,
  WorkflowRunEntity as WorkflowRun,
} from '@auxx/database/types'
import type { WorkflowEventType } from '@auxx/lib/workflow-engine/types'
import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'
import { NodeRunningStatus } from '~/components/workflow/types'
import type { FlowEdge, FlowNode } from '../types'
import {
  buildExecutionTree,
  type ExecutionTreeNode,
  treeToExecutions,
} from '../utils/execution-tree-builder'
import { useCanvasStore } from './canvas-store'
import { usePanelStore } from './panel-store'
export interface ExecutionEvent {
  eventType: WorkflowEventType | string
  timestamp: Date
  workflowRunId: string
  data: any
}
// Extended WorkflowRun type with metadata flags
export interface ExtendedWorkflowRun extends WorkflowRun {
  _isBasicData?: boolean // Flag to indicate if this is basic data that needs full fetch
}
// Enhanced node execution state with error handling
export interface NodeExecutionState extends WorkflowNodeExecution {
  // Error handling fields
  errorSource?: 'preprocessing' | 'execution' | 'validation' | 'configuration'
  errorMetadata?: Record<string, any>
  hasError?: boolean
  errorHighlight?: boolean
}
// Loop iteration data
export interface LoopIterationData {
  loopNodeId: string
  iterationIndex: number
  totalIterations: number
  status: 'running' | 'succeeded' | 'failed'
  startTime: number
  item?: any
  variables?: Record<string, any>
  executedNodes: WorkflowNodeExecution[]
}
export interface RunState {
  // Run history
  runHistory: ExtendedWorkflowRun[]
  // Current active run (can be live or previous run being viewed)
  activeRun: WorkflowRun | null
  // Current view mode
  runViewMode: 'live' | 'previous' | 'single-node' | null
  // Execution state
  isRunning: boolean
  // Real-time events
  executionEvents: ExecutionEvent[]
  // Node executions mapped by ID
  nodeExecutions: Map<string, NodeExecutionState>
  // Connection state (managed by hooks)
  connectionStatus: 'idle' | 'connecting' | 'connected' | 'error' | 'closed'
  connectionError: string | null
  // NEW: Execution tree state
  executionTree: ExecutionTreeNode[] // Planned execution tree
  displayExecutions: WorkflowNodeExecution[] // Tree converted to execution format
  graphSnapshot: { nodes: FlowNode[]; edges: FlowEdge[] } | null // Stored graph for refreshing tree
  // Loop iteration tracking
  loopIterations: Map<string, LoopIterationData[]> // keyed by loop nodeId
}
export interface RunActions {
  // Reset state for a new run (called by hooks before starting)
  resetForNewRun: (nodes: FlowNode[], edges: FlowEdge[]) => void
  // Hook integration methods
  setConnectionStatus: (status: 'idle' | 'connecting' | 'connected' | 'error' | 'closed') => void
  setConnectionError: (error: string | null) => void
  // Show previous run for viewing historical workflows
  showPrevious: (
    run: WorkflowRun & {
      nodeExecutions?: WorkflowNodeExecution[]
    }
  ) => void
  // Stop the current run
  stopRun: () => void
  // Load a specific run
  loadRun: (runId: string) => Promise<void>
  // Clear current run
  clearRun: () => void
  // Get node execution by node ID
  getNodeExecution: (nodeId: string) => NodeExecutionState | undefined
  // Get execution progress (0-100)
  getExecutionProgress: () => number
  // Add run to history
  addToHistory: (run: ExtendedWorkflowRun) => void
  // Add multiple runs to history at once
  addMultipleToHistory: (runs: ExtendedWorkflowRun[]) => void
  // Sync workflow run status from database
  // syncRunStatus: (runId: string) => Promise<void>
  // Helper methods for event hooks
  setNodeExecutions: (nodeExecutions: Map<string, NodeExecutionState>) => void
  updateNodeExecution: (nodeId: string, updates: Partial<NodeExecutionState>) => void
  setIsRunning: (isRunning: boolean) => void
  updateActiveRun: (updates: Partial<WorkflowRun>) => void
  // Error handling methods
  highlightFailedNode: (nodeId: string, errorSource: string) => void
  clearNodeError: (nodeId: string) => void
  getFailedNodes: () => NodeExecutionState[]
  // NEW: Tree management actions
  computeExecutionTree: (nodes: FlowNode[], edges: FlowEdge[]) => void
  updateDisplayExecutions: () => void
  // Loop iteration management
  initLoopIterations: (loopId: string, totalIterations: number, items?: any[]) => void
  startLoopIteration: (
    loopNodeId: string,
    iterationIndex: number,
    totalIterations: number,
    item?: any,
    variables?: Record<string, any>
  ) => void
  getLoopIterations: (loopNodeId: string) => LoopIterationData[]
  completeLoopIterations: (
    loopId: string,
    totalIterations: number,
    outputs?: Record<string, any>
  ) => void
}
export const useRunStore = create<RunState & RunActions>()(
  immer((set, get) => ({
    // Initial state
    activeRun: null,
    runHistory: [],
    runViewMode: null,
    isRunning: false,
    executionEvents: [],
    nodeExecutions: new Map(),
    connectionStatus: 'idle',
    connectionError: null,
    executionTree: [],
    displayExecutions: [],
    graphSnapshot: null,
    loopIterations: new Map(),
    // Reset state for a new run (called by hooks)
    resetForNewRun: (nodes: FlowNode[], edges: FlowEdge[]) => {
      // Set canvas to read-only when starting new run
      useCanvasStore.getState().setReadOnly(true)
      set((state) => {
        state.isRunning = true
        state.executionEvents = []
        state.nodeExecutions = new Map()
        state.loopIterations = new Map()
        state.activeRun = null
        state.runViewMode = 'live'
        state.connectionStatus = 'idle'
        state.connectionError = null

        // Store graph snapshot for refreshing displayExecutions
        state.graphSnapshot = { nodes, edges }

        // Compute execution tree from provided graph
        const tree = buildExecutionTree(nodes, edges)
        state.executionTree = tree

        // Convert to display format (all Pending initially)
        state.displayExecutions = treeToExecutions(tree, state.nodeExecutions, nodes)
      })
    },
    // Hook integration methods
    setConnectionStatus: (status) => {
      set((state) => {
        state.connectionStatus = status
      })
    },
    setConnectionError: (error) => {
      set((state) => {
        state.connectionError = error
      })
    },
    // Show previous run for viewing historical workflows
    showPrevious: (
      run: WorkflowRun & {
        nodeExecutions?: WorkflowNodeExecution[]
      }
    ) => {
      console.log('[Run Store] Showing previous run (historical):', run.id, {
        timestamp: new Date().toISOString(),
        hasNodeExecutions: !!run.nodeExecutions,
        nodeExecutionsLength: run.nodeExecutions?.length || 0,
      })
      // Set canvas to read-only when viewing history
      useCanvasStore.getState().setReadOnly(true)
      set((state) => {
        // Set as activeRun (unified field for both live and previous)
        state.activeRun = run
        state.runViewMode = 'previous'
        state.isRunning = false // Previous runs are never running
        state.connectionStatus = 'idle'
        state.connectionError = null
        // Replace the entire nodeExecutions map with historical data
        const newNodeExecutions = new Map<string, WorkflowNodeExecution>()
        // If the run includes node executions, populate the map
        if (run.nodeExecutions && Array.isArray(run.nodeExecutions)) {
          run.nodeExecutions.forEach((execution) => {
            newNodeExecutions.set(execution.nodeId, execution)
          })
          console.log(
            '[Run Store] Historical node executions loaded:',
            newNodeExecutions.size,
            'executions'
          )
        }
        state.nodeExecutions = newNodeExecutions

        // Compute execution tree from stored graph
        if (run.graph) {
          const graphData = run.graph as { nodes: FlowNode[]; edges: FlowEdge[] }

          // Store graph snapshot for refreshing displayExecutions
          state.graphSnapshot = graphData

          const tree = buildExecutionTree(graphData.nodes, graphData.edges)
          state.executionTree = tree

          // Convert to display format (mix of executed and pending)
          state.displayExecutions = treeToExecutions(tree, newNodeExecutions, graphData.nodes)
        }
      })
    },
    // Stop the current run (called by hooks after disconnecting SSE)
    stopRun: () => {
      set((state) => {
        state.isRunning = false
        if (state.activeRun) {
          state.activeRun.status = WorkflowRunStatus.STOPPED
        }
        state.connectionStatus = 'idle'
        state.connectionError = null
      })
    },
    // Load a specific run
    loadRun: async (runId: string) => {
      // This will be called from a component that has access to the tRPC client
      // The component should call setActiveRun with the loaded data
      // For now, we'll just find it in the history if available
      const { runHistory } = get()
      const run = runHistory.find((r) => r.id === runId)
      if (run) {
        set((state) => {
          state.activeRun = run
          state.runViewMode = 'live'
          // Clear node executions since basic run data doesn't include them
          state.nodeExecutions = new Map()
        })
        // TODO: Re-enable SSE connection for running workflows once consolidated
        if (run.status === 'RUNNING') {
          console.log(
            '[Run Store] Would connect to SSE for loaded running workflow (SSE consolidation pending)'
          )
        }
      }
    },
    // Clear current run
    clearRun: () => {
      // Clear read-only mode when clearing run
      useCanvasStore.getState().setReadOnly(false)
      // Reset run panel tab to 'input'
      usePanelStore.getState().setRunPanelTab('input')
      set((state) => {
        state.activeRun = null
        state.executionEvents = []
        state.nodeExecutions = new Map()
        state.isRunning = false
        state.runViewMode = null
        state.connectionStatus = 'idle'
        state.connectionError = null
      })
    },
    // Get node execution by node ID
    getNodeExecution: (nodeId: string) => {
      return get().nodeExecutions.get(nodeId)
    },
    // Get execution progress
    getExecutionProgress: () => {
      const { activeRun, nodeExecutions } = get()
      if (!activeRun || activeRun.totalSteps === 0) {
        return 0
      }
      const completedNodes = Array.from(nodeExecutions.values()).filter(
        (exec) => exec.status !== NodeRunningStatus.Running
      ).length
      const progress = Math.round((completedNodes / activeRun.totalSteps) * 100)
      return progress
    },
    // Add run to history
    addToHistory: (run: ExtendedWorkflowRun) => {
      set((state) => {
        // Check if run already exists
        const existingIndex = state.runHistory.findIndex((r) => r.id === run.id)
        if (existingIndex !== -1) {
          // Update existing run
          state.runHistory[existingIndex] = run
        } else {
          // Add new run and keep only last 20 runs
          state.runHistory = [run, ...state.runHistory]
        }
      })
    },
    // Add multiple runs to history at once
    addMultipleToHistory: (runs: ExtendedWorkflowRun[]) => {
      set((state) => {
        // Create a map of existing runs for quick lookup
        const existingRunsMap = new Map(state.runHistory.map((run) => [run.id, run]))
        // Filter out runs that already exist and add new ones
        const newRuns = runs.filter((run) => !existingRunsMap.has(run.id))
        // Update existing runs in place
        const updatedRuns = state.runHistory.map((existingRun) => {
          const updatedRun = runs.find((run) => run.id === existingRun.id)
          return updatedRun || existingRun
        })
        // Combine existing (possibly updated) runs with new runs
        // updatedRuns (newer) stay at top, newRuns (older from pagination) appended at bottom
        state.runHistory = [...updatedRuns, ...newRuns].slice(0, 50)
      })
    },
    // Sync workflow run status from database
    // syncRunStatus: async (runId: string) => {
    //   console.log('[Run Store] Syncing workflow run status from database:', runId)
    //   try {
    //     // This will be called from a component that has access to the tRPC client
    //     // The component should fetch the latest run data and update the store
    //     // For now, we'll just set a flag indicating sync is needed
    //     set((state) => {
    //       if (state.activeRun?.id === runId) {
    //         console.log('[Run Store] Sync requested for active run')
    //       }
    //     })
    //   } catch (error) {
    //     console.error('[Run Store] Failed to sync run status:', error)
    //   }
    // },
    // Helper methods for event hooks
    setNodeExecutions: (nodeExecutions: Map<string, WorkflowNodeExecution>) => {
      set((state) => {
        state.nodeExecutions = nodeExecutions

        // Refresh displayExecutions with updated node executions
        if (state.executionTree.length > 0 && state.graphSnapshot) {
          state.displayExecutions = treeToExecutions(
            state.executionTree,
            state.nodeExecutions,
            state.graphSnapshot.nodes
          )
        }
      })
    },
    updateNodeExecution: (nodeId: string, updates: Partial<NodeExecutionState>) => {
      set((state) => {
        const existing = state.nodeExecutions.get(nodeId)
        if (existing) {
          const updated = { ...existing, ...updates }
          state.nodeExecutions.set(nodeId, updated)

          // Auto-populate loop iterations from loopInfo metadata
          const loopInfo = (updated.executionMetadata as any)?.loopInfo
          if (loopInfo?.loopNodeId) {
            const iterations = state.loopIterations.get(loopInfo.loopNodeId) || []

            // Find or create iteration for this index
            let iteration = iterations.find((it) => it.iterationIndex === loopInfo.iterationIndex)

            if (!iteration) {
              // Create new iteration
              iteration = {
                loopNodeId: loopInfo.loopNodeId,
                iterationIndex: loopInfo.iterationIndex,
                totalIterations: loopInfo.totalIterations,
                status: 'running',
                startTime: Date.now(),
                item: loopInfo.item,
                variables: loopInfo.variables,
                executedNodes: [],
              }
              iterations.push(iteration)
              // Sort iterations by index
              iterations.sort((a, b) => a.iterationIndex - b.iterationIndex)
              state.loopIterations.set(loopInfo.loopNodeId, iterations)
            }

            // Add or update the node in this iteration's executedNodes
            const nodeIndex = iteration.executedNodes.findIndex((n) => n.id === updated.id)
            if (nodeIndex >= 0) {
              iteration.executedNodes[nodeIndex] = updated as any
            } else {
              iteration.executedNodes.push(updated as any)
            }

            // Update iteration status based on child nodes
            const hasRunning = iteration.executedNodes.some(
              (n) => n.status === NodeRunningStatus.Running
            )
            const hasFailed = iteration.executedNodes.some(
              (n) => n.status === NodeRunningStatus.Failed
            )
            const allSucceeded = iteration.executedNodes.every(
              (n) => n.status === NodeRunningStatus.Succeeded
            )

            if (hasRunning) {
              iteration.status = 'running'
            } else if (hasFailed) {
              iteration.status = 'failed'
            } else if (allSucceeded) {
              iteration.status = 'succeeded'
            }
          }
        }

        // Refresh display executions with updated data using stored graph
        if (state.executionTree.length > 0 && state.graphSnapshot) {
          state.displayExecutions = treeToExecutions(
            state.executionTree,
            state.nodeExecutions,
            state.graphSnapshot.nodes
          )
        }
      })
    },
    setIsRunning: (isRunning: boolean) => {
      set((state) => {
        state.isRunning = isRunning
      })
    },
    updateActiveRun: (updates: Partial<WorkflowRun> | WorkflowRun) => {
      set((state) => {
        if (state.activeRun) {
          Object.assign(state.activeRun, updates)
        } else {
          // If no activeRun exists, set the full object (for RUN_CREATED event)
          state.activeRun = updates as WorkflowRun
        }
      })
    },
    // Error handling methods
    highlightFailedNode: (nodeId: string, errorSource: string) => {
      set((state) => {
        const existing = state.nodeExecutions.get(nodeId)
        if (existing) {
          state.nodeExecutions.set(nodeId, {
            ...existing,
            hasError: true,
            errorHighlight: true,
            errorSource: errorSource as any,
          })
        }
      })
    },
    clearNodeError: (nodeId: string) => {
      set((state) => {
        const existing = state.nodeExecutions.get(nodeId)
        if (existing) {
          state.nodeExecutions.set(nodeId, {
            ...existing,
            hasError: false,
            errorHighlight: false,
            errorSource: undefined,
            errorMetadata: undefined,
          })
        }
      })
    },
    getFailedNodes: () => {
      const { nodeExecutions } = get()
      return Array.from(nodeExecutions.values()).filter((node) => node.hasError)
    },

    // Compute execution tree from graph
    computeExecutionTree: (nodes: FlowNode[], edges: FlowEdge[]) => {
      console.log('[Run Store] Computing execution tree', {
        nodeCount: nodes.length,
        edgeCount: edges.length,
      })

      const tree = buildExecutionTree(nodes, edges)

      set((state) => {
        state.executionTree = tree

        // Convert tree to execution format (with Pending status for unexecuted)
        state.displayExecutions = treeToExecutions(tree, state.nodeExecutions, nodes)
      })

      console.log('[Run Store] Execution tree computed', { treeSize: tree.length })
    },

    // Update display executions with latest execution data
    updateDisplayExecutions: () => {
      const { executionTree, nodeExecutions, graphSnapshot } = get()

      if (graphSnapshot) {
        set((state) => {
          state.displayExecutions = treeToExecutions(
            executionTree,
            nodeExecutions,
            graphSnapshot.nodes
          )
        })
      }
    },

    // Loop iteration management
    initLoopIterations: (loopId: string, totalIterations: number, items?: any[]) => {
      set((state) => {
        state.loopIterations.set(loopId, [])
      })
    },

    startLoopIteration: (
      loopNodeId: string,
      iterationIndex: number,
      totalIterations: number,
      item?: any,
      variables?: Record<string, any>
    ) => {
      set((state) => {
        const iterations = state.loopIterations.get(loopNodeId) || []

        // Add new iteration
        iterations.push({
          loopNodeId,
          iterationIndex,
          totalIterations,
          status: 'running',
          startTime: Date.now(),
          item,
          variables,
          executedNodes: [],
        })

        state.loopIterations.set(loopNodeId, iterations)
      })
    },

    getLoopIterations: (loopNodeId: string) => {
      const { loopIterations } = get()
      return loopIterations.get(loopNodeId) || []
    },

    completeLoopIterations: (
      loopId: string,
      totalIterations: number,
      outputs?: Record<string, any>
    ) => {
      set((state) => {
        const iterations = state.loopIterations.get(loopId)
        if (iterations) {
          // Mark all iterations as completed
          iterations.forEach((iteration) => {
            if (iteration.status === 'running') {
              iteration.status = 'succeeded'
            }
          })
        }
      })
    },
  }))
)
