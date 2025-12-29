// packages/lib/src/workflow-engine/core/errors.ts

/**
 * Source of the node error for better categorization and handling
 */
export enum NodeErrorSource {
  PREPROCESSING = 'preprocessing',
  EXECUTION = 'execution', 
  VALIDATION = 'validation',
  CONFIGURATION = 'configuration'
}

/**
 * Context information for node errors to provide detailed debugging information
 */
export interface NodeErrorContext {
  nodeId: string
  nodeType: string
  nodeName?: string
  errorSource: NodeErrorSource
  timestamp: Date
  metadata?: Record<string, any>
}

/**
 * Base class for all workflow node errors with standardized context
 */
export class WorkflowNodeError extends Error {
  constructor(
    message: string,
    public context: NodeErrorContext,
    public originalError?: Error
  ) {
    super(message)
    this.name = 'WorkflowNodeError'
  }
}

/**
 * Error that occurs during node preprocessing phase (before execution)
 * These are typically configuration or validation errors that prevent execution
 */
export class WorkflowNodeProcessingError extends WorkflowNodeError {
  constructor(
    message: string,
    nodeContext: Omit<NodeErrorContext, 'errorSource'>,
    originalError?: Error
  ) {
    super(message, { ...nodeContext, errorSource: NodeErrorSource.PREPROCESSING }, originalError)
    this.name = 'WorkflowNodeProcessingError'
  }
}

/**
 * Error that occurs during node execution phase (runtime errors)
 * These are typically runtime failures like network errors, API failures, etc.
 */
export class WorkflowNodeExecutionError extends WorkflowNodeError {
  constructor(
    message: string,
    nodeContext: Omit<NodeErrorContext, 'errorSource'>,
    originalError?: Error
  ) {
    super(message, { ...nodeContext, errorSource: NodeErrorSource.EXECUTION }, originalError)
    this.name = 'WorkflowNodeExecutionError'
  }
}

/**
 * Error that occurs during node validation phase
 * These are typically schema validation errors or business logic validation failures
 */
export class WorkflowNodeValidationError extends WorkflowNodeError {
  constructor(
    message: string,
    nodeContext: Omit<NodeErrorContext, 'errorSource'>,
    originalError?: Error
  ) {
    super(message, { ...nodeContext, errorSource: NodeErrorSource.VALIDATION }, originalError)
    this.name = 'WorkflowNodeValidationError'
  }
}

/**
 * Error that occurs due to node configuration issues
 * These are typically setup or configuration errors
 */
export class WorkflowNodeConfigurationError extends WorkflowNodeError {
  constructor(
    message: string,
    nodeContext: Omit<NodeErrorContext, 'errorSource'>,
    originalError?: Error
  ) {
    super(message, { ...nodeContext, errorSource: NodeErrorSource.CONFIGURATION }, originalError)
    this.name = 'WorkflowNodeConfigurationError'
  }
}