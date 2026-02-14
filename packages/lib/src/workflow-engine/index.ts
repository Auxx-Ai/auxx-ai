// packages/lib/src/workflow-engine/index.ts

export { CredentialService, CredentialTestingService, CredentialValidator } from '@auxx/credentials'
// Constants
export * from './constants'
export { CancellationManager } from './core/cancellation-manager'
export { ContextMerger } from './core/context-merger'
export * from './core/errors'
export { ExecutionContextManager } from './core/execution-context'
export {
  ExecutionTrackingManager,
  type ExecutionTrackingState,
  type ForkContext,
} from './core/execution-tracking'
export { calculateTotalTokens } from './core/execution-utils'
export { JoinExecutionManager } from './core/join-execution-manager'
export { LoopExecutionManager, type NodeExecutionCallback } from './core/loop-execution-manager'
export { NodeProcessorRegistry } from './core/node-processor-registry'
export {
  executeSingleNode,
  type SingleNodeExecutionContext,
  type SingleNodeExecutionResult,
} from './core/single-node-executor'
export { type SaveStateOptions, StatePersistenceManager } from './core/state-persistence-manager'
// Core exports
export * from './core/types'
export { WorkflowEngine } from './core/workflow-engine'
// Graph exports - use the WorkflowGraph from workflow-graph-builder
export {
  type WorkflowGraph,
  WorkflowGraphBuilder,
  WorkflowGraphHelper,
} from './core/workflow-graph-builder'
// Execution functions
export { triggerManualResourceWorkflow } from './execution/trigger-manual-resource-workflow'
export {
  type BulkTriggerError,
  type BulkTriggerResponse,
  type ResourceTriggerResult,
  triggerManualResourceWorkflowBulk,
} from './execution/trigger-manual-resource-workflow-bulk'
export {
  CompositeWorkflowExecutionReporter,
  LoggingWorkflowExecutionReporter,
  NullWorkflowExecutionReporter,
  // WorkflowExecutionReporter,
  RedisWorkflowExecutionReporter,
  type WorkflowEvent as WorkflowEventGeneric,
} from './execution-reporter'
export { AIProcessor } from './nodes/action-nodes/ai'
export { AnswerProcessor } from './nodes/action-nodes/answer'
export { CodeProcessor } from './nodes/action-nodes/code'
export { ExecuteProcessor } from './nodes/action-nodes/execute'
export { VariableSetProcessor } from './nodes/action-nodes/variable-set'
// Base node processor
export { BaseNodeProcessor } from './nodes/base-node'
export { IfElseProcessor } from './nodes/condition-nodes/if-else'
export { EndProcessor } from './nodes/flow-nodes/end'
// Node processors
export { MessageReceivedProcessor } from './nodes/trigger-nodes/message-received'

// Query builder exports
export {
  BaseConditionBuilder,
  type ConditionGroup,
  ConditionQueryBuilder,
  EntityConditionBuilder,
  type EntityQueryContext,
  entityConditionBuilder,
  type GenericCondition,
  SystemConditionBuilder,
  systemConditionBuilder,
  type ValidationResult,
} from './query-builder'
export { ApprovalQueryService } from './services/approval-query-service'
export { ApprovalResponseService } from './services/approval-response-service'
// Shared exports (safe for frontend and backend)
export * from './shared/types'
// Content segment support (for end node rich content)
export type {
  ContentSegment,
  FileArrayContentSegment,
  FileContentSegment,
  TextContentSegment,
} from './types/content-segment'
export {
  extractFileData,
  isFileArrayVariableWrapper,
  isFileVariableWrapper,
  isWorkflowFileData,
  isWorkflowFileDataArray,
} from './types/content-segment'
// File reference support (for version locking)
export type { FileContentOptions, FileReference, FileSource } from './types/file-reference'
export {
  createFileReferenceFromUpload,
  isFileReference,
  isLegacyWorkflowFileData,
  isUrlExpired,
  toFileReference,
} from './types/file-reference'
// File variable support
export * from './types/file-variable'
// Resource reference support
export * from './types/resource-reference'

export { safeJsonStringify } from './utils'

// Removed ApprovalResponseService export to avoid circular dependency
// Import it directly from './services/approval-response-service' when needed

export type {
  GetResourceByIdInput,
  GetResourcesInput,
  PaginatedResourcesResult,
  RecordPickerItem,
} from '../resources/picker'
// Record picker service
export { RecordPickerService } from '../resources/picker'
// Rate limiting
export {
  type CheckWorkflowRateLimitOptions,
  checkWorkflowRateLimit,
  type RateLimitCheckResult,
  type WorkflowRateLimitConfig,
} from './rate-limit'
// Form input validation
export {
  extractFormInputConfigs,
  type FormInputConfig,
  type ValidationError as FormInputValidationError,
  type ValidationResult as FormInputValidationResult,
  validateFormInputs,
} from './validation'
