// apps/web/src/components/workflow/utils/node-layout/node-mover.ts

import type { FlowNode } from '~/components/workflow/types'
import { NODE_ADDITION_CONFIG } from '../layout-constants'
import { CollisionDetector, type Point, type Size, type NodeBounds } from './collision-detector'

export type Direction = 'right' | 'left' | 'down' | 'up'

export interface ShiftResult {
  nodes: FlowNode[]
  movedNodeIds: string[]
}

/**
 * Handles node movement and shifting to make space for new nodes
 */
export class NodeMover {
  /**
   * Shift nodes in a specific direction to make space
   */
  static shiftNodes(
    nodes: FlowNode[],
    direction: Direction,
    amount: number,
    startingFrom: Point
  ): ShiftResult {
    const movedNodeIds: string[] = []

    const updatedNodes = nodes.map((node) => {
      const shouldMove = this.shouldMoveNode(node, direction, startingFrom)

      if (shouldMove) {
        movedNodeIds.push(node.id)
        const newPosition = this.calculateShiftedPosition(node.position, direction, amount)
        return { ...node, position: newPosition }
      }

      return node
    })

    return { nodes: updatedNodes, movedNodeIds }
  }

  /**
   * Make space for a new node at a specific position
   */
  static makeSpaceForNode(
    position: Point,
    nodeSize: Size,
    existingNodes: FlowNode[],
    preferredDirection: 'horizontal' | 'vertical' = 'horizontal'
  ): ShiftResult {
    // Check if space is already available
    if (!CollisionDetector.isPositionOccupied(position, nodeSize, existingNodes)) {
      return { nodes: existingNodes, movedNodeIds: [] }
    }

    // Find colliding nodes
    const collidingNodes = CollisionDetector.detectCollisions(position, nodeSize, existingNodes)

    if (collidingNodes.length === 0) {
      return { nodes: existingNodes, movedNodeIds: [] }
    }

    // Determine shift direction and amount
    const { direction, amount } = this.calculateOptimalShift(
      position,
      nodeSize,
      collidingNodes,
      preferredDirection
    )

    // Shift nodes to make space
    return this.shiftNodes(existingNodes, direction, amount, position)
  }

  /**
   * Move nodes apart when inserting between two connected nodes
   */
  static moveNodesForInsertion(
    sourceNodeId: string,
    targetNodeId: string,
    insertPosition: Point,
    nodeSize: Size,
    nodes: FlowNode[]
  ): ShiftResult {
    const sourceNode = nodes.find((n) => n.id === sourceNodeId)
    const targetNode = nodes.find((n) => n.id === targetNodeId)

    if (!sourceNode || !targetNode) {
      return { nodes, movedNodeIds: [] }
    }

    const sourceWidth = sourceNode.width || nodeSize.width
    const isHorizontalFlow = targetNode.position.x > sourceNode.position.x

    if (isHorizontalFlow) {
      // Check if there's enough space between nodes
      const sourceRightEdge = sourceNode.position.x + sourceWidth
      const targetLeftEdge = targetNode.position.x
      const actualGap = targetLeftEdge - sourceRightEdge
      const requiredSpace = nodeSize.width + NODE_ADDITION_CONFIG.NODE_SHIFT_MARGIN * 2

      if (actualGap < requiredSpace) {
        // Need to shift nodes to the right
        const moveDistance = requiredSpace - actualGap
        return this.shiftNodes(nodes, 'right', moveDistance, targetNode.position)
      }
    } else {
      // Vertical flow
      const sourceHeight = sourceNode.height || nodeSize.height
      const sourceBottomEdge = sourceNode.position.y + sourceHeight
      const targetTopEdge = targetNode.position.y
      const actualGap = targetTopEdge - sourceBottomEdge
      const requiredSpace = nodeSize.height + NODE_ADDITION_CONFIG.NODE_SHIFT_MARGIN * 2

      if (actualGap < requiredSpace) {
        // Need to shift nodes down
        const moveDistance = requiredSpace - actualGap
        return this.shiftNodes(nodes, 'down', moveDistance, targetNode.position)
      }
    }

    return { nodes, movedNodeIds: [] }
  }

