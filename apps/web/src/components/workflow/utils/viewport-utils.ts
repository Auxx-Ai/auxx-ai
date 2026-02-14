// apps/web/src/components/workflow/utils/viewport-utils.ts

import type { Node, ReactFlowInstance, XYPosition } from '@xyflow/react'

/**
 * Get the absolute position of a node, accounting for parent hierarchy
 */
export const getNodeAbsolutePosition = (
  node: Node,
  getInstance: () => ReactFlowInstance
): XYPosition => {
  let absoluteX = node.position.x
  let absoluteY = node.position.y
  let currentNode = node

  const instance = getInstance()

  // Traverse up the parent hierarchy
  while (currentNode.parentId) {
    const parentNode = instance.getNode(currentNode.parentId)
    if (parentNode) {
      absoluteX += parentNode.position.x
      absoluteY += parentNode.position.y
      currentNode = parentNode
    } else {
      break
    }
  }

  return { x: absoluteX, y: absoluteY }
}

/**
 * Center the viewport on a specific node
 * Handles nodes inside containers by calculating absolute position
 */
export const centerOnNode = (
  nodeId: string,
  getInstance: () => ReactFlowInstance,
  options?: {
    offset?: { x: number; y: number }
    animation?: { duration: number }
    padding?: number
  }
) => {
  const instance = getInstance()
  if (!instance) return false

  const node = instance.getNode(nodeId)
  if (!node) return false

  const { offset = { x: 0, y: 0 }, animation = { duration: 500 }, padding = 0 } = options || {}

  // Get the absolute position accounting for parent hierarchy
  const absolutePosition = getNodeAbsolutePosition(node, getInstance)

  // Get the React Flow container dimensions
  const container = document.querySelector('.react-flow')
  if (!container) {
    // Fallback to standard fitView if container not found
    instance.fitView({
      nodes: [node],
      padding: 0.3,
      duration: animation.duration,
    })
    return true
  }

  const containerRect = container.getBoundingClientRect()
  const containerWidth = containerRect.width
  const containerHeight = containerRect.height

  // Get current viewport
  const { zoom } = instance.getViewport()

  // Calculate the center position with offset
  // offset.x negative means shift left (for right panel compensation)
  const centerX = containerWidth / 2 + (offset.x || 0)
  const centerY = containerHeight / 2 + (offset.y || 0)

  // Calculate the new viewport position to center the node
  const nodeWidth = node.width || 200
  const nodeHeight = node.height || 100

  const newX = absolutePosition.x + nodeWidth / 2 - centerX / zoom
  const newY = absolutePosition.y + nodeHeight / 2 - centerY / zoom

  // Apply padding if specified
  const paddedX = newX - padding / zoom
  const paddedY = newY - padding / zoom

  // Apply the new viewport with animation
  instance.setViewport(
    { x: -paddedX * zoom, y: -paddedY * zoom, zoom },
    { duration: animation.duration }
  )

  return true
}

/**
 * Create an event handler for centering on nodes
 */
export const createCenterOnNodeHandler = (getInstance: () => ReactFlowInstance) => {
  return (event: Event) => {
    const customEvent = event as CustomEvent
    const { nodeId, ...options } = customEvent.detail

    centerOnNode(nodeId, getInstance, options)
  }
}
