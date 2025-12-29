// packages/lib/src/workflow-engine/core/workflow-graph-builder.ts

import { createScopedLogger } from '@auxx/logger'
import { NodeProcessorRegistry } from './node-processor-registry'
import type {
  Workflow,
  WorkflowNode,
  WorkflowNodeType,
  WorkflowEdge,
  ForkPointInfo,
  JoinPointInfo,
} from './types'
import { WorkflowTriggerType } from './types'

const logger = createScopedLogger('workflow-graph-builder')

/**
 * Enhanced workflow graph structure for efficient execution
 */
export interface WorkflowGraph {
  workflowId: string
  nodes: Map<string, GraphNode>

  // Edge indexes for O(1) lookups
  edgesBySourceHandle: Map<string, WorkflowEdge[]> // "nodeId:handleId" -> edges
  edgesByTarget: Map<string, WorkflowEdge[]> // targetNodeId -> edges

  // Pre-calculated routing
  nodeRoutes: Map<string, NodeRouteInfo>

  // Special node indexes
  entryNodes: string[]
  terminalNodes: string[]
  loopNodes: Map<string, LoopNodeInfo>

  // Fork and Join detection
  forkPoints: Map<string, ForkPointInfo[]> // NodeID -> Fork info
  joinPoints: Map<string, JoinPointInfo> // NodeID -> Join info
  forkToJoinMap: Map<string, string> // ForkID -> JoinID mapping
  orphanForks: Set<string> // Forks without corresponding joins

  // Validation
  hasCycles: boolean
  cycleEdges: string[]
}

export interface GraphNode {
  id: string
  type: WorkflowNodeType
  data: any

  // Connection info
  inputHandles: Set<string>
  outputHandles: Map<string, OutputHandleInfo>

  // Context
  isInLoop: boolean
  loopId?: string
  parentId?: string
  children: string[]
}

// Type alias for compatibility
type OptimizedNode = GraphNode

export interface OutputHandleInfo {
  handleId: string
  targetCount: number
  targetNodeIds: string[]
  isParallel: boolean
}

export interface NodeRouteInfo {
  nodeId: string
  routes: Map<string, RouteInfo>
  hasMultipleOutputs: boolean
  hasParallelOutputs: boolean
  hasConditionalOutputs: boolean
}

export interface RouteInfo {
  handleId: string
  targetNodes: TargetNodeInfo[]
  isParallel: boolean
  isFallback: boolean
}

export interface TargetNodeInfo {
  nodeId: string
  nodeType: WorkflowNodeType
  targetHandle: string
  edge: WorkflowEdge
}

export interface LoopNodeInfo {
  loopNodeId: string
  startHandle: string
  exitHandle: string
  childNodeIds: string[]
  hasLoopBack: boolean
}

interface CycleDetectionResult {
  hasCycles: boolean
  cycleEdges: string[]
}

/**
 * Builder class for creating workflow graph structures
 */
export class WorkflowGraphBuilder {
  private static nodeRegistry: NodeProcessorRegistry
  private static lastTransformedWorkflow: Workflow | null = null
  private static readonly ENTRY_NODE_TYPES = new Set(Object.values(WorkflowTriggerType))

  private static readonly UI_ONLY_TYPES = new Set(['note', 'group', 'annotation', 'comment'])

  /**
   * Initialize the graph builder with a node registry
   */
  static initialize(nodeRegistry: NodeProcessorRegistry) {
    this.nodeRegistry = nodeRegistry
  }

