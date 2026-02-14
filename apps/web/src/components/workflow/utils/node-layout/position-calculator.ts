// apps/web/src/components/workflow/utils/node-layout/position-calculator.ts

import type { FlowEdge, FlowNode } from '~/components/workflow/types'
import { LAYOUT_SPACING, NODE_ADDITION_CONFIG } from '../layout-constants'
import { CollisionDetector, type Point, type Size } from './collision-detector'
import {
  buildHandleLanes,
  checkLaneShiftRequired,
  findLaneForHandle,
  type HandleLane,
  isMultiHandleNode,
  type LaneShiftConfig,
} from './handle-lanes'

export interface PositionContext {
  position: 'after' | 'before' | 'parallel' | 'standalone' | 'between' | 'replace' | 'inside'
  anchorNode?: { id: string; sourceHandle?: string; targetHandle?: string }
  targetNode?: { id: string; targetHandle?: string }
  nodes: FlowNode[]
  edges?: FlowEdge[] // For analyzing existing connections
  viewport?: { x: number; y: number; zoom: number }
  customPosition?: Point
  nodeSize?: Size
  parentNodeId?: string // For 'inside' position
}

export interface PositionResult {
  position: Point
  edgeInfo?: {
    source: string
    sourceHandle: string
    target: string
    targetHandle: string
  }
  parentContext?: {
    parentId: string
    requiresResize: boolean
    suggestedSize?: { width: number; height: number }
  }
  /** Lane shift information for multi-handle nodes */
  laneShift?: {
    required: boolean
    config?: LaneShiftConfig
  }
}

/**
 * Calculates optimal positions for new nodes with collision avoidance
 */
export class PositionCalculator {
  /**
   * Calculate the position for a new node based on context
   */
  static calculatePosition(context: PositionContext): PositionResult {
    const { position, customPosition, nodeSize } = context

    // Use custom position if provided
    if (customPosition) {
      return { position: customPosition }
    }

    // Use default size if not provided
    const size: Size = nodeSize || {
      width: LAYOUT_SPACING.DEFAULT_NODE_WIDTH,
      height: LAYOUT_SPACING.DEFAULT_NODE_HEIGHT,
    }

    // Calculate position based on type
    switch (position) {
      case 'after':
        return PositionCalculator.calculateAfterPosition(context, size)
      case 'before':
        return PositionCalculator.calculateBeforePosition(context, size)
      case 'parallel':
        return PositionCalculator.calculateParallelPosition(context, size)
      case 'between':
        return PositionCalculator.calculateBetweenPosition(context, size)
      case 'standalone':
        return PositionCalculator.calculateStandalonePosition(context, size)
      case 'inside':
        return PositionCalculator.calculateInsidePosition(context, size)
      default:
        return PositionCalculator.calculateStandalonePosition(context, size)
    }
  }

  /**
   * Calculate position after an anchor node.
   * For multi-handle nodes (if-else, text-classifier), uses lane-aware positioning
   * where each source handle has its own vertical lane for connected nodes.
   * For single-handle nodes, uses simple sibling-aligned positioning.
   */
  private static calculateAfterPosition(context: PositionContext, nodeSize: Size): PositionResult {
    const { anchorNode, nodes, edges = [] } = context

    if (!anchorNode) {
      throw new Error('Anchor node required for "after" position')
    }

    const anchor = nodes.find((n) => n.id === anchorNode.id)
    if (!anchor) {
      throw new Error('Anchor node not found')
    }

    const sourceHandle = anchorNode.sourceHandle || 'source'

    // Check if anchor is a multi-handle node
    if (isMultiHandleNode(anchor)) {
      return PositionCalculator.calculateMultiHandleAfterPosition(
        anchor,
        sourceHandle,
        nodes,
        edges,
        nodeSize
      )
    }

    // Fallback to simple positioning for single-handle nodes
    return PositionCalculator.calculateSimpleAfterPosition(
      anchor,
      sourceHandle,
      nodes,
      edges,
      nodeSize
    )
  }

