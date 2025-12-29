// packages/lib/src/actions/utils/error-handling.ts

import { createScopedLogger } from '@auxx/logger'
import { ActionType, ActionResult, ActionContext } from '../core/action-types'

const logger = createScopedLogger('action-error-handling')

/**
 * Enhanced error handling utilities for the action system
 */

export enum ActionErrorType {
  VALIDATION_ERROR = 'VALIDATION_ERROR',
  CAPABILITY_ERROR = 'CAPABILITY_ERROR',
  EXECUTION_ERROR = 'EXECUTION_ERROR',
  PROVIDER_ERROR = 'PROVIDER_ERROR',
  TIMEOUT_ERROR = 'TIMEOUT_ERROR',
  RETRY_EXHAUSTED = 'RETRY_EXHAUSTED',
  DEPENDENCY_ERROR = 'DEPENDENCY_ERROR',
  CONFIGURATION_ERROR = 'CONFIGURATION_ERROR',
}

export interface ActionError extends Error {
  type: ActionErrorType
  actionType?: ActionType
  actionId?: string
  organizationId?: string
  messageId?: string
  threadId?: string
  providerType?: string
  retryable: boolean
  context?: any
  originalError?: Error
}

/**
 * Create a standardized action error
 */
export function createActionError(
  type: ActionErrorType,
  message: string,
  context?: {
    actionType?: ActionType
    actionId?: string
    organizationId?: string
    messageId?: string
    threadId?: string
    providerType?: string
    retryable?: boolean
    originalError?: Error
    additionalContext?: any
  }
): ActionError {
  const error = new Error(message) as ActionError
  error.type = type
  error.actionType = context?.actionType
  error.actionId = context?.actionId
  error.organizationId = context?.organizationId
  error.messageId = context?.messageId
  error.threadId = context?.threadId
  error.providerType = context?.providerType
  error.retryable = context?.retryable ?? false
  error.context = context?.additionalContext
  error.originalError = context?.originalError

  return error
}

/**
 * Enhanced error handler for action execution
 */
export class ActionErrorHandler {
  private retryStrategies: Map<ActionErrorType, RetryStrategy> = new Map()

  constructor() {
    this.setupDefaultRetryStrategies()
  }

  /**
   * Handle an action error and determine the appropriate response
   */
  async handleActionError(
    error: ActionError | Error,
    actionContext: ActionContext,
    actionType: ActionType,
    retryCount: number = 0
  ): Promise<{
    shouldRetry: boolean
    retryDelay: number
    fallbackAction?: ActionType
    errorResult: ActionResult
  }> {
    const actionError = this.normalizeError(error, actionContext, actionType)

    logger.error('Handling action error', {
      errorType: actionError.type,
      actionType: actionError.actionType,
      messageId: actionError.messageId,
      threadId: actionError.threadId,
      retryCount,
      retryable: actionError.retryable,
      organizationId: actionError.organizationId,
    })

    const retryStrategy = this.retryStrategies.get(actionError.type)
    const shouldRetry = this.shouldRetryError(actionError, retryCount, retryStrategy)
    const retryDelay = this.calculateRetryDelay(actionError, retryCount, retryStrategy)
    const fallbackAction = this.getFallbackAction(actionError)

    const errorResult: ActionResult = {
      actionId: actionError.actionId || `error-${Date.now()}`,
      actionType,
      success: false,
      error: actionError.message,
      executionTime: Date.now(),
      metadata: {
        errorType: actionError.type,
        retryCount,
        retryable: actionError.retryable,
        providerType: actionError.providerType,
        originalError: actionError.originalError?.message,
        context: actionError.context,
      },
    }

    return {
      shouldRetry,
      retryDelay,
      fallbackAction,
      errorResult,
    }
  }

