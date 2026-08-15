// packages/lib/src/workflows/graph-edit/place-node.ts

/**
 * Incremental node placement (`03-graph-edit-service.md` §4) — pure, no DOM.
 *
 * A pared-down port of the pure parts of apps/web's
 * `components/workflow/utils/node-layout/{collision-detector,position-calculator}.ts`
 * — the collision search verbatim, the placement rules reduced to what
 * `addNode` needs. The web files were NOT moved (they also carry lane-shifting
 * and viewport logic the server must not run): §4's rule is that **existing
 * nodes never move** on an incremental add, so the collision search only ever
 * places the NEW node around them.
 *
 * Rules implemented:
 * - `after` with no siblings: one column right of the predecessor, vertically
 *   aligned to it.
 * - `after` with siblings (other targets of the same anchor — same handle
 *   first, any handle otherwise): aligned to the sibling column, stacked
 *   below the lowest sibling, so branch targets stack downward.
 * - `inside`: grid position within the container bounds (parent-relative
 *   coordinates), with a container-resize suggestion when the child overflows.
 * - `inputFor`: its own column to the LEFT of the node it feeds, existing
 *   inputs stacked downward (the input wiring runs backwards, so an input node
 *   is the one thing that never lands right of its anchor).
 * - no anchor: to the right of the whole graph.
 */

import { LAYOUT_SPACING, NODE_ADDITION_CONFIG } from './layout-constants'
import type { GraphEdge, GraphNode, Point } from './types'

/** Width/height pair for the node being placed. */
export interface Size {
  width: number
  height: number
}

/** The default footprint a node occupies before the canvas measures it. */
export const DEFAULT_NODE_SIZE: Size = {
  width: LAYOUT_SPACING.DEFAULT_NODE_WIDTH,
  height: LAYOUT_SPACING.DEFAULT_NODE_HEIGHT,
}

interface Bounds {
  x: number
  y: number
  width: number
  height: number
}

function nodeBounds(node: GraphNode): Bounds {
  return {
    x: node.position.x,
    y: node.position.y,
    width: node.width || LAYOUT_SPACING.DEFAULT_NODE_WIDTH,
    height: node.height || LAYOUT_SPACING.DEFAULT_NODE_HEIGHT,
  }
}

function boundsOverlap(a: Bounds, b: Bounds): boolean {
  const padding = NODE_ADDITION_CONFIG.COLLISION_PADDING
  return !(
    a.x + a.width + padding <= b.x ||
    b.x + b.width + padding <= a.x ||
    a.y + a.height + padding <= b.y ||
    b.y + b.height + padding <= a.y
  )
}

/** Whether a node of `size` at `position` would overlap any of `nodes`. */
export function isPositionOccupied(position: Point, size: Size, nodes: GraphNode[]): boolean {
  const candidate: Bounds = { x: position.x, y: position.y, ...size }
  return nodes.some((node) => boundsOverlap(candidate, nodeBounds(node)))
}

/**
 * Nearest collision-free position for a node of `size`, starting from
 * `preferred` and searching in `direction` — the web collision detector's
 * linear searches, verbatim. Falls back to far right when nothing frees up.
 */
export function findNearestEmptySpace(
  preferred: Point,
  size: Size,
  nodes: GraphNode[],
  direction: 'right' | 'down' | 'vertical' = 'vertical'
): Point {
  if (!isPositionOccupied(preferred, size, nodes)) return preferred

  const increment = NODE_ADDITION_CONFIG.POSITION_SEARCH_INCREMENTS
  const maxAttempts = NODE_ADDITION_CONFIG.MAX_POSITION_ATTEMPTS

  for (let i = 1; i <= maxAttempts; i++) {
    const candidates: Point[] =
      direction === 'right'
        ? [{ x: preferred.x + i * increment, y: preferred.y }]
        : direction === 'down'
          ? [{ x: preferred.x, y: preferred.y + i * increment }]
          : [
              { x: preferred.x, y: preferred.y + i * increment },
              { x: preferred.x, y: preferred.y - i * increment },
            ]
    for (const candidate of candidates) {
      if (!isPositionOccupied(candidate, size, nodes)) return candidate
    }
  }

  return { x: preferred.x + NODE_ADDITION_CONFIG.COLLISION_SEARCH_RADIUS, y: preferred.y }
}

