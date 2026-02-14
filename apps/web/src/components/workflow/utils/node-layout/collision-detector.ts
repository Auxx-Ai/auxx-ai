// apps/web/src/components/workflow/utils/node-layout/collision-detector.ts

import type { FlowNode } from '~/components/workflow/types'
import { LAYOUT_SPACING, NODE_ADDITION_CONFIG } from '../layout-constants'

export interface NodeBounds {
  x: number
  y: number
  width: number
  height: number
}

export interface Point {
  x: number
  y: number
}

export interface Size {
  width: number
  height: number
}

/**
 * Collision detection utilities for node placement
 */
export class CollisionDetector {
  /**
   * Get the bounding box of a node
   */
  static getNodeBounds(node: FlowNode): NodeBounds {
    return {
      x: node.position.x,
      y: node.position.y,
      width: node.width || LAYOUT_SPACING.DEFAULT_NODE_WIDTH,
      height: node.height || LAYOUT_SPACING.DEFAULT_NODE_HEIGHT,
    }
  }

  /**
   * Check if two bounding boxes overlap
   */
  static boundsOverlap(bounds1: NodeBounds, bounds2: NodeBounds): boolean {
    const padding = NODE_ADDITION_CONFIG.COLLISION_PADDING

    return !(
      bounds1.x + bounds1.width + padding <= bounds2.x ||
      bounds2.x + bounds2.width + padding <= bounds1.x ||
      bounds1.y + bounds1.height + padding <= bounds2.y ||
      bounds2.y + bounds2.height + padding <= bounds1.y
    )
  }

  /**
   * Check if a position is occupied by any existing nodes
   */
  static isPositionOccupied(
    position: Point,
    nodeSize: Size,
    existingNodes: FlowNode[],
    excludeNodeIds: string[] = []
  ): boolean {
    const newBounds: NodeBounds = {
      x: position.x,
      y: position.y,
      width: nodeSize.width,
      height: nodeSize.height,
    }

    return existingNodes.some((node) => {
      if (excludeNodeIds.includes(node.id)) return false
      const existingBounds = CollisionDetector.getNodeBounds(node)
      return CollisionDetector.boundsOverlap(newBounds, existingBounds)
    })
  }

  /**
   * Find all nodes that would collide with a new node at the given position
   */
  static detectCollisions(
    position: Point,
    nodeSize: Size,
    existingNodes: FlowNode[],
    excludeNodeIds: string[] = []
  ): FlowNode[] {
    const newBounds: NodeBounds = {
      x: position.x,
      y: position.y,
      width: nodeSize.width,
      height: nodeSize.height,
    }

    return existingNodes.filter((node) => {
      if (excludeNodeIds.includes(node.id)) return false
      const existingBounds = CollisionDetector.getNodeBounds(node)
      return CollisionDetector.boundsOverlap(newBounds, existingBounds)
    })
  }

  /**
   * Find the nearest empty space for a node starting from a preferred position
   */
  static findNearestEmptySpace(
    preferredPosition: Point,
    nodeSize: Size,
    existingNodes: FlowNode[],
    searchDirection: 'right' | 'down' | 'up' | 'vertical' | 'any' = 'any'
  ): Point {
    const increment = NODE_ADDITION_CONFIG.POSITION_SEARCH_INCREMENTS
    const maxAttempts = NODE_ADDITION_CONFIG.MAX_POSITION_ATTEMPTS
    const searchRadius = NODE_ADDITION_CONFIG.COLLISION_SEARCH_RADIUS

    // First, check if the preferred position is already empty
    if (!CollisionDetector.isPositionOccupied(preferredPosition, nodeSize, existingNodes)) {
      return preferredPosition
    }

    // Search in a spiral pattern or linear direction
    if (searchDirection === 'right') {
      // Search horizontally to the right
      for (let i = 1; i <= maxAttempts; i++) {
        const testPosition = {
          x: preferredPosition.x + i * increment,
          y: preferredPosition.y,
        }
        if (!CollisionDetector.isPositionOccupied(testPosition, nodeSize, existingNodes)) {
          return testPosition
        }
      }
    } else if (searchDirection === 'down') {
      // Search vertically downward
      for (let i = 1; i <= maxAttempts; i++) {
        const testPosition = {
          x: preferredPosition.x,
          y: preferredPosition.y + i * increment,
        }
        if (!CollisionDetector.isPositionOccupied(testPosition, nodeSize, existingNodes)) {
          return testPosition
        }
      }
    } else if (searchDirection === 'up') {
      // Search vertically upward
      for (let i = 1; i <= maxAttempts; i++) {
        const testPosition = {
          x: preferredPosition.x,
          y: preferredPosition.y - i * increment,
        }
        if (!CollisionDetector.isPositionOccupied(testPosition, nodeSize, existingNodes)) {
          return testPosition
        }
      }
    } else if (searchDirection === 'vertical') {
      // Alternate between down and up
      for (let i = 1; i <= maxAttempts; i++) {
        // Try down first
        const downPosition = {
          x: preferredPosition.x,
          y: preferredPosition.y + i * increment,
        }
        if (!CollisionDetector.isPositionOccupied(downPosition, nodeSize, existingNodes)) {
          return downPosition
        }

        // Then try up
        const upPosition = {
          x: preferredPosition.x,
          y: preferredPosition.y - i * increment,
        }
        if (!CollisionDetector.isPositionOccupied(upPosition, nodeSize, existingNodes)) {
          return upPosition
        }
      }
    } else {
      // Search in an expanding square pattern
      for (let distance = 1; distance <= maxAttempts; distance++) {
        const positions = CollisionDetector.getSquarePositions(
          preferredPosition,
          distance * increment
        )

        for (const pos of positions) {
          if (
            Math.abs(pos.x - preferredPosition.x) > searchRadius ||
            Math.abs(pos.y - preferredPosition.y) > searchRadius
          ) {
            continue
          }

          if (!CollisionDetector.isPositionOccupied(pos, nodeSize, existingNodes)) {
            return pos
          }
        }
      }
    }

    // If no empty space found, return a position far to the right
    return {
      x: preferredPosition.x + searchRadius,
      y: preferredPosition.y,
    }
  }

  /**
   * Get positions in a square pattern around a center point
   */
  private static getSquarePositions(center: Point, distance: number): Point[] {
    const positions: Point[] = []

    // Top edge
    for (let x = -distance; x <= distance; x += distance) {
      positions.push({ x: center.x + x, y: center.y - distance })
    }

    // Right edge
    for (let y = -distance + distance; y <= distance - distance; y += distance) {
      positions.push({ x: center.x + distance, y: center.y + y })
    }

    // Bottom edge
    for (let x = distance; x >= -distance; x -= distance) {
      positions.push({ x: center.x + x, y: center.y + distance })
    }

    // Left edge
    for (let y = distance - distance; y >= -distance + distance; y -= distance) {
      positions.push({ x: center.x - distance, y: center.y + y })
    }

    return positions
  }

  /**
   * Get the minimum bounding box that contains all nodes
   */
  static getWorkflowBounds(nodes: FlowNode[]): NodeBounds | null {
    if (nodes.length === 0) return null

    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity

    nodes.forEach((node) => {
      const bounds = CollisionDetector.getNodeBounds(node)
      minX = Math.min(minX, bounds.x)
      minY = Math.min(minY, bounds.y)
      maxX = Math.max(maxX, bounds.x + bounds.width)
      maxY = Math.max(maxY, bounds.y + bounds.height)
    })

    return {
      x: minX,
      y: minY,
      width: maxX - minX,
      height: maxY - minY,
    }
  }
}
