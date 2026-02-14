// packages/lib/src/workflow-engine/events/types.ts

import { z } from 'zod'
import { WorkflowEventType } from '../shared/types'
import { NodeRunningStatus } from '../types'

// Re-export WorkflowEventType for convenience
export { WorkflowEventType }

// Base event schema that all events extend
const BaseEventSchema = z.object({
  event: z.string(),
  workflowRunId: z.string(),
  taskId: z.string().optional(),
  timestamp: z.string(),
})

// Node event data schemas
const NodeStartedDataSchema = z.object({
  id: z.string(),
  nodeId: z.string(),
  nodeType: z.string(),
  title: z.string(),
  index: z.number(),
  predecessorNodeId: z.string().nullable().optional(),
  inputs: z.record(z.string(), z.any()).optional(),
  createdAt: z.number(),
})

const NodeFinishedDataSchema = z.object({
  id: z.string(),
  nodeId: z.string(),
  nodeType: z.string(),
  title: z.string(),
  index: z.number(),
  predecessorNodeId: z.string().nullable().optional(),
  inputs: z.record(z.string(), z.any()).optional(),
  outputs: z.record(z.string(), z.any()).optional(),
  status: z.enum(NodeRunningStatus),
  error: z.string().nullable().optional(),
  elapsedTime: z.number().optional(),
  createdAt: z.number(),
  finishedAt: z.number(),
})

const NodeFailedDataSchema = z.object({
  id: z.string(),
  nodeId: z.string(),
  nodeType: z.string(),
  title: z.string(),
  index: z.number(),
  predecessorNodeId: z.string().nullable().optional(),
  inputs: z.record(z.string(), z.any()).optional(),
  status: z.literal(NodeRunningStatus.Failed),
  error: z.string(),
  errorSource: z.enum(['preprocessing', 'execution', 'validation', 'configuration']),
  errorMetadata: z.record(z.string(), z.any()).optional(),
  elapsedTime: z.number().optional(),
  createdAt: z.number(),
  failedAt: z.number(),
})

// Workflow event data schemas
const WorkflowStartedDataSchema = z.object({
  id: z.string(),
  workflowId: z.string(),
  inputs: z.record(z.string(), z.any()).optional(),
  createdAt: z.number(),
})

const WorkflowFinishedDataSchema = z.object({
  id: z.string(),
  workflowId: z.string(),
  status: z.enum(['succeeded', 'failed']),
  outputs: z.record(z.string(), z.any()).optional(),
  error: z.string().optional(),
  elapsedTime: z.number(),
  totalTokens: z.number(),
  totalSteps: z.number(),
  createdAt: z.number(),
  finishedAt: z.number(),
})

// Loop event data schemas
const LoopStartedDataSchema = z.object({
  loopId: z.string(),
  nodeId: z.string(),
  iterationCount: z.number(),
  items: z.array(z.any()).optional(),
})

const LoopNextDataSchema = z.object({
  loopId: z.string(),
  loopNodeId: z.string(),
  iterationIndex: z.number(),
  totalIterations: z.number(),
  item: z.any().optional(),
  variables: z.record(z.string(), z.any()).optional(),
})

const LoopCompletedDataSchema = z.object({
  loopId: z.string(),
  nodeId: z.string(),
  totalIterations: z.number(),
  outputs: z.record(z.string(), z.any()).optional(),
})

// Workflow lifecycle event schemas
const WorkflowFailedDataSchema = z.object({
  failedAt: z.date(),
  error: z.string(),
})

const WorkflowResumedDataSchema = z.object({
  fromNodeId: z.string(),
  resumedAt: z.date(),
  nodeOutput: z.any().optional(),
  resumeReason: z.string().optional(), // 'wait_completed', 'manual_approved', 'manual_denied', etc.
  previousPauseReason: z.string().optional(), // What caused the original pause
})

const WorkflowStoppedDataSchema = z.object({
  status: z.literal('stopped'),
  stoppedBy: z.string(),
  stoppedAt: z.number(),
  message: z.string(),
})

const WorkflowPausedDataSchema = z.object({
  nodeId: z.string(),
  reason: z.object({
    type: z.string(),
    message: z.string().optional(),
    metadata: z.record(z.string(), z.any()).optional(),
  }),
  pausedAt: z.date(),
})

const NodePausedDataSchema = z.object({
  nodeId: z.string(),
  reason: z.object({
    type: z.string(),
    message: z.string().optional(),
    metadata: z.record(z.string(), z.any()).optional(),
  }),
  pausedAt: z.date(),
  isTerminalPause: z.boolean().optional(),
})

// Connection event schema
const ConnectedDataSchema = z.object({
  runId: z.string(),
  timestamp: z.string(),
})

// Run created event schema
const RunCreatedDataSchema = z.object({
  id: z.string(),
  workflowId: z.string(),
  workflowAppId: z.string(),
  status: z.string(),
  inputs: z.record(z.string(), z.any()).optional(),
  createdAt: z.date(),
})