  /**
   * Build an optimized graph structure from workflow data
   * Handles all transformation, filtering, and optimization
   */
  static buildGraph(workflow: any): WorkflowGraph {
    // Extract graph structure from database format
    const rawGraph = workflow.graph || { nodes: [], edges: [] }

    // Step 1: Filter executable nodes (remove UI-only nodes)
    const executableNodes = this.filterExecutableNodes(rawGraph.nodes || [])

    // Step 2: Process disabled nodes and create bypass edges
    const { nodes: activeNodes, edges: processedEdges } = this.processDisabledNodes(
      executableNodes,
      rawGraph.edges || []
    )

    // Step 3: Transform nodes to engine format
    const transformedNodes = this.transformNodes(activeNodes, workflow.id)

    // Store transformed workflow for reference
    this.lastTransformedWorkflow = {
      ...workflow,
      nodes: transformedNodes,
      graph: { edges: processedEdges },
    }

    // Step 4: Build optimized graph structure
    const nodes = new Map<string, GraphNode>()
    const nodeTypeMap = new Map<string, WorkflowNodeType>()
    const edgesBySourceHandle = new Map<string, WorkflowEdge[]>()
    const edgesByTarget = new Map<string, WorkflowEdge[]>()
    const nodeRoutes = new Map<string, NodeRouteInfo>()
    const loopNodes = new Map<string, LoopNodeInfo>()

    // Extract edges from processed edges
    const edges = processedEdges.map((edge: any) => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      sourceHandle: edge.sourceHandle || 'source',
      targetHandle: edge.targetHandle || 'target',
      data: edge.data,
    }))

    // First pass: Build node map and identify special nodes
    const entryNodes: string[] = []
    const terminalNodes: string[] = []

    for (const node of transformedNodes) {
      const graphNode = this.buildGraphNode(node, this.lastTransformedWorkflow!)
      nodes.set(node.nodeId, graphNode)
      nodeTypeMap.set(node.nodeId, node.type)

      // Identify special nodes
      if (this.ENTRY_NODE_TYPES.has(node.type)) {
        entryNodes.push(node.nodeId)
      }
      if (node.type === 'end') {
        terminalNodes.push(node.nodeId)
      }
      if (node.type === 'loop') {
        loopNodes.set(node.nodeId, this.buildLoopInfo(node, transformedNodes, edges))
      }
    }

    // Second pass: Index edges
    for (const edge of edges) {
      // Index by source handle
      const sourceKey = `${edge.source}:${edge.sourceHandle}`
      if (!edgesBySourceHandle.has(sourceKey)) {
        edgesBySourceHandle.set(sourceKey, [])
      }
      edgesBySourceHandle.get(sourceKey)!.push(edge)

      // Index by target
      if (!edgesByTarget.has(edge.target)) {
        edgesByTarget.set(edge.target, [])
      }
      edgesByTarget.get(edge.target)!.push(edge)
    }

    // Third pass: Build routing info and update output handles
    for (const [nodeId, node] of nodes) {
      // Update output handle info with actual edge data
      for (const [handleId, outputInfo] of node.outputHandles) {
        const sourceKey = `${nodeId}:${handleId}`
        const handleEdges = edgesBySourceHandle.get(sourceKey) || []
        outputInfo.targetCount = handleEdges.length
        outputInfo.targetNodeIds = handleEdges.map((e) => e.target)
        outputInfo.isParallel = handleEdges.length > 1
      }

      // Build complete routing info
      const routeInfo = this.buildNodeRouteInfo(node, edgesBySourceHandle, nodeTypeMap)
      nodeRoutes.set(nodeId, routeInfo)
    }

    // Detect cycles
    const cycleDetection = this.detectCycles(nodes, edges)

    // Detect forks and joins
    const forkDetection = WorkflowGraphHelper.detectForkPoints(nodes, edges)
    const forkPoints = forkDetection.forkPoints
    const orphanForks = forkDetection.orphans
    const joinPoints = WorkflowGraphHelper.detectJoinPoints(nodes, edgesByTarget)
    const forkToJoinMap = WorkflowGraphHelper.mapForksToJoins(forkPoints, joinPoints, nodes, edges)

    return {
      workflowId: workflow.id,
      nodes,
      edgesBySourceHandle,
      edgesByTarget,
      nodeRoutes,
      entryNodes,
      terminalNodes,
      loopNodes,
      forkPoints,
      joinPoints,
      forkToJoinMap,
      orphanForks,
      hasCycles: cycleDetection.hasCycles,
      cycleEdges: cycleDetection.cycleEdges,
    }
  }

  /**
   * Filter out non-executable nodes (UI-only nodes)
   */
  private static filterExecutableNodes(nodes: any[]): any[] {
    return nodes.filter((node) => {
      const nodeType = node.data?.type || node.type

      // Skip UI-only nodes
      if (this.UI_ONLY_TYPES.has(nodeType)) {
        return false
      }

      // Skip if no processor exists
      if (this.nodeRegistry && !this.nodeRegistry.hasProcessor(nodeType)) {
        logger.warn(`No processor found for node type: ${nodeType}`, { nodeId: node.id })
        return false
      }

      return true
    })
  }

  /**
   * Handle disabled nodes by creating bypass edges
   */
  private static processDisabledNodes(nodes: any[], edges: any[]): { nodes: any[]; edges: any[] } {
    const enabledNodes: any[] = []
    const disabledNodeIds = new Set<string>()

    // Identify disabled nodes
    nodes.forEach((node) => {
      if (node.data?.disabled) {
        disabledNodeIds.add(node.id)
      } else {
        enabledNodes.push(node)
      }
    })

    // If no disabled nodes, return as-is
    if (disabledNodeIds.size === 0) {
      return { nodes, edges }
    }

    // Create bypass edges
    const newEdges: any[] = []
    const processedPairs = new Set<string>()

    edges.forEach((edge) => {
      // Keep edge if neither source nor target is disabled
      if (!disabledNodeIds.has(edge.source) && !disabledNodeIds.has(edge.target)) {
        newEdges.push(edge)
        return
      }

      // If source is disabled, skip (will be handled by incoming edges)
      if (disabledNodeIds.has(edge.source)) {
        return
      }

      // If target is disabled, create bypass
      if (disabledNodeIds.has(edge.target)) {
        const bypassEdges = this.createBypassForDisabledTarget(
          edge,
          edges,
          disabledNodeIds,
          processedPairs
        )
        newEdges.push(...bypassEdges)
      }
    })

    return { nodes: enabledNodes, edges: newEdges }
  }

  /**
   * Create bypass edges for a disabled target node
   */
  private static createBypassForDisabledTarget(
    incomingEdge: any,
    allEdges: any[],
    disabledNodeIds: Set<string>,
    processedPairs: Set<string>
  ): any[] {
    const bypassEdges: any[] = []

    // Find all outgoing edges from the disabled node
    const outgoingEdges = allEdges.filter((e) => e.source === incomingEdge.target)

    outgoingEdges.forEach((outEdge) => {
      // Follow chain of disabled nodes
      let finalTarget = outEdge.target
      let finalHandle = outEdge.targetHandle

      while (disabledNodeIds.has(finalTarget)) {
        const nextEdges = allEdges.filter((e) => e.source === finalTarget)
        if (nextEdges.length === 1) {
          finalTarget = nextEdges[0].target
          finalHandle = nextEdges[0].targetHandle
        } else {
          // Complex disabled node routing, log and skip
          logger.warn('Skipping complex disabled node routing', {
            disabledNode: incomingEdge.target,
            multipleOutgoing: nextEdges.length,
          })
          return
        }
      }

      // Create bypass edge if we found an enabled target
      if (!disabledNodeIds.has(finalTarget)) {
        const pairKey = `${incomingEdge.source}-${finalTarget}`
        if (!processedPairs.has(pairKey)) {
          processedPairs.add(pairKey)
          bypassEdges.push({
            id: `bypass-${incomingEdge.id}-${outEdge.id}`,
            source: incomingEdge.source,
            sourceHandle: incomingEdge.sourceHandle,
            target: finalTarget,
            targetHandle: finalHandle,
          })
        }
      }
    })

    return bypassEdges
  }

  /**
   * Transform raw nodes to engine format
   */
  private static transformNodes(nodes: any[], workflowId: string): WorkflowNode[] {
    return nodes.map((node) => ({
      id: node.id,
      workflowId,
      nodeId: node.id,
      type: this.extractNodeType(node),
      name: this.extractNodeName(node),
      description: node.data?.description,
      data: this.cleanNodeData(node.data),
      connections: {}, // Empty - using edges only
      metadata: { position: node.position, ...node.data?.metadata },
    }))
  }

  private static extractNodeType(node: any): WorkflowNodeType {
    return (node.data?.type || node.type) as WorkflowNodeType
  }

  private static extractNodeName(node: any): string {
    return node.data?.title || node.data?.name || `${node.type}-${node.id.slice(-4)}`
  }

  private static cleanNodeData(data: any): any {
    if (!data) return {}

    // Remove UI-specific fields
    const { position, metadata, title, name, type, disabled, ...cleanData } = data
    return cleanData
  }

  /**
   * Get transformed workflow
   */
  static getTransformedWorkflow(): Workflow | null {
    return this.lastTransformedWorkflow
  }

  /**
   * Extract edges from workflow graph
   */
  private static extractEdges(workflow: Workflow): WorkflowEdge[] {
    if (!workflow.graph?.edges) return []

    return workflow.graph.edges.map((edge) => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      sourceHandle: edge.sourceHandle || 'source',
      targetHandle: edge.targetHandle || 'target',
      data: edge.data,
    }))
  }

  /**
   * Build optimized node from workflow node
   */
  private static buildGraphNode(node: WorkflowNode, workflow: Workflow): GraphNode {
    const { inputHandles, outputHandles } = this.getNodeHandles(node)
    const loopContext = this.getLoopContext(node, workflow)

    // Get children for container nodes
    const children = workflow.nodes
      .filter((n) => n.data.parentId === node.nodeId)
      .map((n) => n.nodeId)

    return {
      id: node.nodeId,
      type: node.type,
      data: node.data,
      inputHandles,
      outputHandles,
      isInLoop: loopContext.isInLoop,
      loopId: loopContext.loopId,
      parentId: node.data.parentId,
      children,
    }
  }

  /**
   * Determine node handles based on node type
   */
  private static getNodeHandles(node: WorkflowNode): {
    inputHandles: Set<string>
    outputHandles: Map<string, OutputHandleInfo>
  } {
    const inputHandles = new Set<string>()
    const outputHandles = new Map<string, OutputHandleInfo>()

    // Most nodes have a "target" input
    if (!this.ENTRY_NODE_TYPES.has(node.type)) {
      inputHandles.add('target')
    }

    // Determine output handles based on node type
    switch (node.type) {
      case 'if-else': {
        // Dynamic handles based on cases
        const cases = node.data.cases || []
        for (const caseItem of cases) {
          outputHandles.set(caseItem.case_id, this.createEmptyOutputInfo(caseItem.case_id))
        }
        // Always has false (else) handle
        outputHandles.set('false', this.createEmptyOutputInfo('false'))
        break
      }

      case 'human-confirmation':
        outputHandles.set('approved', this.createEmptyOutputInfo('approved'))
        outputHandles.set('denied', this.createEmptyOutputInfo('denied'))
        outputHandles.set('timeout', this.createEmptyOutputInfo('timeout'))
        break

      case 'wait':
        outputHandles.set('source', this.createEmptyOutputInfo('source'))
        // Note: timeout handle could be added if wait nodes support timeout branching
        break

      case 'http':
        outputHandles.set('source', this.createEmptyOutputInfo('source'))
        // Add fail handle if error strategy is 'fail'
        if (node.data.error_strategy === 'fail') {
          outputHandles.set('fail', this.createEmptyOutputInfo('fail'))
        }
        break

      case 'text-classifier': {
        // Dynamic handles based on categories
        const categories = node.data.categories || []
        for (const category of categories) {
          outputHandles.set(category.id, this.createEmptyOutputInfo(category.id))
        }
        // Always has unmatched handle
        outputHandles.set('unmatched', this.createEmptyOutputInfo('unmatched'))
        break
      }

      case 'end':
        // No outputs
        break

      case 'loop':
        inputHandles.add('loop-back')
        outputHandles.set('loop-start', this.createEmptyOutputInfo('loop-start'))
        outputHandles.set('source', this.createEmptyOutputInfo('source'))
        break

      default:
        // Standard nodes have "source" output
        outputHandles.set('source', this.createEmptyOutputInfo('source'))
    }

    return { inputHandles, outputHandles }
  }

  /**
   * Create empty output handle info
   */
  private static createEmptyOutputInfo(handleId: string): OutputHandleInfo {
    return { handleId, targetCount: 0, targetNodeIds: [], isParallel: false }
  }

  /**
   * Build node route information
   */
  private static buildNodeRouteInfo(
    node: GraphNode,
    edgesBySourceHandle: Map<string, WorkflowEdge[]>,
    nodeTypeMap: Map<string, WorkflowNodeType>
  ): NodeRouteInfo {
    const routes = new Map<string, RouteInfo>()
    let hasParallelOutputs = false

    for (const [handleId] of node.outputHandles) {
      const sourceKey = `${node.id}:${handleId}`
      const edges = edgesBySourceHandle.get(sourceKey) || []

      const targetNodes: TargetNodeInfo[] = edges.map((edge) => ({
        nodeId: edge.target,
        nodeType: nodeTypeMap.get(edge.target)!,
        targetHandle: edge.targetHandle,
        edge,
      }))

      const route: RouteInfo = {
        handleId,
        targetNodes,
        isParallel: edges.length > 1,
        isFallback: handleId === 'false' || handleId === 'default' || handleId === 'unmatched',
      }

      routes.set(handleId, route)

      if (route.isParallel) hasParallelOutputs = true
    }

    return {
      nodeId: node.id,
      routes,
      hasMultipleOutputs: node.outputHandles.size > 1,
      hasParallelOutputs,
      hasConditionalOutputs: node.outputHandles.size > 1,
    }
  }

  /**
   * Get loop context for a node
   */
  private static getLoopContext(
    node: WorkflowNode,
    workflow: Workflow
  ): { isInLoop: boolean; loopId?: string } {
    if (!node.data.parentId) {
      return { isInLoop: false }
    }

    // Check if parent is a loop node
    const parent = workflow.nodes.find((n) => n.nodeId === node.data.parentId)
    if (parent?.type === 'loop') {
      return { isInLoop: true, loopId: parent.nodeId }
    }

    // Recursively check parent's parent
    if (parent) {
      return this.getLoopContext(parent, workflow)
    }

    return { isInLoop: false }
  }

  /**
   * Build loop node information
   * Uses transformed nodes (after filtering and disabling) to ensure consistency
   */
  private static buildLoopInfo(
    loopNode: WorkflowNode,
    nodes: WorkflowNode[],
    edges: WorkflowEdge[]
  ): LoopNodeInfo {
    // Use transformed nodes instead of raw workflow.graph.nodes
    const childNodeIds = nodes
      .filter((n) => n.data.parentId === loopNode.nodeId)
      .map((n) => n.nodeId)

    // Check if any edge points back to the loop
    const hasLoopBack = edges.some(
      (edge) => edge.target === loopNode.nodeId && edge.targetHandle === 'loop-back'
    )

    // Validate loop structure
    this.validateLoopStructure(loopNode, childNodeIds, edges)

    return {
      loopNodeId: loopNode.nodeId,
      startHandle: 'loop-start',
      exitHandle: 'source',
      childNodeIds,
      hasLoopBack,
    }
  }

  /**
   * Validate loop node structure to catch configuration errors early
   */
  private static validateLoopStructure(
    loopNode: WorkflowNode,
    childNodeIds: string[],
    edges: WorkflowEdge[]
  ): void {
    // 1. Validate loop-start has exactly one outgoing edge
    const loopStartEdges = edges.filter(
      (e) => e.source === loopNode.nodeId && e.sourceHandle === 'loop-start'
    )
    if (loopStartEdges.length === 0) {
      throw new Error(
        `Loop node "${loopNode.name}" (${loopNode.nodeId}) has no loop-start connection. ` +
          `Connect the loop-start handle to the first node in the loop body.`
      )
    }
    if (loopStartEdges.length > 1) {
      throw new Error(
        `Loop node "${loopNode.name}" (${loopNode.nodeId}) has multiple loop-start connections. ` +
          `The loop-start handle should connect to exactly one node.`
      )
    }

    // 2. Validate loop-back exists if there are edges from loop-start
    const loopBackEdges = edges.filter(
      (e) => e.target === loopNode.nodeId && e.targetHandle === 'loop-back'
    )
    if (loopStartEdges.length > 0 && loopBackEdges.length === 0) {
      logger.warn(
        `Loop node "${loopNode.name}" (${loopNode.nodeId}) has no loop-back connection. ` +
          `The last node in the loop body should connect back to the loop-back handle.`,
        {
          loopNodeId: loopNode.nodeId,
          loopStartTarget: loopStartEdges[0]?.target,
        }
      )
    }

    // 3. Validate source (exit) has at least one outgoing edge (warning only)
    const loopExitEdges = edges.filter(
      (e) => e.source === loopNode.nodeId && e.sourceHandle === 'source'
    )
    if (loopExitEdges.length === 0) {
      logger.warn(
        `Loop node "${loopNode.name}" (${loopNode.nodeId}) has no source (exit) connection. ` +
          `Connect the source handle to continue the workflow after the loop completes.`,
        {
          loopNodeId: loopNode.nodeId,
        }
      )
    }
  }

  /**
   * Detect cycles in the workflow graph with enhanced error messages
   */
  private static detectCycles(
    nodes: Map<string, GraphNode>,
    edges: WorkflowEdge[]
  ): CycleDetectionResult {
    const cycleEdges: string[] = []
    const visited = new Set<string>()
    const recursionStack = new Set<string>()
    const pathStack: string[] = [] // Track the path for better error messages

    // Build adjacency list with edge details
    const adjacencyList = new Map<
      string,
      Array<{ target: string; edgeId: string; edge: WorkflowEdge }>
    >()
    const edgeMap = new Map<string, WorkflowEdge>()

    for (const edge of edges) {
      if (!adjacencyList.has(edge.source)) {
        adjacencyList.set(edge.source, [])
      }
      adjacencyList.get(edge.source)!.push({ target: edge.target, edgeId: edge.id, edge })
      edgeMap.set(edge.id, edge)
    }

    // DFS to detect cycles with path tracking
    const hasCycleFrom = (nodeId: string): boolean => {
      visited.add(nodeId)
      recursionStack.add(nodeId)
      pathStack.push(nodeId)

      const neighbors = adjacencyList.get(nodeId) || []
      for (const { target, edgeId, edge } of neighbors) {
        const targetNode = nodes.get(target)
        const sourceNode = nodes.get(nodeId)

        // Skip loop-back edges (they're intentional cycles)
        if (targetNode?.type === 'loop' && edge.targetHandle === 'loop-back') {
          continue
        }

        // Skip edges from loop-start (internal loop structure)
        if (sourceNode?.type === 'loop' && edge.sourceHandle === 'loop-start') {
          // But still check the target recursively
          if (!visited.has(target)) {
            if (hasCycleFrom(target)) {
              return true
            }
          }
          continue
        }

        if (!visited.has(target)) {
          if (hasCycleFrom(target)) {
            cycleEdges.push(edgeId)
            return true
          }
        } else if (recursionStack.has(target)) {
          // Found a cycle! Build descriptive error message
          const cycleStartIdx = pathStack.indexOf(target)
          const cyclePath = pathStack.slice(cycleStartIdx)
          cyclePath.push(target) // Complete the cycle

          // Create human-readable cycle description
          const cycleDescription = cyclePath
            .map((nId) => {
              const node = nodes.get(nId)
              return node ? `${node.type}:${nId.slice(-8)}` : nId
            })
            .join(' → ')

          logger.error('Cycle detected in workflow', {
            cyclePath: cycleDescription,
            cycleNodes: cyclePath,
            edgeDetails: {
              source: nodeId,
              target,
              sourceHandle: edge.sourceHandle,
              targetHandle: edge.targetHandle,
              edgeId,
            },
          })

          cycleEdges.push(edgeId)
          return true
        }
      }

      pathStack.pop()
      recursionStack.delete(nodeId)
      return false
    }

    // Check each unvisited node
    let hasCycles = false
    for (const [nodeId] of nodes) {
      if (!visited.has(nodeId)) {
        if (hasCycleFrom(nodeId)) {
          hasCycles = true
          // Continue checking to find all cycles (don't break early)
        }
      }
    }

    // If cycles detected, log summary
    if (hasCycles) {
      const cycleDetails = cycleEdges.map((edgeId) => {
        const edge = edgeMap.get(edgeId)
        if (edge) {
          const sourceNode = nodes.get(edge.source)
          const targetNode = nodes.get(edge.target)
          return {
            from: sourceNode
              ? `${sourceNode.type}:${edge.source.slice(-8)}`
              : edge.source.slice(-8),
            to: targetNode
              ? `${targetNode.type}:${edge.target.slice(-8)}`
              : edge.target.slice(-8),
            handle: `${edge.sourceHandle}→${edge.targetHandle}`,
          }
        }
        return { edgeId }
      })

      logger.error('Workflow contains cycles - detailed analysis', {
        totalCycles: cycleEdges.length,
        cycles: cycleDetails,
        suggestion:
          'Check for: 1) Unintended feedback loops, 2) Missing loop-back handles on loop nodes, 3) Edges connecting back to earlier nodes',
      })
    }

    return { hasCycles, cycleEdges }
  }
}