  /**
   * Calculate position for multi-handle nodes using lane-aware positioning.
   * Each source handle gets its own vertical lane for connected nodes.
   */
  private static calculateMultiHandleAfterPosition(
    anchor: FlowNode,
    sourceHandle: string,
    nodes: FlowNode[],
    edges: FlowEdge[],
    nodeSize: Size
  ): PositionResult {
    // Build handle lanes for this anchor
    const handleLanes = buildHandleLanes(anchor, edges, nodes, sourceHandle)

    // Find the target lane for our source handle
    const targetLane = findLaneForHandle(handleLanes, sourceHandle)

    if (!targetLane) {
      // Fallback if lane not found
      return PositionCalculator.calculateSimpleAfterPosition(
        anchor,
        sourceHandle,
        nodes,
        edges,
        nodeSize
      )
    }

    // Calculate position based on lane context
    const position = PositionCalculator.calculateLaneAwarePosition(
      anchor,
      targetLane,
      nodeSize,
      nodes
    )

    // Check if lane shift is needed
    const shiftConfig = checkLaneShiftRequired(targetLane, handleLanes, nodeSize)

    return {
      position,
      edgeInfo: {
        source: anchor.id,
        sourceHandle: sourceHandle,
        target: '',
        targetHandle: '',
      },
      laneShift: shiftConfig
        ? {
            required: true,
            config: shiftConfig,
          }
        : undefined,
    }
  }

  /**
   * Calculate position within a specific lane.
   * If lane has nodes, stack below them. Otherwise, position at lane's base Y.
   */
  private static calculateLaneAwarePosition(
    anchor: FlowNode,
    targetLane: HandleLane,
    nodeSize: Size,
    nodes: FlowNode[]
  ): Point {
    const anchorWidth = anchor.width || LAYOUT_SPACING.DEFAULT_NODE_WIDTH
    const x = anchor.position.x + anchorWidth + NODE_ADDITION_CONFIG.HORIZONTAL_SPACING

    if (targetLane.connectedNodes.length > 0) {
      // Stack below existing nodes in this lane
      const lowestNode = targetLane.connectedNodes.reduce((lowest, node) =>
        node.position.y > lowest.position.y ? node : lowest
      )
      const lowestBottom =
        lowestNode.position.y + (lowestNode.height || LAYOUT_SPACING.DEFAULT_NODE_HEIGHT)

      const preferredPosition: Point = {
        x: lowestNode.position.x, // Align with existing nodes in lane
        y: lowestBottom + NODE_ADDITION_CONFIG.VERTICAL_SPACING,
      }

      // Find nearest empty space with vertical search
      return CollisionDetector.findNearestEmptySpace(preferredPosition, nodeSize, nodes, 'vertical')
    }

    // Empty lane - position at lane's base Y, centered
    const preferredPosition: Point = {
      x,
      y: targetLane.baseY - nodeSize.height / 2,
    }

    // Find nearest empty space
    return CollisionDetector.findNearestEmptySpace(preferredPosition, nodeSize, nodes, 'any')
  }

  /**
   * Simple positioning for single-handle nodes.
   * Aligns with existing siblings and stacks vertically.
   */
  private static calculateSimpleAfterPosition(
    anchor: FlowNode,
    sourceHandle: string,
    nodes: FlowNode[],
    edges: FlowEdge[],
    nodeSize: Size
  ): PositionResult {
    const anchorWidth = anchor.width || LAYOUT_SPACING.DEFAULT_NODE_WIDTH

    // Find existing outgoing edges from this anchor's source handle
    const outgoingEdges = edges.filter(
      (e) => e.source === anchor.id && e.sourceHandle === sourceHandle
    )

    // Get the target nodes of existing outgoing connections (siblings)
    const siblingTargets = outgoingEdges
      .map((e) => nodes.find((n) => n.id === e.target))
      .filter((n): n is FlowNode => n !== undefined)

    let preferredPosition: Point

    if (siblingTargets.length > 0) {
      // Position aligned with existing siblings but offset vertically
      preferredPosition = PositionCalculator.calculateSiblingAlignedPosition(
        anchor,
        siblingTargets,
        nodeSize
      )
    } else {
      // No existing siblings - use default position to the right of anchor
      preferredPosition = {
        x: anchor.position.x + anchorWidth + NODE_ADDITION_CONFIG.HORIZONTAL_SPACING,
        y: anchor.position.y,
      }
    }

    // Find nearest empty space, searching vertically when we have siblings
    const searchDirection = siblingTargets.length > 0 ? 'vertical' : 'right'
    const finalPosition = CollisionDetector.findNearestEmptySpace(
      preferredPosition,
      nodeSize,
      nodes,
      searchDirection
    )

    return {
      position: finalPosition,
      edgeInfo: {
        source: anchor.id,
        sourceHandle: sourceHandle,
        target: '',
        targetHandle: '',
      },
    }
  }

