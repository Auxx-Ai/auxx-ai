// apps/web/src/components/workflow/hooks/use-node-status.ts

import { useRunStore } from '../store/run-store'
import { useSingleNodeRunStore } from '../store/single-node-run-store'
import { NodeRunningStatus } from '../types/node-base'

/**
 * Hook to get the execution status of a specific node
 * Checks both workflow executions and single node runs
 * @param nodeId - The ID of the node to get status for
 * @returns The node status as NodeRunningStatus enum value or null
 */
export function useNodeStatus(nodeId: string): NodeRunningStatus | null {
  // Check workflow execution status
  const nodeExecution = useRunStore((state) => state.nodeExecutions.get(nodeId))

  // Check single node run status
  const singleNodeResult = useSingleNodeRunStore((state) => state.nodeResults.get(nodeId))

  // Check if it's a loop that's iterating
  const loopProgress = useSingleNodeRunStore((state) => state.loopProgress.get(nodeId))

  // If loop is iterating, return running
  if (loopProgress && loopProgress.status === NodeRunningStatus.Running) {
    return NodeRunningStatus.Running
  }

  // Prioritize workflow execution status if available
  if (nodeExecution) {
    // Direct return since the status should already be a NodeRunningStatus value
    return (nodeExecution.status as NodeRunningStatus) || null
  }

  // Fall back to single node run status
  if (singleNodeResult) {
    // Now that singleNodeResult uses NodeRunningStatus directly, no mapping needed
    return singleNodeResult.status
  }

  // No execution found
  return null
}

/**
 * Hook to get loop progress for a specific node
 * @param nodeId - The ID of the loop node
 * @returns The loop progress or undefined
 */
export function useLoopProgress(nodeId: string) {
  return useSingleNodeRunStore((state) => state.getLoopProgress(nodeId))
}
