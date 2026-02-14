// packages/lib/src/workflow-engine/types.ts
// This file exports only types and enums that are safe for frontend use

export {
  BASE_TYPE_GROUPS,
  BaseType,
  isResourceTriggerType,
  type NodeExecutionResult,
  NodeRunningStatus,
  RESOURCE_OPERATION_TO_TRIGGER_TYPE,
  type ResourceTriggerOperation,
  type ValidationResult,
  type Workflow,
  type WorkflowEdge,
  type WorkflowExecutionOptions,
  type WorkflowExecutionResult,
  WorkflowExecutionStatus,
  type WorkflowNode,
  WorkflowNodeType,
  type WorkflowTriggerEvent,
  WorkflowTriggerType,
} from './core/types'
// Re-export shared types that are safe for frontend use
export { WorkflowEventType } from './shared/types'
// Content segment types (for end node rich content)
export type {
  ContentSegment,
  FileArrayContentSegment,
  FileContentSegment,
  TextContentSegment,
} from './types/content-segment'
// File variable types
export type { WorkflowFileData } from './types/file-variable'

// export { AI_NODE_CONSTANTS } from './constants'