  /**
   * Calculate position aligned with existing sibling nodes but offset vertically.
   * Places new node in the same column as siblings, below the lowest sibling.
   */
  private static calculateSiblingAlignedPosition(
    anchor: FlowNode,
    siblings: FlowNode[],
    nodeSize: Size
  ): Point {
    // Find the column x-position from siblings (use the leftmost sibling's x)
    const siblingXPositions = siblings.map((s) => s.position.x)
    const targetColumnX = Math.min(...siblingXPositions)

    // Find the vertical extent of siblings
    const siblingBounds = siblings.map((s) => ({
      top: s.position.y,
      bottom: s.position.y + (s.height || LAYOUT_SPACING.DEFAULT_NODE_HEIGHT),
    }))

    const maxY = Math.max(...siblingBounds.map((b) => b.bottom))

    // Place below the lowest sibling
    const placementY = maxY + NODE_ADDITION_CONFIG.VERTICAL_SPACING

    return {
      x: targetColumnX,
      y: placementY,
    }
  }

  /**
   * Calculate position before an anchor node
   */
  private static calculateBeforePosition(context: PositionContext, nodeSize: Size): PositionResult {
    const { anchorNode, nodes } = context

    if (!anchorNode) {
      throw new Error('Anchor node required for "before" position')
    }

    const anchor = nodes.find((n) => n.id === anchorNode.id)
    if (!anchor) {
      throw new Error('Anchor node not found')
    }

    // Initial position to the left of anchor
    const preferredPosition: Point = {
      x: anchor.position.x - nodeSize.width - NODE_ADDITION_CONFIG.HORIZONTAL_SPACING,
      y: anchor.position.y,
    }

    // Find nearest empty space (might need to shift nodes left)
    const finalPosition = CollisionDetector.findNearestEmptySpace(
      preferredPosition,
      nodeSize,
      nodes,
      'any' // Allow any direction for before position
    )

    return {
      position: finalPosition,
      edgeInfo: {
        source: '',
        sourceHandle: '',
        target: anchorNode.id,
        targetHandle: anchorNode.targetHandle || '',
      },
    }
  }

  /**
   * Calculate parallel position (below anchor node)
   */
  private static calculateParallelPosition(
    context: PositionContext,
    nodeSize: Size
  ): PositionResult {
    const { anchorNode, nodes } = context

    if (!anchorNode) {
      throw new Error('Anchor node required for "parallel" position')
    }

    const anchor = nodes.find((n) => n.id === anchorNode.id)
    if (!anchor) {
      throw new Error('Anchor node not found')
    }

    // Initial position below anchor
    const anchorHeight = anchor.height || LAYOUT_SPACING.DEFAULT_NODE_HEIGHT
    const preferredPosition: Point = {
      x: anchor.position.x,
      y: anchor.position.y + anchorHeight + NODE_ADDITION_CONFIG.VERTICAL_SPACING,
    }

    // Find nearest empty space
    const finalPosition = CollisionDetector.findNearestEmptySpace(
      preferredPosition,
      nodeSize,
      nodes,
      'down'
    )

    return {
      position: finalPosition,
      edgeInfo: {
        source: anchorNode.id,
        sourceHandle: anchorNode.sourceHandle || '',
        target: '',
        targetHandle: '',
      },
    }
  }

  /**
   * Calculate position between two nodes
   */
  private static calculateBetweenPosition(
    context: PositionContext,
    nodeSize: Size
  ): PositionResult {
    const { anchorNode, targetNode, nodes } = context

    if (!anchorNode || !targetNode) {
      throw new Error('Both source and target nodes required for "between" position')
    }

    const sourceNode = nodes.find((n) => n.id === anchorNode.id)
    const destNode = nodes.find((n) => n.id === targetNode.id)

    if (!sourceNode || !destNode) {
      throw new Error('Source or target node not found')
    }

    // Calculate midpoint
    const isHorizontal = Math.abs(sourceNode.position.y - destNode.position.y) < 50
    let preferredPosition: Point

    if (isHorizontal) {
      // Nodes are roughly aligned horizontally
      preferredPosition = {
        x: (sourceNode.position.x + destNode.position.x) / 2,
        y: sourceNode.position.y,
      }
    } else {
      // Nodes are vertically offset
      preferredPosition = {
        x: (sourceNode.position.x + destNode.position.x) / 2,
        y: (sourceNode.position.y + destNode.position.y) / 2,
      }
    }

    // Find nearest empty space
    const finalPosition = CollisionDetector.findNearestEmptySpace(
      preferredPosition,
      nodeSize,
      nodes,
      'any'
    )

    return {
      position: finalPosition,
      edgeInfo: {
        source: anchorNode.id,
        sourceHandle: anchorNode.sourceHandle || '',
        target: targetNode.id,
        targetHandle: targetNode.targetHandle || '',
      },
    }
  }

