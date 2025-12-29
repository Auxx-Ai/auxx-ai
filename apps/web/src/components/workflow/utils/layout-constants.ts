// apps/web/src/components/workflow/hooks/layout-constants.ts

/**
 * Layout configuration constants for workflow organization
 */
export const LAYOUT_CONFIG = {
  // Main layout settings
  rankdir: 'LR' as const, // Left to Right
  align: 'UL' as const, // Upper Left alignment
  nodesep: 40, // Horizontal spacing between nodes
  ranksep: 60, // Vertical spacing between ranks
  ranker: 'tight-tree' as const, // Layout algorithm
  marginx: 30, // Horizontal margin
  marginy: 200, // Vertical margin
}

/**
 * Layout settings for container/grouped nodes
 */
export const CONTAINER_LAYOUT_CONFIG = {
  rankdir: 'LR' as const,
  align: 'UL' as const,
  nodesep: 40,
  ranksep: 60,
  marginx: 15, // Smaller margins for nested layouts
  marginy: 100,
}

/**
 * Spacing and sizing constants
 */
export const LAYOUT_SPACING = {
  NODE_HORIZONTAL_PADDING: 20,
  NODE_VERTICAL_PADDING: 20,
  MIN_DISTANCE: 50,
  DEFAULT_NODE_WIDTH: 244,
  DEFAULT_NODE_HEIGHT: 100,
  START_NODE_WIDTH: 44,
  START_NODE_HEIGHT: 48,
}

/**
 * Animation settings
 */
export const LAYOUT_ANIMATION = {
  DURATION: 300,
  EASING: 'ease-out' as const,
  VIEWPORT_ZOOM: 0.7,
  VIEWPORT_PADDING: 0.1,
}

/**
 * Node type classifications for layout
 */
export const NODE_CLASSIFICATIONS = {
  CONTAINER_TYPES: ['container', 'group', 'loop', 'iteration'],
  START_TYPES: ['start', 'trigger', 'loop-start', 'iteration-start'],
  END_TYPES: ['end', 'result', 'loop-end', 'iteration-end'],
}

/**
 * Node addition and positioning constants
 */
export const NODE_ADDITION_CONFIG = {
  // Spacing between nodes when adding
  HORIZONTAL_SPACING: 50,
  VERTICAL_SPACING: 50,

  // Collision detection
  COLLISION_PADDING: 20, // Minimum space between nodes
  COLLISION_SEARCH_RADIUS: 1000, // Max distance to search for empty space

  // Node shifting
  NODE_SHIFT_MARGIN: 100, // Extra margin when shifting nodes
  MIN_GAP_BETWEEN_NODES: 50, // Minimum gap to maintain

  // Smart positioning
  POSITION_SEARCH_INCREMENTS: 50, // Grid size for finding empty positions
  MAX_POSITION_ATTEMPTS: 20, // Max attempts to find empty space
}

/**
 * Type for resize parameters with direction
 */
export interface ResizeParamsWithDirection {
  x: number
  y: number
  width: number
  height: number
  direction?: string
}
