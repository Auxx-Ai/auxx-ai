// apps/web/src/components/workflow/utils/execution-tree-builder.ts

import type { FlowNode, FlowEdge } from '../types'
import { NodeType } from '../types/node-types'
import { NodeRunningStatus } from '../types'
import type { WorkflowNodeExecutionEntity as WorkflowNodeExecution } from '@auxx/database/models'
import { unifiedNodeRegistry } from '../nodes/unified-registry'

/**
 * Minimal execution tree node - stores only order and depth
 * All other node data is looked up from the graph when needed
 */
export interface ExecutionTreeNode {
  // Essential execution data
  nodeId: string // Node identifier - lookup key to graph
  nodeType: string // Node type - needed for isTrigger(), mock execution
  order: number // Execution order (BFS traversal index)
  depth: number // Visual indentation level (0 = root)

  // Branch context (only for multi-branch nodes)
  branchId?: string // Which output handle led here (e.g., 'true', 'case_1')

  // Loop context (for nodes inside loop bodies)
  parentLoopId?: string // ID of parent loop node if this node is inside a loop

  // Predecessor tracking
  predecessorNodeIds: string[] // Immediate predecessors (for join points)
}

/**
 * Build execution tree from workflow graph
 * Uses DFS-per-branch traversal to group parallel branches together
 *
 * Depth Calculation Rules:
 * - Root/trigger: depth 0
 * - All child nodes: parent.depth + 1 (creates visual hierarchy)
 * - Branch detection: outgoingEdges.length > 1 marks branching node
 * - Loop children: parent.depth + 1
 * - Join points: depth from first encountered predecessor
 *
 * Branch Tracking:
 * - branchId stored for nodes in parallel paths (e.g., 'true', 'false', 'source')
 * - Parallel branches are fully traversed (DFS) before moving to next branch
 * - Used by UI to group and visualize branch executions
 *
 * @param nodes - Workflow nodes from React Flow
 * @param edges - Workflow edges from React Flow
 * @returns Execution tree with correct depth, order, and branch tracking
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
    depth: number
    parentNodeId: string | null
    predecessorNodeIds: string[]
    branchId?: string
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
    const treeNode: ExecutionTreeNode = {
      nodeId: context.nodeId,
      nodeType: node.data.type,
      order: order++,
      depth: context.depth,
      predecessorNodeIds: [...context.predecessorNodeIds],
      branchId: context.branchId,
      parentLoopId: context.parentLoopId,
    }

    tree.push(treeNode)

    // Find outgoing edges from this node
    const allOutgoingEdges = edges.filter((e) => e.source === context.nodeId)

    // Split edges into loop-child edges and true graph edges
    // Loop-child edges are internal to the loop body (target has parentId === loopNodeId)
    // True graph edges connect to nodes outside the loop (sequential flow)
    const loopChildEdges = allOutgoingEdges.filter((e) => {
      const targetNode = nodes.find((n) => n.id === e.target)
      return targetNode && targetNode.parentId === context.nodeId
    })

    const graphEdges = allOutgoingEdges.filter((e) => {
      const targetNode = nodes.find((n) => n.id === e.target)
      return !targetNode || targetNode.parentId !== context.nodeId
    })

    // Use only graph edges for branching detection and sequential traversal
    // This prevents loop children from being counted as branches
    const outgoingEdges = graphEdges

    console.log('[ExecutionTreeBuilder] Processing node:', {
      nodeId: context.nodeId,
      nodeType: node.data.type,
      depth: context.depth,
      allOutgoingEdgesCount: allOutgoingEdges.length,
      loopChildEdgesCount: loopChildEdges.length,
      graphEdgesCount: graphEdges.length,
      outgoingEdges: outgoingEdges.map((e) => ({
        target: e.target,
        sourceHandle: e.sourceHandle,
      })),
    })

    // Check if this is a branching node (count only graph edges, not loop-child edges)
    const hasBranches = outgoingEdges.length > 1

    if (hasBranches) {
      console.log('[ExecutionTreeBuilder] Node has branches, increasing depth for children')
      // Multi-branch node - this is a fork point, depth increases for all children
      outgoingEdges.forEach((edge) => {
        const targetNode = nodes.find((n) => n.id === edge.target)
        if (!targetNode) return

        const branchId = edge.sourceHandle || 'source'

        traverseBranch({
          nodeId: edge.target,
          depth: context.depth + 1, // Fork point: all branches increase depth
          parentNodeId: context.nodeId,
          predecessorNodeIds: [context.nodeId],
          branchId, // Store which handle led here
          parentLoopId: context.parentLoopId, // Inherit parent loop context
        })
      })
    } else {
      // Sequential node (single output) - continue at same depth unless it's a fork handle
      outgoingEdges.forEach((edge) => {
        const targetNode = nodes.find((n) => n.id === edge.target)
        if (!targetNode) return

        // Check if this edge creates a cycle (back edge to already-visited node)
        const isBackEdge = visited.has(edge.target)
        if (isBackEdge) {
          // Don't traverse back edges (would create infinite queue)
          return
        }

        // Check if this edge represents a fork (non-source handle like 'true', 'false', 'fail')
        // Only use edge's sourceHandle if it's not 'source', otherwise inherit parent's branchId
        const isForkHandle = edge.sourceHandle && edge.sourceHandle !== 'source'
        const edgeBranchId = isForkHandle ? edge.sourceHandle : context.branchId

        traverseBranch({
          nodeId: edge.target,
          depth: isForkHandle ? context.depth + 1 : context.depth, // Only fork handles increase depth
          parentNodeId: context.nodeId,
          predecessorNodeIds: [context.nodeId],
          branchId: edgeBranchId, // Use fork handle, or inherit parent's branch context
          parentLoopId: context.parentLoopId, // Inherit parent loop context
        })
      })
    }

    // Handle loop nodes: process children
    if (node.data.type === NodeType.LOOP) {
      console.log('Processing loop children for node:', node.data.type)
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
          depth: context.depth + 1, // Increase depth for loop body
          parentNodeId: context.nodeId,
          predecessorNodeIds: [context.nodeId],
          parentLoopId: context.nodeId, // Set current loop node as parent loop
        })
      })
    }
  }

  // Start DFS traversal from entry node
  traverseBranch({
    nodeId: entryNode.id,
    depth: 0,
    parentNodeId: null,
    predecessorNodeIds: [],
  })

  console.log('TREE:', tree)
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
          depth: treeNode.depth,
          branchId: treeNode.branchId,
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
    return {
      id: `pending-${treeNode.nodeId}`,
      nodeId: treeNode.nodeId,
      nodeType: treeNode.nodeType,
      title: node?.data.title || treeNode.nodeId, // Lookup from graph
      status: NodeRunningStatus.Pending,
      workflowRunId: '',
      createdAt: new Date(),
      completedAt: null,
      elapsedTime: null,
      inputs: null,
      outputs: null,
      error: null,
      processData: null,
      predecessorNodeId: treeNode.predecessorNodeIds[0] || null,
      index: treeNode.order,
      executionMetadata: {
        depth: treeNode.depth,
        branchId: treeNode.branchId,
        predecessorNodeIds: treeNode.predecessorNodeIds,
        ...(loopInfo ? { loopInfo } : {}),
      },
    } as WorkflowNodeExecution
  })
}