  /**
   * Calculate standalone position
   */
  private static calculateStandalonePosition(
    context: PositionContext,
    nodeSize: Size
  ): PositionResult {
    const { nodes, viewport } = context

    let preferredPosition: Point

    if (viewport) {
      // Place in center of viewport
      preferredPosition = {
        x: (-viewport.x + window.innerWidth / 2) / viewport.zoom,
        y: (-viewport.y + window.innerHeight / 2) / viewport.zoom,
      }
    } else if (nodes.length > 0) {
      // Place to the right of all existing nodes
      const rightmostX = Math.max(
        ...nodes.map((n) => n.position.x + (n.width || LAYOUT_SPACING.DEFAULT_NODE_WIDTH))
      )
      const averageY = nodes.reduce((sum, n) => sum + n.position.y, 0) / nodes.length

      preferredPosition = {
        x: rightmostX + NODE_ADDITION_CONFIG.HORIZONTAL_SPACING,
        y: averageY,
      }
    } else {
      // First node - place at default position
      preferredPosition = { x: 250, y: 250 }
    }

    // Find nearest empty space
    const finalPosition = CollisionDetector.findNearestEmptySpace(
      preferredPosition,
      nodeSize,
      nodes,
      'any'
    )

    return { position: finalPosition }
  }

  /**
   * Calculate positions for multiple nodes at once (useful for batch operations)
   */
  static calculateBatchPositions(
    nodeTypes: string[],
    startPosition: Point,
    existingNodes: FlowNode[],
    direction: 'horizontal' | 'vertical' = 'horizontal'
  ): Point[] {
    const positions: Point[] = []
    const workingNodes = [...existingNodes]

    let currentPosition = { ...startPosition }

    for (const nodeType of nodeTypes) {
      const nodeSize: Size = {
        width: LAYOUT_SPACING.DEFAULT_NODE_WIDTH,
        height: LAYOUT_SPACING.DEFAULT_NODE_HEIGHT,
      }

      // Find empty space for this node
      const finalPosition = CollisionDetector.findNearestEmptySpace(
        currentPosition,
        nodeSize,
        workingNodes,
        direction === 'horizontal' ? 'right' : 'down'
      )

      positions.push(finalPosition)

      // Add a temporary node to avoid overlaps in subsequent calculations
      workingNodes.push({
        id: `temp-${nodeType}-${positions.length}`,
        type: nodeType,
        position: finalPosition,
        width: nodeSize.width,
        height: nodeSize.height,
        data: {} as any,
      } as FlowNode)

      // Update position for next node
      if (direction === 'horizontal') {
        currentPosition = {
          x: finalPosition.x + nodeSize.width + NODE_ADDITION_CONFIG.HORIZONTAL_SPACING,
          y: finalPosition.y,
        }
      } else {
        currentPosition = {
          x: finalPosition.x,
          y: finalPosition.y + nodeSize.height + NODE_ADDITION_CONFIG.VERTICAL_SPACING,
        }
      }
    }

    return positions
  }

  /**
   * Calculate position inside a parent container node
   */
  private static calculateInsidePosition(context: PositionContext, nodeSize: Size): PositionResult {
    const { parentNodeId, nodes } = context

    if (!parentNodeId) {
      throw new Error('Parent node ID required for "inside" position')
    }

    const parentNode = nodes.find((n) => n.id === parentNodeId)
    if (!parentNode) {
      throw new Error('Parent node not found')
    }

    // Get all children of the parent
    const childNodes = nodes.filter((n) => n.parentId === parentNodeId)

    // Calculate optimal position
    const position = PositionCalculator.calculateOptimalChildPosition(
      parentNode,
      childNodes,
      nodeSize
    )

    // Check if parent needs resizing
    const parentResize = PositionCalculator.checkIfParentNeedsResize(
      parentNode,
      childNodes,
      position,
      nodeSize
    )

    return {
      position,
      parentContext: {
        parentId: parentNodeId,
        requiresResize: parentResize.requiresResize,
        suggestedSize: parentResize.suggestedSize,
      },
    }
  }