  /**
   * Determine if a node should be moved based on direction and starting point
   */
  private static shouldMoveNode(
    node: FlowNode,
    direction: Direction,
    startingFrom: Point
  ): boolean {
    const tolerance = 10 // Small tolerance for floating point comparisons

    switch (direction) {
      case 'right':
        return node.position.x >= startingFrom.x - tolerance
      case 'left':
        return node.position.x <= startingFrom.x + tolerance
      case 'down':
        return node.position.y >= startingFrom.y - tolerance
      case 'up':
        return node.position.y <= startingFrom.y + tolerance
      default:
        return false
    }
  }

  /**
   * Calculate new position after shifting
   */
  private static calculateShiftedPosition(
    position: Point,
    direction: Direction,
    amount: number
  ): Point {
    switch (direction) {
      case 'right':
        return { x: position.x + amount, y: position.y }
      case 'left':
        return { x: position.x - amount, y: position.y }
      case 'down':
        return { x: position.x, y: position.y + amount }
      case 'up':
        return { x: position.x, y: position.y - amount }
      default:
        return position
    }
  }

  /**
   * Calculate optimal shift direction and amount
   */
  private static calculateOptimalShift(
    position: Point,
    nodeSize: Size,
    collidingNodes: FlowNode[],
    preferredDirection: 'horizontal' | 'vertical'
  ): { direction: Direction; amount: number } {
    // Get bounds of new node
    const newNodeBounds: NodeBounds = {
      x: position.x,
      y: position.y,
      width: nodeSize.width,
      height: nodeSize.height,
    }

    // Calculate required shift in each direction
    let rightShift = 0
    let downShift = 0

    collidingNodes.forEach((node) => {
      const nodeBounds = CollisionDetector.getNodeBounds(node)

      // Calculate overlap in each direction
      const overlapRight = newNodeBounds.x + newNodeBounds.width - nodeBounds.x
      const overlapDown = newNodeBounds.y + newNodeBounds.height - nodeBounds.y

      rightShift = Math.max(rightShift, overlapRight + NODE_ADDITION_CONFIG.COLLISION_PADDING)
      downShift = Math.max(downShift, overlapDown + NODE_ADDITION_CONFIG.COLLISION_PADDING)
    })

    // Choose direction based on preference and required shift
    if (preferredDirection === 'horizontal') {
      return { direction: 'right', amount: rightShift }
    } else {
      return { direction: 'down', amount: downShift }
    }
  }

  /**
   * Find all nodes in a specific area
   */
  static findNodesInArea(nodes: FlowNode[], area: NodeBounds): FlowNode[] {
    return nodes.filter((node) => {
      const nodeBounds = CollisionDetector.getNodeBounds(node)
      return CollisionDetector.boundsOverlap(nodeBounds, area)
    })
  }

  /**
   * Align nodes to a grid
   */
  static snapNodesToGrid(nodes: FlowNode[], gridSize: number = 20): FlowNode[] {
    return nodes.map((node) => ({
      ...node,
      position: {
        x: Math.round(node.position.x / gridSize) * gridSize,
        y: Math.round(node.position.y / gridSize) * gridSize,
      },
    }))
  }

  /**
   * Distribute nodes evenly in a line
   */
  static distributeNodesEvenly(
    nodes: FlowNode[],
    startPosition: Point,
    direction: 'horizontal' | 'vertical',
    spacing?: number
  ): FlowNode[] {
    if (nodes.length === 0) return []

    const defaultSpacing =
      direction === 'horizontal'
        ? NODE_ADDITION_CONFIG.HORIZONTAL_SPACING
        : NODE_ADDITION_CONFIG.VERTICAL_SPACING

    const actualSpacing = spacing || defaultSpacing
    const currentPosition = { ...startPosition }

    return nodes.map((node) => {
      const newNode = { ...node, position: { ...currentPosition } }

      if (direction === 'horizontal') {
        currentPosition.x += (node.width || 280) + actualSpacing
      } else {
        currentPosition.y += (node.height || 120) + actualSpacing
      }

      return newNode
    })
  }
}
