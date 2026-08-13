// apps/web/src/components/workflow/panels/run/utils/trace-tree.ts

import type { WorkflowNodeExecutionEntity as WorkflowNodeExecution } from '@auxx/database/types'
import type { FlowNode } from '~/components/workflow/types'
import { NodeRunningStatus } from '~/components/workflow/types'
import type { BranchSegment } from '~/components/workflow/utils/execution-tree-builder'

/**
 * A single node execution in the trace
 */
export interface TraceNodeItem {
  type: 'node'
  execution: WorkflowNodeExecution
}

/**
 * A branch taken out of a fork node, holding everything executed inside it
 * (including nested branches)
 */
export interface TraceBranchItem {
  type: 'branch'
  /** Full lineage key — unique per branch, stable across renders */
  key: string
  /** Output handle that opened this branch ('true', 'false', 'case_1', 'source', …) */
  branchId: string
  /** Node that forked here */
  forkNodeId: string
  /** Position among sibling branches of the same fork, for numbering unnamed branches */
  branchIndex: number
  status: NodeRunningStatus
  children: TraceItem[]
}

export type TraceItem = TraceNodeItem | TraceBranchItem

/**
 * Build the nested trace from the flat, DFS-ordered display executions.
 *
 * Nesting comes straight from `executionMetadata.branchPath` written by
 * `buildExecutionTree` — one segment per fork taken, so a branch is nested
 * inside another exactly when its path extends it. No heuristics: walking the
 * list once with a stack reproduces the graph's branch structure at any depth.
 *
 * @param executions - Display executions in traversal order
 * @param nodes - Workflow graph nodes, used to drop loop children (they render
 *   inside their loop's card instead)
 * @param runFinished - True when the run has completed; branch status then
 *   reflects only executed nodes (see getBranchStatus)
 */
export function buildTraceTree(
  executions: WorkflowNodeExecution[],
  nodes?: FlowNode[],
  runFinished = false
): TraceItem[] {
  const root: TraceItem[] = []

  // Stack of branches currently open, outermost first — mirrors the branchPath
  // prefix shared by the nodes seen so far.
  const open: { key: string; item: TraceBranchItem }[] = []

  const currentChildren = () => open.at(-1)?.item.children ?? root

  for (const execution of executions) {
    // Loop children render inside LoopExecutionCard, never at trace level
    const metadata = (execution.executionMetadata ?? {}) as {
      branchPath?: BranchSegment[]
      loopInfo?: { loopNodeId?: string }
    }
    if (metadata.loopInfo?.loopNodeId) continue
    if (nodes?.find((n) => n.id === execution.nodeId)?.parentId !== undefined) continue

    const path = metadata.branchPath ?? []

    // Close every branch this node is no longer inside
    while (open.length > 0 && open.at(-1)?.key !== path[open.length - 1]?.key) {
      open.pop()
    }

    // Open the branches this node newly entered
    for (let depth = open.length; depth < path.length; depth++) {
      const segment = path[depth] as BranchSegment
      const parent = currentChildren()
      const item: TraceBranchItem = {
        type: 'branch',
        key: segment.key,
        branchId: segment.handle,
        // Numbered within its own fork, so a second fork at this level
        // restarts at "Branch 1" rather than continuing the first fork's count
        branchIndex: parent.filter(
          (i) => i.type === 'branch' && i.forkNodeId === segment.forkNodeId
        ).length,
        forkNodeId: segment.forkNodeId,
        status: NodeRunningStatus.Pending,
        children: [],
      }
      parent.push(item)
      open.push({ key: segment.key, item })
    }

    currentChildren().push({ type: 'node', execution })
  }

  // Statuses roll up from the leaves, so compute them once the tree is whole
  applyBranchStatus(root, runFinished)

  return root
}

/**
 * Recursively set each branch's status from the executions it contains
 */
function applyBranchStatus(items: TraceItem[], runFinished: boolean) {
  for (const item of items) {
    if (item.type !== 'branch') continue
    applyBranchStatus(item.children, runFinished)
    item.status = getBranchStatus(collectExecutions(item), runFinished)
  }
}

/**
 * Flatten every execution inside a branch, nested branches included
 */
function collectExecutions(branch: TraceBranchItem): WorkflowNodeExecution[] {
  return branch.children.flatMap((child) =>
    child.type === 'node' ? [child.execution] : collectExecutions(child)
  )
}

/**
 * Determine the overall status of a branch based on its executions.
 *
 * @param executions - Node executions belonging to the branch
 * @param runFinished - True when the run has completed (historical view or a
 *   terminal live status). Pending placeholders then mean "never reached", not
 *   "still coming", so branch status is derived from executed nodes only.
 */
function getBranchStatus(
  executions: WorkflowNodeExecution[],
  runFinished: boolean
): NodeRunningStatus {
  const failed = (e: WorkflowNodeExecution) =>
    e.status === NodeRunningStatus.Failed || e.status === NodeRunningStatus.Exception

  if (runFinished) {
    // Pending placeholders are nodes the run never reached — ignore them and
    // judge the branch by the nodes that actually executed.
    const executed = executions.filter((e) => e.status !== NodeRunningStatus.Pending)
    if (executed.length === 0) return NodeRunningStatus.Skipped
    if (executed.some(failed)) return NodeRunningStatus.Failed
    return NodeRunningStatus.Succeeded
  }

  if (executions.length === 0) return NodeRunningStatus.Pending
  if (executions.some(failed)) return NodeRunningStatus.Failed
  if (executions.some((e) => e.status === NodeRunningStatus.Running)) {
    return NodeRunningStatus.Running
  }
  if (executions.every((e) => e.status === NodeRunningStatus.Succeeded)) {
    return NodeRunningStatus.Succeeded
  }
  return NodeRunningStatus.Pending
}