  /**
   * Calculate optimal position for a child node inside a parent
   */
  private static calculateOptimalChildPosition(
    parentNode: FlowNode,
    existingChildren: FlowNode[],
    nodeSize: Size
  ): Point {
    const padding = { top: 80, right: 20, bottom: 20, left: 20 }
    const spacing = { horizontal: 20, vertical: 20 }

    if (existingChildren.length === 0) {
      // First child - center horizontally at top
      const parentWidth = parentNode.width || LAYOUT_SPACING.DEFAULT_NODE_WIDTH
      return {
        x: Math.max(padding.left, (parentWidth - nodeSize.width) / 2),
        y: padding.top,
      }
    }

    // Calculate available width for children
    const parentWidth = parentNode.width || LAYOUT_SPACING.DEFAULT_NODE_WIDTH
    const availableWidth = parentWidth - padding.left - padding.right

    // Determine max columns based on available space
    const maxColumns = Math.max(
      1,
      Math.floor(availableWidth / (nodeSize.width + spacing.horizontal))
    )

    // Find the next available grid position
    const nextPosition = PositionCalculator.findNextGridPosition(
      existingChildren,
      nodeSize,
      maxColumns,
      padding,
      spacing
    )

    return nextPosition
  }

  /**
   * Find next available position in a grid layout
   */
  private static findNextGridPosition(
    existingChildren: FlowNode[],
    nodeSize: Size,
    maxColumns: number,
    padding: { top: number; right: number; bottom: number; left: number },
    spacing: { horizontal: number; vertical: number }
  ): Point {
    // Create a grid of occupied positions
    const occupiedPositions = new Set<string>()
    existingChildren.forEach((child) => {
      const col = Math.floor(
        (child.position.x - padding.left) / (nodeSize.width + spacing.horizontal)
      )
      const row = Math.floor(
        (child.position.y - padding.top) / (nodeSize.height + spacing.vertical)
      )
      occupiedPositions.add(`${col},${row}`)
    })

    // Find first available position
    let row = 0
    let col = 0
    let found = false

    while (!found) {
      const key = `${col},${row}`
      if (!occupiedPositions.has(key)) {
        found = true
      } else {
        col++
        if (col >= maxColumns) {
          col = 0
          row++
        }
      }
    }

    // Convert grid position to actual coordinates
    return {
      x: padding.left + col * (nodeSize.width + spacing.horizontal),
      y: padding.top + row * (nodeSize.height + spacing.vertical),
    }
  }

  /**
   * Check if parent node needs to be resized to accommodate children
   */
  private static checkIfParentNeedsResize(
    parentNode: FlowNode,
    existingChildren: FlowNode[],
    newChildPosition: Point,
    newChildSize: Size
  ): { requiresResize: boolean; suggestedSize?: { width: number; height: number } } {
    const padding = { top: 80, right: 20, bottom: 20, left: 20 }

    // Calculate bounds including the new child
    let maxX = newChildPosition.x + newChildSize.width
    let maxY = newChildPosition.y + newChildSize.height

    // Consider existing children
    existingChildren.forEach((child) => {
      const childRight = child.position.x + (child.width || LAYOUT_SPACING.DEFAULT_NODE_WIDTH)
      const childBottom = child.position.y + (child.height || LAYOUT_SPACING.DEFAULT_NODE_HEIGHT)
      maxX = Math.max(maxX, childRight)
      maxY = Math.max(maxY, childBottom)
    })

    // Add padding
    const requiredWidth = maxX + padding.right
    const requiredHeight = maxY + padding.bottom

    // Check current parent size
    const currentWidth = parentNode.width || LAYOUT_SPACING.DEFAULT_NODE_WIDTH
    const currentHeight = parentNode.height || LAYOUT_SPACING.DEFAULT_NODE_HEIGHT

    const requiresResize = requiredWidth > currentWidth || requiredHeight > currentHeight

    return {
      requiresResize,
      suggestedSize: requiresResize
        ? {
            width: Math.max(requiredWidth, currentWidth),
            height: Math.max(requiredHeight, currentHeight),
          }
        : undefined,
    }
  }
}
