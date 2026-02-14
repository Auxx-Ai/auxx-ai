// packages/lib/src/workflow-engine/core/loop-error-handler.ts

import { createScopedLogger } from '@auxx/logger'

const logger = createScopedLogger('loop-error-handler')

/**
 * Error handling strategy for loop iterations
 */
export interface LoopErrorStrategy {
  continueOnError: boolean
  maxConsecutiveErrors: number
  errorAggregation: 'all' | 'first' | 'last' | 'summary'
  retryFailedIterations: boolean
  retryAttempts: number
  retryDelayMs: number
  logErrors: boolean
}

/**
 * Default error handling strategy
 */
export const DEFAULT_ERROR_STRATEGY: LoopErrorStrategy = {
  continueOnError: false,
  maxConsecutiveErrors: 3,
  errorAggregation: 'summary',
  retryFailedIterations: false,
  retryAttempts: 2,
  retryDelayMs: 100,
  logErrors: true,
}

/**
 * Error record for a loop iteration
 */
export interface IterationError {
  iteration: number
  error: Error
  timestamp: Date
  retryCount: number
  resolved: boolean
}

/**
 * Handles errors that occur during loop iterations
 */
export class LoopErrorHandler {
  private consecutiveErrors = 0
  private allErrors: IterationError[] = []
  private errorCounts = new Map<string, number>()

  constructor(private strategy: LoopErrorStrategy = DEFAULT_ERROR_STRATEGY) {}

  /**
   * Handle an error that occurred during a loop iteration
   */
  async handleIterationError(
    iteration: number,
    error: Error,
    retryFn: () => Promise<any>
  ): Promise<{ success: boolean; result?: any; error?: Error }> {
    // Record the error
    const iterationError: IterationError = {
      iteration,
      error,
      timestamp: new Date(),
      retryCount: 0,
      resolved: false,
    }

    this.allErrors.push(iterationError)
    this.incrementErrorCount(error)

    // Log the error if enabled
    if (this.strategy.logErrors) {
      logger.error('Loop iteration failed', {
        iteration,
        error: error.message,
        consecutiveErrors: this.consecutiveErrors + 1,
      })
    }

    // Check consecutive error limit
    this.consecutiveErrors++
    if (this.consecutiveErrors >= this.strategy.maxConsecutiveErrors) {
      throw new Error(
        `Loop aborted: ${this.consecutiveErrors} consecutive errors exceeded limit of ${this.strategy.maxConsecutiveErrors}`
      )
    }

    // Retry logic
    if (this.strategy.retryFailedIterations) {
      for (let attempt = 1; attempt <= this.strategy.retryAttempts; attempt++) {
        try {
          if (this.strategy.logErrors) {
            logger.info('Retrying failed iteration', { iteration, attempt })
          }

          const result = await retryFn()

          // Success - reset consecutive error counter
          this.consecutiveErrors = 0
          iterationError.resolved = true

          return { success: true, result }
        } catch (retryError) {
          iterationError.retryCount = attempt

          if (attempt === this.strategy.retryAttempts) {
            // Final retry failed
            if (!this.strategy.continueOnError) {
              throw retryError
            }

            // Continue with error
            return {
              success: false,
              error: retryError instanceof Error ? retryError : new Error(String(retryError)),
            }
          }

          // Wait before next retry with exponential backoff
          const delay = this.strategy.retryDelayMs * 2 ** (attempt - 1)
          await new Promise((resolve) => setTimeout(resolve, delay))
        }
      }
    }

    // No retry or retry disabled
    if (!this.strategy.continueOnError) {
      throw error
    }

    return { success: false, error }
  }

  /**
   * Reset consecutive error counter (called on successful iteration)
   */
  resetConsecutiveErrors(): void {
    this.consecutiveErrors = 0
  }

  /**
   * Get aggregated errors based on strategy
   */
  getAggregatedErrors(): any {
    switch (this.strategy.errorAggregation) {
      case 'all':
        return this.allErrors

      case 'first':
        return this.allErrors[0] || null

      case 'last':
        return this.allErrors[this.allErrors.length - 1] || null

      case 'summary':
      default:
        return this.getErrorSummary()
    }
  }

  /**
   * Get a summary of all errors
   */
  private getErrorSummary(): {
    totalErrors: number
    uniqueErrors: number
    errorTypes: Array<{ type: string; count: number; message: string }>
    failedIterations: number[]
    resolvedCount: number
  } {
    const errorTypes = Array.from(this.errorCounts.entries())
      .map(([message, count]) => ({
        type: this.getErrorType(message),
        count,
        message,
      }))
      .sort((a, b) => b.count - a.count)

    return {
      totalErrors: this.allErrors.length,
      uniqueErrors: this.errorCounts.size,
      errorTypes,
      failedIterations: this.allErrors.map((e) => e.iteration),
      resolvedCount: this.allErrors.filter((e) => e.resolved).length,
    }
  }

  /**
   * Increment error count for tracking
   */
  private incrementErrorCount(error: Error): void {
    const key = error.message
    this.errorCounts.set(key, (this.errorCounts.get(key) || 0) + 1)
  }

  /**
   * Extract error type from error message
   */
  private getErrorType(message: string): string {
    // Common error type patterns
    if (message.includes('TypeError')) return 'TypeError'
    if (message.includes('ReferenceError')) return 'ReferenceError'
    if (message.includes('SyntaxError')) return 'SyntaxError'
    if (message.includes('RangeError')) return 'RangeError'
    if (message.includes('timeout')) return 'TimeoutError'
    if (message.includes('memory')) return 'MemoryError'
    if (message.includes('network')) return 'NetworkError'

    return 'Error'
  }

  /**
   * Check if loop should continue based on error state
   */
  shouldContinue(): boolean {
    if (!this.strategy.continueOnError) {
      return false
    }

    return this.consecutiveErrors < this.strategy.maxConsecutiveErrors
  }

  /**
   * Get error statistics
   */
  getStatistics(): {
    totalIterations: number
    failedIterations: number
    successRate: number
    averageRetriesPerError: number
  } {
    const totalErrors = this.allErrors.length
    const totalRetries = this.allErrors.reduce((sum, e) => sum + e.retryCount, 0)
    const resolvedErrors = this.allErrors.filter((e) => e.resolved).length

    return {
      totalIterations: 0, // This should be passed in
      failedIterations: totalErrors - resolvedErrors,
      successRate: 0, // This should be calculated with total iterations
      averageRetriesPerError: totalErrors > 0 ? totalRetries / totalErrors : 0,
    }
  }

  /**
   * Clear all error records
   */
  reset(): void {
    this.consecutiveErrors = 0
    this.allErrors = []
    this.errorCounts.clear()
  }
}

/**
 * Create error handling strategy based on loop configuration
 */
export function createErrorStrategy(config: {
  continueOnError?: boolean
  maxErrors?: number
  retry?: boolean
  retryAttempts?: number
}): LoopErrorStrategy {
  return {
    ...DEFAULT_ERROR_STRATEGY,
    continueOnError: config.continueOnError ?? DEFAULT_ERROR_STRATEGY.continueOnError,
    maxConsecutiveErrors: config.maxErrors ?? DEFAULT_ERROR_STRATEGY.maxConsecutiveErrors,
    retryFailedIterations: config.retry ?? DEFAULT_ERROR_STRATEGY.retryFailedIterations,
    retryAttempts: config.retryAttempts ?? DEFAULT_ERROR_STRATEGY.retryAttempts,
  }
}
