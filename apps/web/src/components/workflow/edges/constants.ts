// apps/web/src/components/workflow/edges/constants.ts

export const ITERATION_CHILDREN_Z_INDEX = 1001
export const LOOP_CHILDREN_Z_INDEX = 1002

export const EDGE_STROKE_WIDTH = 2
export const EDGE_STROKE_WIDTH_HOVER = 3
export const EDGE_STROKE_WIDTH_SELECTED = 3

export const EDGE_ANIMATION_DURATION = 300

export const EDGE_COLORS = {
  default: '#94a3b8', // slate-400
  running: '#3b82f6', // blue-500
  succeeded: '#10b981', // emerald-500
  failed: '#ef4444', // red-500
  exception: '#f97316', // orange-500
  error: '#ec4899', // red-600
  hover: '#6366f1', // indigo-500
} as const

/**
 * Constants for adaptive edge routing (n8n-style)
 */
export const EDGE_ROUTING = {
  /** Minimum X offset before switching to backward routing */
  BACKWARD_THRESHOLD: 40,
  /** Radius for rounded corners in orthogonal paths */
  CORNER_RADIUS: 16,
  /** Offset from source/target handles before turning */
  HANDLE_OFFSET: 24,
  /** Vertical offset for routing around nodes (clearance below nodes) */
  VERTICAL_OFFSET: 150,
  /** Minimum segment length for bezier control points */
  MIN_SEGMENT_LENGTH: 20,
} as const