/**
 * Position for a node added after `anchor`: one column right, vertically
 * aligned — unless the anchor already feeds other nodes, in which case the new
 * node joins their column below the lowest one (branch targets stack
 * downward). Nodes sharing the anchor's coordinate frame only: when the anchor
 * is a loop child (parent-relative coordinates), pass its siblings as `nodes`.
 */
export function placeAfter(
  anchor: GraphNode,
  sourceHandle: string,
  nodes: GraphNode[],
  edges: GraphEdge[],
  size: Size = DEFAULT_NODE_SIZE
): Point {
  const outgoing = edges.filter((e) => e.source === anchor.id)
  const sameHandle = outgoing.filter((e) => (e.sourceHandle ?? 'source') === sourceHandle)
  const siblingEdges = sameHandle.length > 0 ? sameHandle : outgoing
  const siblings = siblingEdges
    .map((e) => nodes.find((n) => n.id === e.target))
    .filter((n): n is GraphNode => n !== undefined && n.id !== anchor.id)

  if (siblings.length === 0) {
    const anchorWidth = anchor.width || LAYOUT_SPACING.DEFAULT_NODE_WIDTH
    const preferred: Point = {
      x: anchor.position.x + anchorWidth + NODE_ADDITION_CONFIG.HORIZONTAL_SPACING,
      y: anchor.position.y,
    }
    return findNearestEmptySpace(preferred, size, nodes, 'right')
  }

  const columnX = Math.min(...siblings.map((s) => s.position.x))
  const lowestBottom = Math.max(
    ...siblings.map((s) => s.position.y + (s.height || LAYOUT_SPACING.DEFAULT_NODE_HEIGHT))
  )
  const preferred: Point = {
    x: columnX,
    y: lowestBottom + NODE_ADDITION_CONFIG.VERTICAL_SPACING,
  }
  return findNearestEmptySpace(preferred, size, nodes, 'vertical')
}

/**
 * Geometry of the input column, read off the shipped `manual-ticket-triage`
 * template: the manual trigger sits at `(100, 300)` and its two form-inputs at
 * `(-200, 225)` and `(-200, 325)` — one column 300px left, fields 100px apart.
 */
const INPUT_COLUMN = { OFFSET_X: 300, STACK_SPACING: 100 }

/**
 * Position for an input node attaching to `target` (`form-input → manual`):
 * its own column `INPUT_COLUMN.OFFSET_X` to the LEFT of the target, the first
 * field vertically centered on it and every later field stacked
 * `INPUT_COLUMN.STACK_SPACING` below the lowest existing one.
 *
 * `existingInputs` are the nodes ALREADY wired into `target` on the input
 * handle. They never move (the §4 placement invariant), so the stack grows
 * downward from wherever it currently ends rather than re-centering — which is
 * also why this deliberately skips `findNearestEmptySpace`: the 100px step is
 * the rule, and the collision search (padding 20 against a 100px default
 * footprint) would push every second field out of the column it belongs to.
 */
export function placeAsInput(
  target: GraphNode,
  existingInputs: GraphNode[],
  size: Size = DEFAULT_NODE_SIZE
): Point {
  const x = target.position.x - INPUT_COLUMN.OFFSET_X
  if (existingInputs.length === 0) {
    const targetHeight = target.height || LAYOUT_SPACING.DEFAULT_NODE_HEIGHT
    return { x, y: target.position.y + (targetHeight - size.height) / 2 }
  }
  const lowest = Math.max(...existingInputs.map((n) => n.position.y))
  return { x, y: lowest + INPUT_COLUMN.STACK_SPACING }
}

/** What `placeInside` decides: a parent-relative position plus a resize ask. */
export interface InsidePlacement {
  position: Point
  requiresResize: boolean
  suggestedSize?: Size
}

