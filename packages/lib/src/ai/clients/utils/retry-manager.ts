// packages/lib/src/ai/clients/utils/retry-manager.ts

import { createScopedLogger, type Logger } from '@auxx/logger'
import type { OperationContext } from '../base/types'
import type { CircuitBreaker } from './circuit-breaker'

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

        // Fail fast on permanent errors (auth, quota, bad request). Retrying
        // burns the full backoff schedule on something that can never succeed —
        // e.g. an OpenAI `insufficient_quota` 429 is a billing state, not a
        // transient rate limit.
        if (RetryManager.isNonRetryableError(error)) {
          this.logger.warn('Error is not retryable — aborting retries', {
            error: lastError.message,
            operation: context?.operation,
            model: context?.model,
          })
          break
        }

        // If this was the last attempt, don't delay
        if (attempt > maxRetries) {
          break
        }

        // Stop early if the circuit breaker opened during this run. Without
        // this, the remaining attempts keep hammering a dependency we already
        // know is failing — the breaker is otherwise only checked at entry.
        if (circuitBreaker && !circuitBreaker.canExecute()) {
          this.logger.warn('Circuit breaker opened mid-retry — aborting remaining attempts', {
            operation: context?.operation,
            model: context?.model,
          })
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
        delay = Math.min(this.config.baseDelay * 2 ** attempt, this.config.maxDelay)
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
   * Whether an error will never succeed on retry. These can share status codes
   * with transient failures (notably 429) but are permanent until an operator
   * intervenes: `insufficient_quota` (billing), auth failures, and 4xx client
   * errors other than 429 (the transient rate-limit signal we *do* retry).
   */
  static isNonRetryableError(error: any): boolean {
    const code = error?.code ?? error?.error?.code
    if (
      typeof code === 'string' &&
      ['insufficient_quota', 'invalid_api_key', 'account_deactivated'].includes(code)
    ) {
      return true
    }

    // 4xx client errors won't change on retry — except 429, which is the
    // transient rate-limit signal we want to back off and retry.
    const status = error?.status
    if (typeof status === 'number' && status >= 400 && status < 500 && status !== 429) {
      return true
    }

    return false
  }
}