/**
 * Helper functions for working with the workflow graph
 */
export class WorkflowGraphHelper {
  /**
   * Get next nodes to execute based on output handle
   */
  static getNextNodes(
    graph: WorkflowGraph,
    nodeId: string,
    outputHandle: string
  ): TargetNodeInfo[] {
    const routeInfo = graph.nodeRoutes.get(nodeId)

    logger.debug('WorkflowGraphHelper.getNextNodes', {
      nodeId,
      outputHandle,
      hasRouteInfo: !!routeInfo,
      availableRoutes: routeInfo ? Array.from(routeInfo.routes.keys()) : [],
      nodeRoutesSize: graph.nodeRoutes.size,
    })

    if (!routeInfo) return []

    // Try exact handle match first
    let route = routeInfo.routes.get(outputHandle)

    // Fallback to 'source' if specific handle not found
    if (!route && outputHandle !== 'source') {
      route = routeInfo.routes.get('source')
      logger.debug('Fallback to source handle', {
        nodeId,
        originalHandle: outputHandle,
        foundSourceRoute: !!route,
      })
    }

    const result = route?.targetNodes || []

    logger.debug('WorkflowGraphHelper.getNextNodes result', {
      nodeId,
      outputHandle,
      foundRoute: !!route,
      targetNodesCount: result.length,
      targetNodeIds: result.map((n) => n.nodeId),
    })

    return result
  }

