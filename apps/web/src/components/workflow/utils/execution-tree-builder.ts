// apps/web/src/components/workflow/utils/execution-tree-builder.ts

import type { WorkflowNodeExecutionEntity as WorkflowNodeExecution } from '@auxx/database/types'
import { unifiedNodeRegistry } from '../nodes/unified-registry'
import type { FlowEdge, FlowNode } from '../types'
import { NodeRunningStatus } from '../types'
import { NodeType } from '../types/node-types'

/**
 * One branch taken out of a fork node.
 *
 * `key` identifies the branch (fork node + handle + the node it leads to, so
 * two edges leaving the same unnamed handle stay separate branches); `handle`
 * is what the UI labels it with.
 */
export interface BranchSegment {
  key: string
  handle: string
  forkNodeId: string
}

/**
 * Minimal execution tree node - stores only order and branch lineage
 * All other node data is looked up from the graph when needed
 */
export interface ExecutionTreeNode {
  // Essential execution data
  nodeId: string // Node identifier - lookup key to graph
  nodeType: string // Node type - needed for isTrigger(), mock execution
  order: number // Execution order (DFS traversal index)

  /**
   * Fork lineage of this node, outermost first.
   *
   * This is the ONLY thing the tracing UI needs to nest branches: two nodes
   * are in the same branch iff their paths are equal, and a branch is nested
   * inside another iff its path extends the outer one. An empty array means
   * the node is on the workflow's main line.
   */
  branchPath: BranchSegment[]

  // Loop context (for nodes inside loop bodies)
  parentLoopId?: string // ID of parent loop node if this node is inside a loop

  // Predecessor tracking
  predecessorNodeIds: string[] // Immediate predecessors (for join points)
}

/**
 * Build execution tree from workflow graph
 * Uses DFS-per-branch traversal so a branch and everything nested inside it
 * stay contiguous in the returned list.
 *
 * Branch tracking:
 * - Taking a named output handle (`true`, `false`, `case_1`, `fail`, …) or any
 *   edge out of a multi-output node pushes a segment onto `branchPath`
 * - Sequential edges (single `source` handle) inherit the parent's path
 * - Loop children carry `parentLoopId` and are rendered inside the loop card,
 *   so they keep their parent's branch path
 *
 * @param nodes - Workflow nodes from React Flow
 * @param edges - Workflow edges from React Flow
 * @returns Execution tree in DFS order with branch lineage per node
 */
export function buildExecutionTree(nodes: FlowNode[], edges: FlowEdge[]): ExecutionTreeNode[] {
  // Find entry node (trigger node with no incoming edges)
  const entryNode = findEntryNode(nodes, edges)
  if (!entryNode) {
    console.warn('[ExecutionTreeBuilder] No entry node found')
    return []
  }

  const tree: ExecutionTreeNode[] = []
  const visited = new Set<string>()
  let order = 0

  // DFS traversal context
  interface TraversalContext {
    nodeId: string
    branchPath: BranchSegment[]
    predecessorNodeIds: string[]
    parentLoopId?: string // ID of parent loop if we're inside a loop body
  }

  /**
   * DFS traversal for a single branch
   */
  function traverseBranch(context: TraversalContext) {
    // Handle join points: if already visited, add predecessor but don't re-visit
    if (visited.has(context.nodeId)) {
      const existingNode = tree.find((n) => n.nodeId === context.nodeId)
      if (existingNode && context.predecessorNodeIds.length > 0) {
        // Join point - add additional predecessors
        existingNode.predecessorNodeIds.push(
          ...context.predecessorNodeIds.filter((p) => !existingNode.predecessorNodeIds.includes(p))
        )
      }
      return
    }

    visited.add(context.nodeId)
    const node = nodes.find((n) => n.id === context.nodeId)
    if (!node) return

    // Create minimal tree node - lookup details from graph when needed
    tree.push({
      nodeId: context.nodeId,
      nodeType: node.data.type,
      order: order++,
      branchPath: [...context.branchPath],
      predecessorNodeIds: [...context.predecessorNodeIds],
      parentLoopId: context.parentLoopId,
    })

    // Find outgoing edges from this node
    const allOutgoingEdges = edges.filter((e) => e.source === context.nodeId)

    // Loop-child edges are internal to the loop body (target has parentId ===
    // loopNodeId). They must not count as branches — only edges leaving the
    // loop are part of the sequential flow.
    const outgoingEdges = allOutgoingEdges.filter((e) => {
      const targetNode = nodes.find((n) => n.id === e.target)
      return !targetNode || targetNode.parentId !== context.nodeId
    })

    // A fork is either a node with several outputs, or a single edge leaving
    // through a named handle (an if/else with only one side wired still forks).
    const isFork = outgoingEdges.length > 1

    outgoingEdges.forEach((edge) => {
      if (!nodes.some((n) => n.id === edge.target)) return

      const handle = edge.sourceHandle && edge.sourceHandle !== 'source' ? edge.sourceHandle : null
      const forksHere = isFork || handle !== null

      traverseBranch({
        nodeId: edge.target,
        branchPath: forksHere
          ? [
              ...context.branchPath,
              {
                key: `${context.nodeId}:${handle ?? 'source'}:${edge.target}`,
                handle: handle ?? 'source',
                forkNodeId: context.nodeId,
              },
            ]
          : context.branchPath,
        predecessorNodeIds: [context.nodeId],
        parentLoopId: context.parentLoopId, // Inherit parent loop context
      })
    })

    // Handle loop nodes: process children
    if (node.data.type === NodeType.LOOP) {
      const loopChildren = nodes.filter((n) => n.parentId === context.nodeId)

      // Find loop entry nodes (children with no incoming edges from other children)
      const entryChildren = loopChildren.filter((child) => {
        const incomingEdges = edges.filter((e) => e.target === child.id)
        return incomingEdges.every((e) => {
          const sourceNode = nodes.find((n) => n.id === e.source)
          return !sourceNode || sourceNode.parentId !== context.nodeId
        })
      })

      // Traverse loop entry children with parent loop context
      entryChildren.forEach((child) => {
        traverseBranch({
          nodeId: child.id,
          branchPath: context.branchPath, // Loop body renders inside the loop card
          predecessorNodeIds: [context.nodeId],
          parentLoopId: context.nodeId, // Set current loop node as parent loop
        })
      })
    }
  }

  // Start DFS traversal from entry node
  traverseBranch({
    nodeId: entryNode.id,
    branchPath: [],
    predecessorNodeIds: [],
  })

  return tree
}

