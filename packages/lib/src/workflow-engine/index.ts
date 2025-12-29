// packages/lib/src/workflow-engine/index.ts

// Core exports
export * from './core/types'
export * from './core/errors'

// Shared exports (safe for frontend and backend)
export * from './shared/types'
export { ExecutionContextManager } from './core/execution-context'
export { WorkflowEngine } from './core/workflow-engine'
export { NodeProcessorRegistry } from './core/node-processor-registry'
export { JoinExecutionManager } from './core/join-execution-manager'
export { ContextMerger } from './core/context-merger'
export { CancellationManager } from './core/cancellation-manager'
export {
  ExecutionTrackingManager,
  type ExecutionTrackingState,
  type ForkContext,
} from './core/execution-tracking'
export { StatePersistenceManager, type SaveStateOptions } from './core/state-persistence-manager'
export { LoopExecutionManager, type NodeExecutionCallback } from './core/loop-execution-manager'
export {
  executeSingleNode,
  type SingleNodeExecutionContext,
  type SingleNodeExecutionResult,
} from './core/single-node-executor'
export { calculateTotalTokens } from './core/execution-utils'
export {
  // WorkflowExecutionReporter,
  RedisWorkflowExecutionReporter,
  NullWorkflowExecutionReporter,
  LoggingWorkflowExecutionReporter,
  CompositeWorkflowExecutionReporter,
  type WorkflowEvent as WorkflowEventGeneric,
} from './execution-reporter'

// Execution functions
export { triggerManualResourceWorkflow } from './execution/trigger-manual-resource-workflow'
export {
  triggerManualResourceWorkflowBulk,
  type BulkTriggerResponse,
  type ResourceTriggerResult,
  type BulkTriggerError,
} from './execution/trigger-manual-resource-workflow-bulk'

// Graph exports - use the WorkflowGraph from workflow-graph-builder
export {
  WorkflowGraphBuilder,
  WorkflowGraphHelper,
  type WorkflowGraph,
} from './core/workflow-graph-builder'

// Base node processor
export { BaseNodeProcessor } from './nodes/base-node'

// Node processors
export { MessageReceivedProcessor } from './nodes/trigger-nodes/message-received'
export { IfElseProcessor } from './nodes/condition-nodes/if-else'
export { ExecuteProcessor } from './nodes/action-nodes/execute'
export { CodeProcessor } from './nodes/action-nodes/code'
export { VariableSetProcessor } from './nodes/action-nodes/variable-set'
export { EndProcessor } from './nodes/flow-nodes/end'
export { AIProcessor } from './nodes/action-nodes/ai'
export { AnswerProcessor } from './nodes/action-nodes/answer'

// Constants
export * from './constants'

// Query builder exports
export {
  BaseConditionBuilder,
  SystemConditionBuilder,
  systemConditionBuilder,
  EntityConditionBuilder,
  entityConditionBuilder,
  ConditionQueryBuilder,
  type GenericCondition,
  type ConditionGroup,
  type ValidationResult,
  type EntityQueryContext,
} from './query-builder'

// File variable support
export * from './types/file-variable'

// Content segment support (for end node rich content)
export type {
  ContentSegment,
  TextContentSegment,
  FileContentSegment,
  FileArrayContentSegment,
} from './types/content-segment'
export {
  isWorkflowFileData,
  isWorkflowFileDataArray,
  isFileVariableWrapper,
  isFileArrayVariableWrapper,
  extractFileData,
} from './types/content-segment'

// File reference support (for version locking)
export type { FileReference, FileSource, FileContentOptions } from './types/file-reference'
export {
  isUrlExpired,
  isFileReference,
  isLegacyWorkflowFileData,
  toFileReference,
  createFileReferenceFromUpload,
} from './types/file-reference'

// Resource reference support
export * from './types/resource-reference'

export { CredentialService, CredentialValidator, CredentialTestingService } from '@auxx/credentials'

export { ApprovalQueryService } from './services/approval-query-service'
export { ApprovalResponseService } from './services/approval-response-service'

export { safeJsonStringify } from './utils'
// Removed ApprovalResponseService export to avoid circular dependency
// Import it directly from './services/approval-response-service' when needed

// Rate limiting
export {
  checkWorkflowRateLimit,
  type WorkflowRateLimitConfig,
  type CheckWorkflowRateLimitOptions,
  type RateLimitCheckResult,
} from './rate-limit'

// Form input validation
export {
  validateFormInputs,
  extractFormInputConfigs,
  type FormInputConfig,
  type ValidationError as FormInputValidationError,
  type ValidationResult as FormInputValidationResult,
} from './validation'

// Resource picker service
export { ResourcePickerService } from '../resources/picker'
export type {
  GetResourcesInput,
  ResourcePickerItem,
  PaginatedResourcesResult,
  GetResourceByIdInput,
} from '../resources/picker'