  /**
   * Check if execution should be parallel
   */
  static shouldExecuteInParallel(
    graph: WorkflowGraph,
    nodeId: string,
    outputHandle: string
  ): boolean {
    const routeInfo = graph.nodeRoutes.get(nodeId)
    if (!routeInfo) return false

    const route = routeInfo.routes.get(outputHandle)
    return route?.isParallel || false
  }

  /**
   * Get all possible output handles for a node
   */
  static getNodeOutputHandles(graph: WorkflowGraph, nodeId: string): string[] {
    const node = graph.nodes.get(nodeId)
    if (!node) return []

    return Array.from(node.outputHandles.keys())
  }

  /**
   * Detect fork points in the workflow graph
   */
  static detectForkPoints(
    nodes: Map<string, GraphNode>,
    edges: WorkflowEdge[]
  ): { forkPoints: Map<string, ForkPointInfo[]>; orphans: Set<string> } {
    const forkPoints = new Map<string, ForkPointInfo[]>()
    const orphanForks = new Set<string>()

    // Group edges by source node and output handle
    const edgesBySource = new Map<string, Map<string, string[]>>()

    edges.forEach((edge) => {
      if (!edgesBySource.has(edge.source)) {
        edgesBySource.set(edge.source, new Map())
      }
      const handleMap = edgesBySource.get(edge.source)!
      if (!handleMap.has(edge.sourceHandle)) {
        handleMap.set(edge.sourceHandle, [])
      }
      handleMap.get(edge.sourceHandle)!.push(edge.target)
    })

    // Identify forks (output handles with multiple targets)
    edgesBySource.forEach((handleMap, nodeId) => {
      const forks: ForkPointInfo[] = []

      handleMap.forEach((targets, handle) => {
        if (targets.length > 1) {
          const forkInfo: ForkPointInfo = {
            nodeId,
            outputHandle: handle,
            branchNodeIds: targets,
            joinNodeId: undefined,
          }
          forks.push(forkInfo)
        }
      })

      if (forks.length > 0) {
        forkPoints.set(nodeId, forks)
      }
    })

    // Find joins for forks and identify orphans
    forkPoints.forEach((forks, nodeId) => {
      forks.forEach((fork) => {
        fork.joinNodeId = this.findJoinForFork(fork, nodes, edges)
        if (!fork.joinNodeId) {
          orphanForks.add(`${nodeId}:${fork.outputHandle}`)
          logger.warn('Fork without join detected (fan-out pattern)', {
            forkNode: nodeId,
            handle: fork.outputHandle,
            branches: fork.branchNodeIds,
          })
        }
      })
    })

    return { forkPoints, orphans: orphanForks }
  }

