// packages/lib/src/utils/rate-limiter/backoff-handler.ts

import type { RetryConfig } from './types'

/**
 * Exponential backoff handler for retrying failed operations
 */
export class ExponentialBackoff {
  private attempt: number = 0

  /**
   * Create a new exponential backoff handler
   * @param config - Retry configuration
   */
  constructor(private config: RetryConfig) {}

  /**
   * Execute a function with exponential backoff retry logic
   * @param fn - Function to execute
   * @param isRetryable - Optional custom function to determine if an error is retryable
   * @returns Result of the function
   */
  async executeWithRetry<T>(
    fn: () => Promise<T>,
    isRetryable?: (error: any) => boolean
  ): Promise<T> {
    this.attempt = 0

    while (this.attempt <= this.config.maxRetries) {
      try {
        return await fn()
      } catch (error) {
        if (!this.shouldRetry(error, isRetryable)) {
          throw error
        }

        if (this.attempt === this.config.maxRetries) {
          throw new Error(
            `Max retries (${this.config.maxRetries}) exceeded. Last error: ${
              error instanceof Error ? error.message : String(error)
            }`
          )
        }

        await this.wait()
        this.attempt++
      }
    }

    // This should never be reached, but TypeScript needs it
    throw new Error(`Max retries (${this.config.maxRetries}) exceeded`)
  }

  /**
   * Determine if an error is retryable
   * @param error - The error to check
   * @param customCheck - Optional custom check function
   * @returns true if the error is retryable
   */
  private shouldRetry(error: any, customCheck?: (error: any) => boolean): boolean {
    // Check if we've exceeded max retries
    if (this.attempt >= this.config.maxRetries) {
      return false
    }

    // Use custom check if provided
    if (customCheck) {
      return customCheck(error)
    }

    // Check for specific retryable error messages
    if (this.config.retryableErrors?.length) {
      const errorMessage = error?.message?.toLowerCase() || ''
      const errorCode = error?.code || ''
      
      for (const retryableError of this.config.retryableErrors) {
        if (
          errorMessage.includes(retryableError.toLowerCase()) ||
          errorCode === retryableError
        ) {
          return true
        }
      }
    }

    // Default checks for common rate limit errors
    const statusCode = error?.response?.status || error?.status || error?.statusCode
    const retryableCodes = [429, 503, 502, 504, 408]

    if (retryableCodes.includes(statusCode)) {
      return true
    }

    // Check for specific error messages that indicate rate limiting
    const errorMessage = error?.message?.toLowerCase() || ''
    const retryableMessages = [
      'rate limit',
      'quota exceeded',
      'too many requests',
      'throttled',
      'try again',
      'temporary',
      'unavailable',
      'timeout',
      'econnreset',
      'etimedout',
      'enotfound',
      'econnrefused',
    ]

    return retryableMessages.some((msg) => errorMessage.includes(msg))
  }

  /**
   * Wait for the calculated backoff time
   */
  private async wait(): Promise<void> {
    let delay = Math.min(
      this.config.initialDelay * Math.pow(this.config.backoffMultiplier, this.attempt),
      this.config.maxDelay
    )

    // Add jitter if enabled to prevent thundering herd
    if (this.config.jitter) {
      // Add random jitter between 0.5x and 1.5x the delay
      delay = delay * (0.5 + Math.random())
    }

    await new Promise((resolve) => setTimeout(resolve, delay))
  }

  /**
   * Get the current attempt number
   * @returns Current attempt number
   */
  getCurrentAttempt(): number {
    return this.attempt
  }

  /**
   * Reset the backoff handler
   */
  reset(): void {
    this.attempt = 0
  }

  /**
   * Calculate the next delay without waiting
   * @returns Next delay in milliseconds
   */
  getNextDelay(): number {
    let delay = Math.min(
      this.config.initialDelay * Math.pow(this.config.backoffMultiplier, this.attempt),
      this.config.maxDelay
    )

    if (this.config.jitter) {
      delay = delay * (0.5 + Math.random())
    }

    return delay
  }

  /**
   * Extract retry-after header from error response
   * @param error - The error object
   * @returns Retry-after value in milliseconds, or null if not found
   */
  static extractRetryAfter(error: any): number | null {
    const retryAfter =
      error?.response?.headers?.['retry-after'] ||
      error?.response?.headers?.['x-retry-after'] ||
      error?.retryAfter

    if (!retryAfter) {
      return null
    }

    // If it's a number, assume it's seconds
    const retryAfterNum = Number(retryAfter)
    if (!isNaN(retryAfterNum)) {
      return retryAfterNum * 1000
    }

    // If it's a date string, calculate the difference
    const retryAfterDate = new Date(retryAfter)
    if (!isNaN(retryAfterDate.getTime())) {
      const delay = retryAfterDate.getTime() - Date.now()
      return delay > 0 ? delay : null
    }

    return null
  }
}