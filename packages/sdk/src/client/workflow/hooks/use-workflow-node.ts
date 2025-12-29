// packages/sdk/src/client/workflow/hooks/use-workflow-node.ts

'use client'

import { createContext, useContext } from 'react'

/**
 * Connection between workflow nodes
 */
export interface Connection {
  /** Connection ID */
  id: string
  /** Source node ID */
  source: string
  /** Target node ID */
  target: string
  /** Source handle ID (optional) */
  sourceHandle?: string
  /** Target handle ID (optional) */
  targetHandle?: string
}

/**
 * Node execution result information
 */
export interface NodeExecutionResult {
  /** Execution start time */
  startedAt: string
  /** Execution completion time */
  completedAt: string
  /** Execution duration in milliseconds */
  duration: number
  /** Output data from execution */
  output: any
  /** Error information if execution failed */
  error?: {
    code: string
    message: string
  }
}

/**
 * Workflow node context data
 */
export interface WorkflowNodeContextData {
  /** Node ID */
  nodeId: string

  /** Node execution status */
  status: 'idle' | 'running' | 'success' | 'error'

  /** Node configuration data */
  data: Record<string, any>

  /** Last execution result */
  lastRun?: NodeExecutionResult

  /** Node connections */
  connections: {
    inputs: Connection[]
    outputs: Connection[]
  }
}

/**
 * React context for workflow node data
 */
export const WorkflowNodeContext = createContext<WorkflowNodeContextData | null>(null)

/**
 * Access node-level context and state.
 *
 * This hook provides information about the current node's execution state,
 * connections, and last run results. It's primarily used in node visualizations.
 *
 * @example
 * ```typescript
 * export function FacebookPostNode() {
 *   const { status, data, lastRun } = useWorkflowNode()
 *
 *   return (
 *     <WorkflowNode>
 *       <WorkflowNodeRow
 *         label="Facebook Post"
 *         variant={status === 'error' ? 'error' : 'default'}
 *       />
 *       {data.message && (
 *         <WorkflowNodeText className="text-xs text-muted-foreground">
 *           {data.message.substring(0, 50)}...
 *         </WorkflowNodeText>
 *       )}
 *       {lastRun?.error && (
 *         <WorkflowNodeText className="text-xs text-destructive">
 *           Error: {lastRun.error.message}
 *         </WorkflowNodeText>
 *       )}
 *     </WorkflowNode>
 *   )
 * }
 * ```
 */
export function useWorkflowNode(): WorkflowNodeContextData {
  const context = useContext(WorkflowNodeContext)

  if (context) {
    return context
  }

  // Fallback: Try to get basic info from WorkflowContext
  const workflowContext = useContext(WorkflowContext)
  if (workflowContext) {
    return {
      nodeId: workflowContext.nodeId,
      status: 'idle',
      data: workflowContext.data,
      connections: {
        inputs: [],
        outputs: [],
      },
    }
  }

  throw new Error(
    'useWorkflowNode must be used within a WorkflowNodeContext.Provider or WorkflowContext.Provider'
  )
}

// Re-export WorkflowContext for convenience
import { WorkflowContext } from './use-workflow-context.js'
