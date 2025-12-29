// apps/web/src/components/workflow/edges/custom-edge/path-utils.ts

import { EDGE_ROUTING } from '../constants'

/**
 * Result from edge path generation
 */
export interface EdgePathResult {
  path: string
  labelX: number
  labelY: number
}

/**
 * Parameters for edge path generation
 */
export interface EdgePathParams {
  sourceX: number
  sourceY: number
  targetX: number
  targetY: number
}

/**
 * Generates a smooth bezier curve for forward edges.
 * Used when target node is ahead (to the right) of source node.
 */
function getForwardEdgePath(params: EdgePathParams): EdgePathResult {
  const { sourceX, sourceY, targetX, targetY } = params

  // Control point offset based on horizontal distance
  const dx = Math.abs(targetX - sourceX)
  const controlOffset = Math.max(dx * 0.25, EDGE_ROUTING.MIN_SEGMENT_LENGTH)

  // Cubic bezier curve
  const path = `M${sourceX},${sourceY} C${sourceX + controlOffset},${sourceY} ${targetX - controlOffset},${targetY} ${targetX},${targetY}`

  return {
    path,
    labelX: (sourceX + targetX) / 2,
    labelY: (sourceY + targetY) / 2,
  }
}

/**
 * Generates an orthogonal S-shape path for backward edges (n8n style).
 * Used when target node is behind (to the left) of source node.
 *
 * Goes in the DIRECTION of target first (up if target above, down if target below),
 * then LEFT past target, then UP or DOWN to target Y (based on where target is
 * relative to midY), then RIGHT to target.
 */
function getBackwardEdgePath(params: EdgePathParams): EdgePathResult {
  const { sourceX, sourceY, targetX, targetY } = params
  const { CORNER_RADIUS, HANDLE_OFFSET, VERTICAL_OFFSET } = EDGE_ROUTING

  const r = CORNER_RADIUS

  // Step 1: Right X position (where we turn after going right from source)
  const rightX = sourceX + HANDLE_OFFSET

  // Step 2: Left X position - go PAST target X to approach from behind
  const leftX = targetX - HANDLE_OFFSET

  // Determine if target is above or below source (for initial direction)
  const targetIsAbove = targetY < sourceY

  // Calculate midpoint Y - go in direction of target
  const midY = targetIsAbove
    ? sourceY - VERTICAL_OFFSET // Go UP if target is above
    : sourceY + VERTICAL_OFFSET // Go DOWN if target is below

  // Determine if target is above or below midY (for final vertical segment)
  const targetIsAboveMidY = targetY < midY

  // Build the path
  let path = `M${sourceX},${sourceY}`

  // 1. Line right from source
  path += ` L${rightX - r},${sourceY}`

  if (targetIsAbove) {
    // TARGET IS ABOVE SOURCE - go UP first
    // 2. Corner: turn UP
    path += ` Q${rightX},${sourceY} ${rightX},${sourceY - r}`

    // 3. Line up to midY
    path += ` L${rightX},${midY + r}`

    // 4. Corner: turn LEFT
    path += ` Q${rightX},${midY} ${rightX - r},${midY}`
  } else {
    // TARGET IS BELOW SOURCE - go DOWN first
    // 2. Corner: turn DOWN
    path += ` Q${rightX},${sourceY} ${rightX},${sourceY + r}`

    // 3. Line down to midY
    path += ` L${rightX},${midY - r}`

    // 4. Corner: turn LEFT
    path += ` Q${rightX},${midY} ${rightX - r},${midY}`
  }

  // 5. Line left to leftX (past target)
  path += ` L${leftX + r},${midY}`

  // 6-8. Now go UP or DOWN to target based on where target is relative to midY
  if (targetIsAboveMidY) {
    // Target is ABOVE midY - go UP
    // 6. Corner: turn UP
    path += ` Q${leftX},${midY} ${leftX},${midY - r}`

    // 7. Line up to target Y
    path += ` L${leftX},${targetY + r}`

    // 8. Corner: turn RIGHT
    path += ` Q${leftX},${targetY} ${leftX + r},${targetY}`
  } else {
    // Target is BELOW midY - go DOWN
    // 6. Corner: turn DOWN
    path += ` Q${leftX},${midY} ${leftX},${midY + r}`

    // 7. Line down to target Y
    path += ` L${leftX},${targetY - r}`

    // 8. Corner: turn RIGHT
    path += ` Q${leftX},${targetY} ${leftX + r},${targetY}`
  }

  // 9. Line right to target
  path += ` L${targetX},${targetY}`

  // Label position at the middle of the horizontal segment
  const labelX = (rightX + leftX) / 2
  const labelY = midY

  return {
    path,
    labelX,
    labelY,
  }
}

/**
 * Main function that chooses between forward and backward path generation.
 * Detects edge direction based on relative X positions of source and target.
 */
export function getAdaptiveEdgePath(params: EdgePathParams): EdgePathResult {
  const { sourceX, targetX } = params

  // Check if this is a backward edge (target is to the left of source)
  const isBackward = targetX < sourceX - EDGE_ROUTING.BACKWARD_THRESHOLD

  if (isBackward) {
    // Use S-shape path that always goes DOWN first, then LEFT, then UP to target
    return getBackwardEdgePath(params)
  }

  return getForwardEdgePath(params)
}
