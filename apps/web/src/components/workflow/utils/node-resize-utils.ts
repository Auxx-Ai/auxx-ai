// apps/web/src/components/workflow/utils/node-resize-utils.ts

import type { FlowNode } from '~/components/workflow/types'
import { LAYOUT_SPACING } from './layout-constants'

export interface NodeBounds {
  minX: number
  minY: number
  maxX: number
  maxY: number
  width: number
  height: number
}

/**
 * Calculate the bounding box of a set of nodes
 */
export function calculateChildrenBounds(childNodes: FlowNode[]): NodeBounds {
  if (childNodes.length === 0) {
    return { minX: 0, minY: 0, maxX: 0, maxY: 0, width: 0, height: 0 }
  }

  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity

  childNodes.forEach((node) => {
    const nodeWidth = node.width || LAYOUT_SPACING.DEFAULT_NODE_WIDTH
    const nodeHeight = node.height || LAYOUT_SPACING.DEFAULT_NODE_HEIGHT

    minX = Math.min(minX, node.position.x)
    minY = Math.min(minY, node.position.y)
    maxX = Math.max(maxX, node.position.x + nodeWidth)
    maxY = Math.max(maxY, node.position.y + nodeHeight)
  })

  return {
    minX,
    minY,
    maxX,
    maxY,
    width: maxX - minX,
    height: maxY - minY,
  }
}

/**
 * Calculate required size for a parent node based on its children
 */
export function calculateRequiredParentSize(
  childNodes: FlowNode[],
  padding = { top: 80, right: 20, bottom: 20, left: 20 }
): { width: number; height: number } {
  const bounds = calculateChildrenBounds(childNodes)

  // Account for position offset
  const rightEdge = bounds.maxX
  const bottomEdge = bounds.maxY

  return {
    width: rightEdge + padding.right,
    height: bottomEdge + padding.bottom,
  }
}

/**
 * Check if a parent node needs to be resized
 */
export function checkParentNeedsResize(
  parentNode: FlowNode,
  childNodes: FlowNode[]
): { needsResize: boolean; suggestedSize?: { width: number; height: number } } {
  const requiredSize = calculateRequiredParentSize(childNodes)
  const currentWidth = parentNode.width || LAYOUT_SPACING.DEFAULT_NODE_WIDTH
  const currentHeight = parentNode.height || LAYOUT_SPACING.DEFAULT_NODE_HEIGHT

  const needsResize = requiredSize.width > currentWidth || requiredSize.height > currentHeight

  return {
    needsResize,
    suggestedSize: needsResize
      ? {
          width: Math.max(requiredSize.width, currentWidth),
          height: Math.max(requiredSize.height, currentHeight),
        }
      : undefined,
  }
}

/**
 * Create an updated parent node with new dimensions
 */
export function createResizedParentNode(
  parentNode: FlowNode,
  newSize: { width: number; height: number }
): FlowNode {
  return {
    ...parentNode,
    width: newSize.width,
    height: newSize.height,
    data: {
      ...parentNode.data,
      width: newSize.width,
      height: newSize.height,
    },
  }
}
