// packages/lib/src/workflow-engine/types.ts
// This file exports only types and enums that are safe for frontend use

// Re-export shared types that are safe for frontend use
export { WorkflowEventType } from './shared/types'

// Content segment types (for end node rich content)
export type {
  ContentSegment,
  TextContentSegment,
  FileContentSegment,
  FileArrayContentSegment,
} from './types/content-segment'

// File variable types
export type { WorkflowFileData } from './types/file-variable'

export {
  NodeRunningStatus,
  WorkflowNodeType,
  BaseType,
  BASE_TYPE_GROUPS,
  WorkflowTriggerType,
  WorkflowExecutionStatus,
  type WorkflowNode,
  type WorkflowEdge,
  type Workflow,
  type NodeExecutionResult,
  type WorkflowExecutionResult,
  type ValidationResult,
  type WorkflowTriggerEvent,
  type WorkflowExecutionOptions,
} from './core/types'

// export { AI_NODE_CONSTANTS } from './constants'
