// apps/web/src/components/workflow/panels/run/utils/group-executions.ts

import type { WorkflowNodeExecutionEntity as WorkflowNodeExecution } from '@auxx/database/models'
import { NodeRunningStatus } from '~/components/workflow/types'
import type { FlowNode } from '~/components/workflow/types'

/**
 * Single execution (not part of a branch)
 */
export interface SingleExecutionGroup {
  type: 'single'
  execution: WorkflowNodeExecution
}

/**
 * Branch execution group (multiple executions in same branch)
 */
export interface BranchExecutionGroup {
  type: 'branch'
  branchId: string
  executions: WorkflowNodeExecution[]
  depth: number
  status: NodeRunningStatus
}

/**
 * Union type for execution groups
 */
export type ExecutionGroup = SingleExecutionGroup | BranchExecutionGroup

/**
 * Determine the overall status of a branch based on its executions
 */
function getBranchStatus(executions: WorkflowNodeExecution[]): NodeRunningStatus {
  if (executions.length === 0) return NodeRunningStatus.Pending

  // If any failed/exception, branch is failed
  if (
    executions.some(
      (e) => e.status === NodeRunningStatus.Failed || e.status === NodeRunningStatus.Exception
    )
  ) {
    return NodeRunningStatus.Failed
  }

  // If any running, branch is running
  if (executions.some((e) => e.status === NodeRunningStatus.Running)) {
    return NodeRunningStatus.Running
  }

  // If any pending/waiting, branch is pending
  if (
    executions.some(
      (e) => e.status === NodeRunningStatus.Pending || e.status === NodeRunningStatus.Waiting
    )
  ) {
    return NodeRunningStatus.Pending
  }

  // If all succeeded, branch succeeded
  if (executions.every((e) => e.status === NodeRunningStatus.Succeeded)) {
    return NodeRunningStatus.Succeeded
  }

  return NodeRunningStatus.Pending
}

/**
 * Group consecutive executions by branchId and depth changes
 *
 * Algorithm:
 * 1. Iterate through executions in order
 * 2. Detect branch starts: depth increase from previous execution
 * 3. Group all consecutive executions at same or deeper depth
 * 4. Create branch groups for parallel paths
 *
 * @param executions - Ordered list of node executions
 * @param nodes - Workflow graph nodes (optional, for loop child filtering)
 * @returns Array of execution groups (single or branch)
 */
export function groupExecutionsByBranch(
  executions: WorkflowNodeExecution[],
  nodes?: FlowNode[]
): ExecutionGroup[] {
  // Filter out loop children - they should only render inside LoopExecutionCard
  const topLevelExecutions = executions.filter((execution) => {
    const loopInfo = (execution.executionMetadata as any)?.loopInfo
    console.log(nodes)
    // Check if node is a loop child via graph structure
    const graphNode = nodes?.find((n) => n.id === execution.nodeId)
    const isLoopChild = graphNode?.parentId !== undefined

    console.log('[groupExecutions] Filtering:', {
      nodeId: execution.nodeId,
      nodeType: execution.nodeType,
      hasLoopInfo: !!loopInfo?.loopNodeId,
      parentId: graphNode?.parentId,
      isLoopChild,
      willKeep: !loopInfo?.loopNodeId && !isLoopChild,
      graphNode,
    })

    // Keep nodes that are NOT loop children (either by runtime loopInfo or graph parentId)
    return !loopInfo?.loopNodeId && !isLoopChild
  })

  const groups: ExecutionGroup[] = []
  let i = 0

  while (i < topLevelExecutions.length) {
    const execution = topLevelExecutions[i]
    const metadata = execution.executionMetadata as any
    const branchId = metadata?.branchId
    const depth = metadata?.depth ?? 0

    // Check if this is a branch start:
    // 1. Depth > 0 (not root)
    // 2. Depth increases OR depth is > 0 and we're not continuing from previous node at same depth
    const prevExecution = i > 0 ? topLevelExecutions[i - 1] : null
    const prevDepth = prevExecution ? ((prevExecution.executionMetadata as any)?.depth ?? 0) : -1
    const isDepthIncrease = depth > prevDepth
    const isDepthDecrease = depth < prevDepth

    // Check if this node is a sibling of a previous branch (same depth, different parent path)
    const isSiblingBranch = depth > 0 && isDepthDecrease

    // Branch starts when:
    // - Depth increases (entering parallel branch or fork)
    // - Depth decreases back to parallel level (sibling branch)
    // - Has non-source branchId (explicit fork like true/false)
    const isBranchStart = isDepthIncrease || isSiblingBranch || (branchId && branchId !== 'source')

    if (isBranchStart && depth > 0) {
      // Collect all consecutive executions at this depth or deeper
      // BUT stop if we encounter another node at the SAME depth (new parallel branch)
      const branchExecutions: WorkflowNodeExecution[] = [execution]

      // Get predecessorNodeIds from metadata
      const currentPredecessors = metadata?.predecessorNodeIds || []

      let j = i + 1

      while (j < topLevelExecutions.length) {
        const nextExecution = topLevelExecutions[j]
        const nextMetadata = nextExecution.executionMetadata as any
        const nextDepth = nextMetadata?.depth ?? 0
        const nextPredecessors = nextMetadata?.predecessorNodeIds || []

        // Stop conditions:
        // 1. Depth decreases below current branch depth (exiting branch)
        if (nextDepth < depth) {
          break
        }

        // 2. Same depth as branch start AND has a common parent with current branch
        // This means it's a parallel branch from the same fork point
        if (nextDepth === depth) {
          console.log('[groupExecutionsByBranch] Checking same depth node:', {
            current: execution.nodeId,
            next: nextExecution.nodeId,
            depth,
            currentPreds: currentPredecessors,
            nextPreds: nextPredecessors,
          })

          // Check if they share the same parent (predecessor at depth - 1)
          const currentParent = currentPredecessors.find((predId: string) => {
            const predNode = topLevelExecutions.find((e) => e.nodeId === predId)
            const predDepth = predNode ? ((predNode.executionMetadata as any)?.depth ?? 0) : 0
            return predDepth === depth - 1
          })

          const nextParent = nextPredecessors.find((predId: string) => {
            const predNode = topLevelExecutions.find((e) => e.nodeId === predId)
            const predDepth = predNode ? ((predNode.executionMetadata as any)?.depth ?? 0) : 0
            return predDepth === depth - 1
          })

          // If they have the same parent, this is a new parallel branch from same fork
          if (currentParent && nextParent && currentParent === nextParent) {
            console.log('[groupExecutionsByBranch] ✅ Detected parallel branch at same depth!')
            break
          }
        }

        // Continue grouping
        branchExecutions.push(nextExecution)
        j++
      }

      // Create branch group
      const group: BranchExecutionGroup = {
        type: 'branch',
        branchId: branchId || 'source',
        executions: branchExecutions,
        depth,
        status: getBranchStatus(branchExecutions),
      }
      groups.push(group)
      i = j
      continue
    }

    // Single execution (root level or continuation)
    groups.push({
      type: 'single',
      execution,
    })
    i++
  }
  return groups
}