  /**
   * Setup default retry strategies for different error types
   */
  private setupDefaultRetryStrategies(): void {
    this.retryStrategies.set(ActionErrorType.PROVIDER_ERROR, {
      maxRetries: 3,
      baseDelay: 1000,
      backoffMultiplier: 2,
      maxDelay: 30000,
    })

    this.retryStrategies.set(ActionErrorType.TIMEOUT_ERROR, {
      maxRetries: 2,
      baseDelay: 2000,
      backoffMultiplier: 1.5,
      maxDelay: 15000,
    })

    this.retryStrategies.set(ActionErrorType.EXECUTION_ERROR, {
      maxRetries: 1,
      baseDelay: 500,
      backoffMultiplier: 1,
      maxDelay: 1000,
    })

    this.retryStrategies.set(ActionErrorType.DEPENDENCY_ERROR, {
      maxRetries: 2,
      baseDelay: 1500,
      backoffMultiplier: 2,
      maxDelay: 10000,
    })

    // Non-retryable errors
    this.retryStrategies.set(ActionErrorType.VALIDATION_ERROR, {
      maxRetries: 0,
      baseDelay: 0,
      backoffMultiplier: 1,
      maxDelay: 0,
    })

    this.retryStrategies.set(ActionErrorType.CAPABILITY_ERROR, {
      maxRetries: 0,
      baseDelay: 0,
      backoffMultiplier: 1,
      maxDelay: 0,
    })

    this.retryStrategies.set(ActionErrorType.CONFIGURATION_ERROR, {
      maxRetries: 0,
      baseDelay: 0,
      backoffMultiplier: 1,
      maxDelay: 0,
    })
  }

  /**
   * Normalize any error to an ActionError
   */
  private normalizeError(
    error: ActionError | Error,
    context: ActionContext,
    actionType: ActionType
  ): ActionError {
    if (error instanceof Error && 'type' in error) {
      return error as ActionError
    }

    // Convert regular Error to ActionError
    // Schema change: Integration.provider is now the source of truth
    return createActionError(ActionErrorType.EXECUTION_ERROR, error.message, {
      actionType,
      organizationId: context.organizationId,
      messageId: context.message.id,
      threadId: context.message.threadId,
      providerType: context.integration?.provider || 'unknown',
      retryable: true,
      originalError: error,
    })
  }

  /**
   * Determine if an error should be retried
   */
  private shouldRetryError(
    error: ActionError,
    currentRetryCount: number,
    strategy?: RetryStrategy
  ): boolean {
    if (!error.retryable || !strategy) {
      return false
    }

    return currentRetryCount < strategy.maxRetries
  }

  /**
   * Calculate delay before retry using exponential backoff
   */
  private calculateRetryDelay(
    error: ActionError,
    retryCount: number,
    strategy?: RetryStrategy
  ): number {
    if (!strategy) {
      return 0
    }

    const exponentialDelay = strategy.baseDelay * Math.pow(strategy.backoffMultiplier, retryCount)
    return Math.min(exponentialDelay, strategy.maxDelay)
  }

  /**
   * Get fallback action for specific error types
   */
  private getFallbackAction(error: ActionError): ActionType | undefined {
    const fallbackMap: Partial<Record<ActionErrorType, Partial<Record<ActionType, ActionType>>>> = {
      [ActionErrorType.CAPABILITY_ERROR]: {
        [ActionType.APPLY_LABEL]: ActionType.APPLY_TAG,
        [ActionType.ARCHIVE]: ActionType.APPLY_TAG,
        [ActionType.MARK_SPAM]: ActionType.APPLY_TAG,
        [ActionType.FORWARD]: ActionType.SEND_MESSAGE,
      },
      [ActionErrorType.PROVIDER_ERROR]: {
        [ActionType.APPLY_LABEL]: ActionType.APPLY_TAG,
        [ActionType.REMOVE_LABEL]: ActionType.REMOVE_TAG,
      },
    }

    const actionFallbacks = fallbackMap[error.type]
    return actionFallbacks?.[error.actionType!]
  }

  /**
   * Register custom retry strategy for specific error type
   */
  registerRetryStrategy(errorType: ActionErrorType, strategy: RetryStrategy): void {
    this.retryStrategies.set(errorType, strategy)
    logger.debug('Registered custom retry strategy', {
      errorType,
      strategy,
    })
  }
}

