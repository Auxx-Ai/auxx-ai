// apps/web/src/components/workflow/edges/custom-edge/utils.ts

import { NodeRunningStatus } from '~/components/workflow/types'
import { EDGE_COLORS } from '../constants'

export const getEdgeColor = (status?: NodeRunningStatus, isErrorBranch = false): string => {
  // Error branch always shows red
  if (isErrorBranch) {
    return EDGE_COLORS.error
  }

  // Status-based colors
  switch (status) {
    case NodeRunningStatus.Running:
      return EDGE_COLORS.running
    case NodeRunningStatus.Succeeded:
      return EDGE_COLORS.succeeded
    case NodeRunningStatus.Failed:
      return EDGE_COLORS.failed
    case NodeRunningStatus.Exception:
      return EDGE_COLORS.exception
    default:
      return EDGE_COLORS.default
  }
}

export const shouldShowGradient = (
  sourceStatus?: NodeRunningStatus,
  targetStatus?: NodeRunningStatus
): boolean => {
  const hasSourceStatus =
    sourceStatus === NodeRunningStatus.Succeeded ||
    sourceStatus === NodeRunningStatus.Failed ||
    sourceStatus === NodeRunningStatus.Exception

  const hasTargetStatus =
    targetStatus === NodeRunningStatus.Succeeded ||
    targetStatus === NodeRunningStatus.Failed ||
    targetStatus === NodeRunningStatus.Exception ||
    targetStatus === NodeRunningStatus.Running

  return hasSourceStatus && hasTargetStatus
}