  /**
   * Detect join points in the workflow graph
   *
   * IMPORTANT: Only considers edges to 'target' handle as execution flow.
   * Other handles like 'input' (form-input data) or 'loop-back' (loop iteration)
   * are NOT considered for join point detection because they represent
   * data connections, not parallel branch convergence.
   */
  static detectJoinPoints(
    nodes: Map<string, GraphNode>,
    edgesByTarget: Map<string, WorkflowEdge[]>
  ): Map<string, JoinPointInfo> {
    const joinPoints = new Map<string, JoinPointInfo>()

    // Find nodes with multiple incoming execution flow edges
    edgesByTarget.forEach((incomingEdges, nodeId) => {
      const node = nodes.get(nodeId)

      // CRITICAL: Only consider edges to 'target' handle as execution flow
      // This excludes:
      //   - 'input' handles: form-input data connections to trigger nodes
      //   - 'loop-back' handles: loop iteration connections
      //   - Other data/config handles that don't represent branch convergence
      //
      // Join points should ONLY be created when multiple parallel EXECUTION branches
      // converge at a single node through the standard 'target' handle.
      const executionFlowEdges = incomingEdges.filter((edge) => {
        return edge.targetHandle === 'target'
      })

      // Only create join point if multiple execution flow edges exist
      if (executionFlowEdges.length > 1) {
        const expectedInputs = new Set(executionFlowEdges.map((e) => e.source))

        // Check for join config in multiple places:
        // 1. node.data.joinConfig (explicit JOIN node - legacy support)
        // 2. node.data.mergeConfig (END/AI/other nodes - NEW)
        // 3. Default values
        const joinConfig = node?.data?.joinConfig || node?.data?.mergeConfig

        const joinInfo: JoinPointInfo = {
          nodeId,
          expectedInputs,
          joinType: joinConfig?.type || joinConfig?.joinType || 'all',
          requiredCount: joinConfig?.requiredCount,
          timeout: joinConfig?.timeout,
          mergeStrategy: joinConfig?.mergeStrategy || { type: 'merge-all' },
          errorHandling: joinConfig?.errorHandling,
        }

        joinPoints.set(nodeId, joinInfo)

        logger.debug('Detected join point', {
          nodeId,
          nodeType: node?.type,
          expectedInputs: Array.from(expectedInputs),
          hasCustomConfig: !!joinConfig,
          totalIncomingEdges: incomingEdges.length,
          executionFlowEdges: executionFlowEdges.length,
        })
      }
    })

    return joinPoints
  }