interface RetryStrategy {
  maxRetries: number
  baseDelay: number
  backoffMultiplier: number
  maxDelay: number
}

/**
 * Circuit breaker for action execution
 */
export class ActionCircuitBreaker {
  private failures: Map<string, number> = new Map()
  private lastFailureTime: Map<string, number> = new Map()
  private circuitOpen: Map<string, boolean> = new Map()

  constructor(
    private failureThreshold: number = 5,
    private recoveryTimeout: number = 60000 // 1 minute
  ) {}

  /**
   * Check if circuit is open for a specific action/provider combination
   */
  isCircuitOpen(key: string): boolean {
    const isOpen = this.circuitOpen.get(key) || false

    if (isOpen) {
      const lastFailure = this.lastFailureTime.get(key) || 0
      const timeSinceLastFailure = Date.now() - lastFailure

      if (timeSinceLastFailure > this.recoveryTimeout) {
        // Try to recover
        this.circuitOpen.set(key, false)
        this.failures.set(key, 0)

        logger.info('Circuit breaker recovered', {
          key,
          timeSinceLastFailure,
        })

        return false
      }
    }

    return isOpen
  }

  /**
   * Record a failure for circuit breaker
   */
  recordFailure(key: string): void {
    const currentFailures = this.failures.get(key) || 0
    const newFailureCount = currentFailures + 1

    this.failures.set(key, newFailureCount)
    this.lastFailureTime.set(key, Date.now())

    if (newFailureCount >= this.failureThreshold) {
      this.circuitOpen.set(key, true)

      logger.warn('Circuit breaker opened', {
        key,
        failureCount: newFailureCount,
        threshold: this.failureThreshold,
      })
    }
  }

  /**
   * Record a success for circuit breaker
   */
  recordSuccess(key: string): void {
    this.failures.set(key, 0)
    this.circuitOpen.set(key, false)
  }

  /**
   * Get circuit breaker status
   */
  getStatus(key: string): {
    isOpen: boolean
    failureCount: number
    lastFailureTime: number | null
  } {
    return {
      isOpen: this.circuitOpen.get(key) || false,
      failureCount: this.failures.get(key) || 0,
      lastFailureTime: this.lastFailureTime.get(key) || null,
    }
  }
}

/**
 * Utility functions for error handling
 */

/**
 * Wrap an async function with error handling
 */
export function withErrorHandling<T extends any[], R>(
  fn: (...args: T) => Promise<R>,
  errorContext: {
    actionType: ActionType
    organizationId: string
    messageId?: string
    threadId?: string
  }
) {
  return async (...args: T): Promise<R> => {
    try {
      return await fn(...args)
    } catch (error) {
      const actionError = createActionError(
        ActionErrorType.EXECUTION_ERROR,
        error instanceof Error ? error.message : 'Unknown error',
        {
          ...errorContext,
          retryable: true,
          originalError: error instanceof Error ? error : undefined,
        }
      )

      logger.error('Function execution failed', {
        functionName: fn.name,
        error: actionError.message,
        context: errorContext,
      })

      throw actionError
    }
  }
}

/**
 * Create error result for failed actions
 */
export function createErrorResult(
  actionType: ActionType,
  error: ActionError | Error,
  actionId?: string
): ActionResult {
  const actionError =
    error instanceof Error && 'type' in error
      ? (error as ActionError)
      : createActionError(ActionErrorType.EXECUTION_ERROR, error.message)

  return {
    actionId: actionId || actionError.actionId || `error-${Date.now()}`,
    actionType,
    success: false,
    error: actionError.message,
    executionTime: Date.now(),
    metadata: {
      errorType: actionError.type,
      retryable: actionError.retryable,
      providerType: actionError.providerType,
      originalError: actionError.originalError?.message,
    },
  }
}

// Global error handler instance
export const globalActionErrorHandler = new ActionErrorHandler()
export const globalCircuitBreaker = new ActionCircuitBreaker()
