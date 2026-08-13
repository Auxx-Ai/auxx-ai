// apps/web/src/components/workflow/edges/custom-edge/utils.ts

import { NodeRunningStatus } from '~/components/workflow/types'
import { EDGE_COLORS } from '../constants'

/**
 * Colour an edge by the status of the node it feeds into.
 *
 * An edge carries whatever its target node is doing: it is "live" while that
 * node runs, green once it succeeded, pink once it failed. A target that the
 * run has not reached leaves the edge at the neutral default (dimmed by
 * `isUnreached`).
 */
export const getEdgeColor = (status?: NodeRunningStatus, isErrorBranch = false): string => {
  // Error branch always shows pink
  if (isErrorBranch) {
    return EDGE_COLORS.error
  }

  switch (status) {
    case NodeRunningStatus.Running:
      return EDGE_COLORS.running
    case NodeRunningStatus.Waiting:
    case NodeRunningStatus.Paused:
      return EDGE_COLORS.waiting
    case NodeRunningStatus.Succeeded:
      return EDGE_COLORS.succeeded
    case NodeRunningStatus.Failed:
    case NodeRunningStatus.Exception:
      return EDGE_COLORS.error
    default:
      return EDGE_COLORS.default
  }
}

/**
 * True while the target node is mid-flight — the edge draws a flowing dashed
 * line (running, or held at a wait / pause)
 */
export const isInFlight = (status?: NodeRunningStatus): boolean =>
  status === NodeRunningStatus.Running ||
  status === NodeRunningStatus.Waiting ||
  status === NodeRunningStatus.Paused

/**
 * True when the run never got to this edge's target — branch not taken, node
 * not reached yet, or the run stopped first. `undefined` means there is no run
 * in view at all, so the edge keeps its normal editor appearance.
 */
export const isUnreached = (status?: NodeRunningStatus): boolean =>
  status === NodeRunningStatus.Pending ||
  status === NodeRunningStatus.Skipped ||
  status === NodeRunningStatus.Stopped
