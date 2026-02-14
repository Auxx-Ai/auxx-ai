// apps/web/src/components/workflow/utils/node-layout/handle-lanes.ts

import type { FlowEdge, FlowNode } from '~/components/workflow/types'
import { LAYOUT_SPACING, NODE_ADDITION_CONFIG } from '../layout-constants'

/**
 * Represents a vertical "lane" for nodes connected from a specific source handle
 */
export interface HandleLane {
  handleId: string
  handleIndex: number
  baseY: number
  connectedNodes: FlowNode[]
  laneTop: number
  laneBottom: number
}

/**
 * Configuration for shifting nodes when inserting into a lane
 */
export interface LaneShiftConfig {
  lanesToShiftUp: HandleLane[]
  lanesToShiftDown: HandleLane[]
  shiftAmount: number
}

/**
 * Get ordered list of source handle IDs from node data.
 * Uses _targetBranches for multi-handle nodes (already in top-to-bottom visual order).
 */
export function getHandleOrder(anchor: FlowNode): string[] {
  const targetBranches = anchor.data._targetBranches as
    | Array<{ id: string; name: string }>
    | undefined

  if (targetBranches && targetBranches.length > 0) {
    return targetBranches.map((branch) => branch.id)
  }

  // Single-handle nodes default to 'source'
  return ['source']
}

/**
 * Compute the base Y-position for a handle based on its index.
 * Handles are distributed evenly across the node height.
 */
export function computeHandleBaseY(
  anchor: FlowNode,
  handleIndex: number,
  totalHandles: number
): number {
  const anchorHeight = anchor.height || LAYOUT_SPACING.DEFAULT_NODE_HEIGHT

  // Handles are distributed evenly across the node height
  // First handle starts after padding, last handle ends before padding
  const handleSpacing = anchorHeight / (totalHandles + 1)
  return anchor.position.y + handleSpacing * (handleIndex + 1)
}

/**
 * Compute lane boundaries based on connected nodes or interpolate from handle position.
 */
function computeLaneBoundaries(lanes: HandleLane[], anchor: FlowNode): void {
  lanes.forEach((lane) => {
    if (lane.connectedNodes.length > 0) {
      // Lane has nodes - use their actual positions
      const nodeYs = lane.connectedNodes.map((n) => n.position.y)
      const nodeBottoms = lane.connectedNodes.map(
        (n) => n.position.y + (n.height || LAYOUT_SPACING.DEFAULT_NODE_HEIGHT)
      )
      lane.laneTop = Math.min(...nodeYs)
      lane.laneBottom = Math.max(...nodeBottoms)
    } else {
      // Empty lane - estimate from handle position
      lane.laneTop = lane.baseY - LAYOUT_SPACING.DEFAULT_NODE_HEIGHT / 2
      lane.laneBottom = lane.baseY + LAYOUT_SPACING.DEFAULT_NODE_HEIGHT / 2
    }
  })
}

/**
 * Build lane information for all source handles on an anchor node.
 * Each source handle gets its own vertical "lane" for connected nodes.
 */
export function buildHandleLanes(
  anchor: FlowNode,
  edges: FlowEdge[],
  nodes: FlowNode[],
  currentSourceHandle: string
): HandleLane[] {
  // 1. Get handle order from _targetBranches (already sorted top-to-bottom)
  const handleIds = getHandleOrder(anchor)

  // 2. Include the current sourceHandle if not in list (edge case for dynamic handles)
  if (!handleIds.includes(currentSourceHandle)) {
    handleIds.push(currentSourceHandle)
  }

  // 3. Get outgoing edges for lane population
  const outgoingEdges = edges.filter((e) => e.source === anchor.id)

  // 4. Build lanes in the correct visual order (no sorting needed!)
  const totalHandles = handleIds.length
  const lanes: HandleLane[] = handleIds.map((handleId, index) => {
    const handleEdges = outgoingEdges.filter((e) => e.sourceHandle === handleId)
    const connectedNodes = handleEdges
      .map((e) => nodes.find((n) => n.id === e.target))
      .filter((n): n is FlowNode => n !== undefined)

    return {
      handleId,
      handleIndex: index,
      baseY: computeHandleBaseY(anchor, index, totalHandles),
      connectedNodes,
      laneTop: 0,
      laneBottom: 0,
    }
  })

  // 5. Compute lane boundaries based on connected nodes
  computeLaneBoundaries(lanes, anchor)

  return lanes
}

/**
 * Find the lane for a specific source handle.
 */
export function findLaneForHandle(lanes: HandleLane[], handleId: string): HandleLane | undefined {
  return lanes.find((lane) => lane.handleId === handleId)
}

/**
 * Check if inserting a node in a lane requires shifting other lanes.
 * Returns shift configuration if shifting is needed, null otherwise.
 */
export function checkLaneShiftRequired(
  targetLane: HandleLane,
  allLanes: HandleLane[],
  nodeSize: { width: number; height: number }
): LaneShiftConfig | null {
  // If lane already has nodes, we stack below - no shifting needed
  if (targetLane.connectedNodes.length > 0) {
    return null
  }

  // Calculate where the new node would be placed
  const newNodeTop = targetLane.baseY - nodeSize.height / 2
  const newNodeBottom = targetLane.baseY + nodeSize.height / 2

  // Find lanes that would overlap with the new node position
  const lanesAbove = allLanes.filter(
    (lane) =>
      lane.handleIndex < targetLane.handleIndex &&
      lane.connectedNodes.length > 0 &&
      lane.laneBottom > newNodeTop - NODE_ADDITION_CONFIG.VERTICAL_SPACING
  )

  const lanesBelow = allLanes.filter(
    (lane) =>
      lane.handleIndex > targetLane.handleIndex &&
      lane.connectedNodes.length > 0 &&
      lane.laneTop < newNodeBottom + NODE_ADDITION_CONFIG.VERTICAL_SPACING
  )

  // If no overlap, no shifting needed
  if (lanesAbove.length === 0 && lanesBelow.length === 0) {
    return null
  }

  // Calculate shift amount needed
  const shiftAmount = nodeSize.height + NODE_ADDITION_CONFIG.VERTICAL_SPACING

  return {
    lanesToShiftUp: lanesAbove,
    lanesToShiftDown: lanesBelow,
    shiftAmount,
  }
}

/**
 * Apply lane shifts to nodes.
 * Moves nodes in specified lanes up or down to make room for a new node.
 */
export function applyLaneShifts(nodes: FlowNode[], shiftConfig: LaneShiftConfig): FlowNode[] {
  const { lanesToShiftUp, lanesToShiftDown, shiftAmount } = shiftConfig

  // Get all node IDs that need to move
  const nodeIdsToMoveUp = new Set(
    lanesToShiftUp.flatMap((lane) => lane.connectedNodes.map((n) => n.id))
  )
  const nodeIdsToMoveDown = new Set(
    lanesToShiftDown.flatMap((lane) => lane.connectedNodes.map((n) => n.id))
  )

  return nodes.map((node) => {
    if (nodeIdsToMoveUp.has(node.id)) {
      return {
        ...node,
        position: { x: node.position.x, y: node.position.y - shiftAmount },
      }
    }
    if (nodeIdsToMoveDown.has(node.id)) {
      return {
        ...node,
        position: { x: node.position.x, y: node.position.y + shiftAmount },
      }
    }
    return node
  })
}

/**
 * Check if a node has multiple source handles (is a multi-handle node).
 */
export function isMultiHandleNode(node: FlowNode): boolean {
  const handleOrder = getHandleOrder(node)
  return handleOrder.length > 1
}