/** Container inner padding — the position-calculator's values, verbatim. */
const CONTAINER_PADDING = { top: 80, right: 20, bottom: 20, left: 20 }
const CHILD_SPACING = { horizontal: 20, vertical: 20 }

/**
 * Position for a node added inside a container: the web position-calculator's
 * `inside` path, verbatim — first child centered under the header, later
 * children on the next free grid cell; coordinates are PARENT-RELATIVE (React
 * Flow child frames). Returns a container-resize suggestion when the child
 * lands outside the current bounds.
 */
export function placeInside(
  parent: GraphNode,
  children: GraphNode[],
  size: Size = DEFAULT_NODE_SIZE
): InsidePlacement {
  const parentWidth = parent.width || LAYOUT_SPACING.DEFAULT_NODE_WIDTH

  let position: Point
  if (children.length === 0) {
    position = {
      x: Math.max(CONTAINER_PADDING.left, (parentWidth - size.width) / 2),
      y: CONTAINER_PADDING.top,
    }
  } else {
    const availableWidth = parentWidth - CONTAINER_PADDING.left - CONTAINER_PADDING.right
    const maxColumns = Math.max(
      1,
      Math.floor(availableWidth / (size.width + CHILD_SPACING.horizontal))
    )
    const occupied = new Set(
      children.map((child) => {
        const col = Math.floor(
          (child.position.x - CONTAINER_PADDING.left) / (size.width + CHILD_SPACING.horizontal)
        )
        const row = Math.floor(
          (child.position.y - CONTAINER_PADDING.top) / (size.height + CHILD_SPACING.vertical)
        )
        return `${col},${row}`
      })
    )
    let row = 0
    let col = 0
    while (occupied.has(`${col},${row}`)) {
      col++
      if (col >= maxColumns) {
        col = 0
        row++
      }
    }
    position = {
      x: CONTAINER_PADDING.left + col * (size.width + CHILD_SPACING.horizontal),
      y: CONTAINER_PADDING.top + row * (size.height + CHILD_SPACING.vertical),
    }
  }

  let maxX = position.x + size.width
  let maxY = position.y + size.height
  for (const child of children) {
    maxX = Math.max(maxX, child.position.x + (child.width || LAYOUT_SPACING.DEFAULT_NODE_WIDTH))
    maxY = Math.max(maxY, child.position.y + (child.height || LAYOUT_SPACING.DEFAULT_NODE_HEIGHT))
  }
  const requiredWidth = maxX + CONTAINER_PADDING.right
  const requiredHeight = maxY + CONTAINER_PADDING.bottom
  const currentWidth = parent.width || LAYOUT_SPACING.DEFAULT_NODE_WIDTH
  const currentHeight = parent.height || LAYOUT_SPACING.DEFAULT_NODE_HEIGHT
  const requiresResize = requiredWidth > currentWidth || requiredHeight > currentHeight

  return {
    position,
    requiresResize,
    ...(requiresResize
      ? {
          suggestedSize: {
            width: Math.max(requiredWidth, currentWidth),
            height: Math.max(requiredHeight, currentHeight),
          },
        }
      : {}),
  }
}

/** Position for a node with no anchor: to the right of the whole graph. */
export function placeStandalone(nodes: GraphNode[], size: Size = DEFAULT_NODE_SIZE): Point {
  const topLevel = nodes.filter((n) => !n.parentId)
  if (topLevel.length === 0) return { x: 250, y: 250 }

  const rightmostX = Math.max(
    ...topLevel.map((n) => n.position.x + (n.width || LAYOUT_SPACING.DEFAULT_NODE_WIDTH))
  )
  const averageY = topLevel.reduce((sum, n) => sum + n.position.y, 0) / topLevel.length
  const preferred: Point = {
    x: rightmostX + NODE_ADDITION_CONFIG.HORIZONTAL_SPACING,
    y: averageY,
  }
  return findNearestEmptySpace(preferred, size, topLevel, 'right')
}
