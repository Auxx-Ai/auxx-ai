// packages/lib/src/ai/clients/utils/retry-manager.ts

import { createScopedLogger, Logger } from '@auxx/logger'
import { CircuitBreaker } from './circuit-breaker'
import type { OperationContext } from '../base/types'

interface RetryConfig {
  maxAttempts: number
  backoffStrategy: 'exponential' | 'linear' | 'fixed'
  baseDelay: number
  maxDelay: number
}

interface RetryOptions {
  maxRetries: number
  backoffStrategy: 'exponential' | 'linear' | 'fixed'
  circuitBreaker?: CircuitBreaker
  context?: OperationContext
}

export class RetryManager {
  private logger: Logger

  constructor(private config: RetryConfig) {
    this.logger = createScopedLogger('RetryManager')
  }

  /**
   * Execute an operation with retry logic and optional circuit breaker
   */
  async execute<T>(operation: () => Promise<T>, options: RetryOptions): Promise<T> {
    const { maxRetries, backoffStrategy, circuitBreaker, context } = options
    let lastError: Error | undefined

    // Check circuit breaker if provided
    if (circuitBreaker && !circuitBreaker.canExecute()) {
      throw new Error('Circuit breaker is open - operation blocked')
    }

    for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
      try {
        this.logger.debug('Executing operation', {
          attempt,
          maxAttempts: maxRetries + 1,
          operation: context?.operation,
          model: context?.model,
        })

        const result = await operation()

        // Notify circuit breaker of success
        if (circuitBreaker) {
          circuitBreaker.recordSuccess()
        }

        if (attempt > 1) {
          this.logger.info('Operation succeeded after retry', {
            attempt,
            operation: context?.operation,
            model: context?.model,
          })
        }

        return result
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error))

        // Notify circuit breaker of failure
        if (circuitBreaker) {
          circuitBreaker.recordFailure()
        }

        this.logger.warn('Operation failed', {
          attempt,
          maxAttempts: maxRetries + 1,
          error: lastError.message,
          operation: context?.operation,
          model: context?.model,
        })

        // If this was the last attempt, don't delay
        if (attempt > maxRetries) {
          break
        }

        // Calculate delay for next retry
        const delay = this.calculateDelay(attempt - 1, backoffStrategy)

        this.logger.debug('Retrying operation after delay', {
          delay,
          nextAttempt: attempt + 1,
          operation: context?.operation,
        })

        await this.sleep(delay)
      }
    }

    // All retries exhausted, throw the last error
    this.logger.error('Operation failed after all retries', {
      maxAttempts: maxRetries + 1,
      finalError: lastError?.message,
      operation: context?.operation,
      model: context?.model,
    })

    throw lastError || new Error('Operation failed with unknown error')
  }

  /**
   * Calculate delay based on attempt and strategy
   */
  private calculateDelay(attempt: number, strategy: 'exponential' | 'linear' | 'fixed'): number {
    let delay: number

    switch (strategy) {
      case 'exponential':
        delay = Math.min(this.config.baseDelay * Math.pow(2, attempt), this.config.maxDelay)
        break
      case 'linear':
        delay = Math.min(this.config.baseDelay * (attempt + 1), this.config.maxDelay)
        break
      case 'fixed':
      default:
        delay = this.config.baseDelay
        break
    }

    // Add jitter to prevent thundering herd
    const jitter = Math.random() * 0.1 * delay
    return Math.floor(delay + jitter)
  }

  /**
   * Sleep for specified milliseconds
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }

  /**
   * Check if an error is retryable
   */
  static isRetryableError(error: any): boolean {
    // Network errors
    if (error.code === 'ENOTFOUND' || error.code === 'ECONNREFUSED') {
      return true
    }

    // HTTP status codes that are typically retryable
    const retryableStatusCodes = [429, 500, 502, 503, 504]
    if (error.status && retryableStatusCodes.includes(error.status)) {
      return true
    }

    // OpenAI specific retryable errors
    if (error.type === 'server_error' || error.type === 'timeout') {
      return true
    }

    // Rate limiting
    if (error.message?.includes('rate limit') || error.message?.includes('quota')) {
      return true
    }

    return false
  }
}
