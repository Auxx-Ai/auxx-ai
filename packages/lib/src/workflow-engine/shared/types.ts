// packages/lib/src/workflow-engine/shared/types.ts
// This file contains types and enums that can be safely shared between frontend and backend

/**
 * Enum for all workflow event types using dash-case naming
 */
export enum WorkflowEventType {
  // Workflow lifecycle
  WORKFLOW_STARTED = 'workflow-started',
  WORKFLOW_FINISHED = 'workflow-finished',
  WORKFLOW_FAILED = 'workflow-failed',
  WORKFLOW_PAUSED = 'workflow-paused',
  WORKFLOW_RESUMED = 'workflow-resumed',
  WORKFLOW_CANCELLED = 'workflow-cancelled',
  WORKFLOW_STOPPED = 'workflow-stopped',

  // Node lifecycle
  NODE_STARTED = 'node-started',
  NODE_COMPLETED = 'node-completed',
  NODE_FAILED = 'node-failed',
  NODE_SKIPPED = 'node-skipped',
  NODE_PAUSED = 'node-paused',
  NODE_FINISHED = 'node-finished',

  // Loop lifecycle
  LOOP_STARTED = 'loop-started',
  LOOP_NEXT = 'loop-next',
  LOOP_COMPLETED = 'loop-completed',

  // Connection/Run
  CONNECTION_READY = 'connection-ready',
  CONNECTED = 'connected',
  RUN_CREATED = 'run-created',
  ERROR = 'error',
}