  /**
   * Map forks to their corresponding joins
   */
  static mapForksToJoins(
    forkPoints: Map<string, ForkPointInfo[]>,
    joinPoints: Map<string, JoinPointInfo>,
    nodes: Map<string, GraphNode>,
    edges: WorkflowEdge[]
  ): Map<string, string> {
    const forkToJoinMap = new Map<string, string>()

    forkPoints.forEach((forks, nodeId) => {
      forks.forEach((fork) => {
        if (fork.joinNodeId) {
          const forkKey = `${nodeId}:${fork.outputHandle}`
          forkToJoinMap.set(forkKey, fork.joinNodeId)
        }
      })
    })

    return forkToJoinMap
  }

  /**
   * Find the join node for a fork by analyzing the graph
   */
  private static findJoinForFork(
    fork: ForkPointInfo,
    nodes: Map<string, GraphNode>,
    edges: WorkflowEdge[]
  ): string | undefined {
    // Use BFS to find the nearest common descendant of all branches
    const visited = new Set<string>()
    const reachableFromBranch = new Map<string, Set<string>>()

    // For each branch, find all reachable nodes
    fork.branchNodeIds.forEach((branchId) => {
      const reachable = new Set<string>()
      const queue = [branchId]
      const branchVisited = new Set<string>()

      while (queue.length > 0) {
        const current = queue.shift()!
        if (branchVisited.has(current)) continue

        branchVisited.add(current)
        reachable.add(current)

        // Find all outgoing edges from current node
        edges
          .filter((e) => e.source === current)
          .forEach((e) => {
            if (!branchVisited.has(e.target)) {
              queue.push(e.target)
            }
          })
      }

      reachableFromBranch.set(branchId, reachable)
    })

    // Find common descendants reachable from all branches
    const firstBranchReachable = reachableFromBranch.get(fork.branchNodeIds[0])!
    const commonDescendants = new Set<string>()

    firstBranchReachable.forEach((nodeId) => {
      let isCommon = true
      for (const branchId of fork.branchNodeIds.slice(1)) {
        if (!reachableFromBranch.get(branchId)!.has(nodeId)) {
          isCommon = false
          break
        }
      }
      if (isCommon) {
        commonDescendants.add(nodeId)
      }
    })

    // Find the nearest common descendant using BFS from branches
    if (commonDescendants.size > 0) {
      const queue = [...fork.branchNodeIds]
      const visited = new Set<string>()

      while (queue.length > 0) {
        const current = queue.shift()!
        if (visited.has(current)) continue
        visited.add(current)

        if (commonDescendants.has(current)) {
          return current
        }

        edges
          .filter((e) => e.source === current)
          .forEach((e) => {
            if (!visited.has(e.target)) {
              queue.push(e.target)
            }
          })
      }
    }

    return undefined
  }
}