// Discriminated union of all workflow events
export const WorkflowEventSchema = z.discriminatedUnion('event', [
  BaseEventSchema.extend({
    event: z.literal(WorkflowEventType.CONNECTED),
    data: ConnectedDataSchema,
  }),
  BaseEventSchema.extend({
    event: z.literal(WorkflowEventType.RUN_CREATED),
    data: RunCreatedDataSchema,
  }),
  BaseEventSchema.extend({
    event: z.literal(WorkflowEventType.WORKFLOW_STARTED),
    data: WorkflowStartedDataSchema,
  }),
  BaseEventSchema.extend({
    event: z.literal(WorkflowEventType.WORKFLOW_FINISHED),
    data: WorkflowFinishedDataSchema,
  }),
  BaseEventSchema.extend({
    event: z.literal(WorkflowEventType.WORKFLOW_FAILED),
    data: WorkflowFailedDataSchema,
  }),
  BaseEventSchema.extend({
    event: z.literal(WorkflowEventType.WORKFLOW_RESUMED),
    data: WorkflowResumedDataSchema,
  }),
  BaseEventSchema.extend({
    event: z.literal(WorkflowEventType.WORKFLOW_STOPPED),
    data: WorkflowStoppedDataSchema,
  }),
  BaseEventSchema.extend({
    event: z.literal(WorkflowEventType.WORKFLOW_PAUSED),
    data: WorkflowPausedDataSchema,
  }),
  BaseEventSchema.extend({
    event: z.literal(WorkflowEventType.NODE_PAUSED),
    data: NodePausedDataSchema,
  }),
  BaseEventSchema.extend({
    event: z.literal(WorkflowEventType.NODE_STARTED),
    data: NodeStartedDataSchema,
  }),
  BaseEventSchema.extend({
    event: z.literal(WorkflowEventType.NODE_FINISHED),
    data: NodeFinishedDataSchema,
  }),
  BaseEventSchema.extend({
    event: z.literal(WorkflowEventType.NODE_FAILED),
    data: NodeFailedDataSchema,
  }),
  BaseEventSchema.extend({
    event: z.literal(WorkflowEventType.LOOP_STARTED),
    data: LoopStartedDataSchema,
  }),
  BaseEventSchema.extend({
    event: z.literal(WorkflowEventType.LOOP_NEXT),
    data: LoopNextDataSchema,
  }),
  BaseEventSchema.extend({
    event: z.literal(WorkflowEventType.LOOP_COMPLETED),
    data: LoopCompletedDataSchema,
  }),
])

// Export the inferred type
export type WorkflowEvent = z.infer<typeof WorkflowEventSchema>

// Export a generic type for workflow events
export interface WorkflowEventGeneric<T = any> {
  event: WorkflowEventType
  workflowRunId: string
  timestamp: string
  data: T
}

// Export individual event types for convenience
export type NodeStartedEvent = z.infer<
  typeof BaseEventSchema & {
    event: WorkflowEventType.NODE_STARTED
    data: z.infer<typeof NodeStartedDataSchema>
  }
>
export type NodeFinishedEvent = z.infer<
  typeof BaseEventSchema & {
    event: WorkflowEventType.NODE_FINISHED
    data: z.infer<typeof NodeFinishedDataSchema>
  }
>
export type NodeFailedEvent = z.infer<
  typeof BaseEventSchema & {
    event: WorkflowEventType.NODE_FAILED
    data: z.infer<typeof NodeFailedDataSchema>
  }
>
export type WorkflowStartedEvent = z.infer<
  typeof BaseEventSchema & {
    event: WorkflowEventType.WORKFLOW_STARTED
    data: z.infer<typeof WorkflowStartedDataSchema>
  }
>
export type WorkflowFinishedEvent = z.infer<
  typeof BaseEventSchema & {
    event: WorkflowEventType.WORKFLOW_FINISHED
    data: z.infer<typeof WorkflowFinishedDataSchema>
  }
>
export type LoopNextEvent = z.infer<
  typeof BaseEventSchema & {
    event: WorkflowEventType.LOOP_NEXT
    data: z.infer<typeof LoopNextDataSchema>
  }
>

// Export data schemas for reuse
export {
  NodeStartedDataSchema,
  NodeFinishedDataSchema,
  NodeFailedDataSchema,
  NodePausedDataSchema,
  WorkflowStartedDataSchema,
  WorkflowFinishedDataSchema,
  LoopStartedDataSchema,
  LoopNextDataSchema,
  LoopCompletedDataSchema,
  WorkflowFailedDataSchema,
  WorkflowResumedDataSchema,
  WorkflowStoppedDataSchema,
  WorkflowPausedDataSchema,
  ConnectedDataSchema,
  RunCreatedDataSchema,
}