/**
 * Find entry node (trigger node with no incoming edges)
 */
function findEntryNode(nodes: FlowNode[], edges: FlowEdge[]): FlowNode | null {
  // Find nodes with no incoming edges (excluding loop children)
  const entryNodes = nodes.filter((node) => {
    // Skip loop children (they're not entry nodes)
    if (node.parentId) return false

    // Check if node has any incoming edges
    const hasIncoming = edges.some((edge) => edge.target === node.id)
    return !hasIncoming
  })

  // Prefer trigger nodes using unified registry
  const triggerNode = entryNodes.find((node) => unifiedNodeRegistry.isTrigger(node.data.type))

  return triggerNode || entryNodes[0] || null
}

/**
 * Convert execution tree to NodeExecution format for display
 * Creates mock executions for unexecuted nodes with Pending status
 * Looks up node details from graph when needed
 */
export function treeToExecutions(
  tree: ExecutionTreeNode[],
  nodeExecutions: Map<string, WorkflowNodeExecution>,
  nodes: FlowNode[] // Need graph to lookup node details
): WorkflowNodeExecution[] {
  return tree.map((treeNode) => {
    const execution = nodeExecutions.get(treeNode.nodeId)

    // If node was executed, return actual execution with tree metadata
    if (execution) {
      // Build loop info if this node is inside a loop
      const loopInfo = treeNode.parentLoopId
        ? {
            loopNodeId: treeNode.parentLoopId,
            // Keep existing loop info if available, otherwise create stub
            ...((execution.executionMetadata as any)?.loopInfo || {}),
          }
        : undefined

      return {
        ...execution,
        // Merge tree metadata with execution metadata
        executionMetadata: {
          ...(execution.executionMetadata || {}),
          branchPath: treeNode.branchPath,
          predecessorNodeIds: treeNode.predecessorNodeIds,
          ...(loopInfo ? { loopInfo } : {}),
        },
      }
    }

    // Lookup node details from graph for mock execution
    const node = nodes.find((n) => n.id === treeNode.nodeId)

    // Build loop info for pending nodes inside loops
    const loopInfo = treeNode.parentLoopId
      ? {
          loopNodeId: treeNode.parentLoopId,
          // For pending nodes, we don't have iteration details yet
          iterationIndex: 0,
          totalIterations: 0,
        }
      : undefined

    // Create mock execution for unexecuted node
    // NodeExecutionCard already handles Pending status with proper styling
    const pending: WorkflowNodeExecution = {
      id: `pending-${treeNode.nodeId}`,
      nodeId: treeNode.nodeId,
      nodeType: treeNode.nodeType,
      title: node?.data.title || treeNode.nodeId, // Lookup from graph
      status: NodeRunningStatus.Pending,
      // Synthetic row — it is never persisted, so the ownership columns are blank.
      organizationId: '',
      workflowAppId: '',
      workflowId: '',
      triggeredFrom: 'WORKFLOW_RUN',
      workflowRunId: '',
      createdAt: new Date(),
      createdById: null,
      finishedAt: null,
      elapsedTime: null,
      inputs: null,
      outputs: null,
      error: null,
      processData: null,
      predecessorNodeId: treeNode.predecessorNodeIds[0] || null,
      index: treeNode.order,
      executionMetadata: {
        branchPath: treeNode.branchPath,
        predecessorNodeIds: treeNode.predecessorNodeIds,
        ...(loopInfo ? { loopInfo } : {}),
      },
    }
    return pending
  })
}
