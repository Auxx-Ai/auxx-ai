// apps/web/src/components/workflow/utils/execution-status.ts

import type { WorkflowNodeExecutionEntity } from '@auxx/database/types'
import { NodeRunningStatus } from '../types/node-base'

/**
 * The persisted `WorkflowNodeExecution.status` column is a narrower string union
 * than {@link NodeRunningStatus} (it has no `paused`), so map it explicitly
 * rather than asserting — the values are identical, only the types differ.
 */
const EXECUTION_STATUS_TO_NODE_STATUS: Record<
  WorkflowNodeExecutionEntity['status'],
  NodeRunningStatus
> = {
  pending: NodeRunningStatus.Pending,
  running: NodeRunningStatus.Running,
  succeeded: NodeRunningStatus.Succeeded,
  failed: NodeRunningStatus.Failed,
  exception: NodeRunningStatus.Exception,
  skipped: NodeRunningStatus.Skipped,
  stopped: NodeRunningStatus.Stopped,
  waiting: NodeRunningStatus.Waiting,
}

/** Convert a persisted execution status into the canvas' `NodeRunningStatus`. */
export function toNodeRunningStatus(
  status: WorkflowNodeExecutionEntity['status']
): NodeRunningStatus {
  return EXECUTION_STATUS_TO_NODE_STATUS[status]
}
