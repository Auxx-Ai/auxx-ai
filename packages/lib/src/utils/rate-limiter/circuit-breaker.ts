// packages/lib/src/utils/rate-limiter/circuit-breaker.ts

import { createScopedLogger } from '../../logger'
import type { CircuitBreakerConfig } from './types'
import { CircuitBreakerError } from './types'

/**
 * Circuit breaker implementation for fault tolerance
 */
export class CircuitBreaker {
  private state: 'closed' | 'open' | 'half-open' = 'closed'
  private failures = 0
  private successfulRequests = 0
  private lastFailureTime?: number
  private nextAttemptTime?: number
  private failureTimestamps: number[] = []
  private logger = createScopedLogger('CircuitBreaker')

  /**
   * Create a new circuit breaker
   * @param config - Circuit breaker configuration
   */
  constructor(private config: CircuitBreakerConfig) {}

  /**
   * Execute a function with circuit breaker protection
   * @param fn - Function to execute
   * @returns Result of the function
   */
  async execute<T>(fn: () => Promise<T>): Promise<T> {
    // Check if circuit breaker is open
    if (this.state === 'open') {
      if (Date.now() < (this.nextAttemptTime ?? 0)) {
        throw new CircuitBreakerError(
          `Circuit breaker is open. Retry after ${new Date(this.nextAttemptTime!).toISOString()}`,
          'open',
          new Date(this.nextAttemptTime!)
        )
      }
      // Try half-open state
      this.state = 'half-open'
      this.successfulRequests = 0
      this.logger.info('Circuit breaker entering half-open state')
    }

    try {
      const result = await fn()
      this.onSuccess()
      return result
    } catch (error) {
      this.onFailure()
      throw error
    }
  }

  /**
   * Handle successful execution
   */
  private onSuccess(): void {
    this.failures = 0

    if (this.state === 'half-open') {
      this.successfulRequests++
      if (this.successfulRequests >= this.config.halfOpenRequests) {
        this.state = 'closed'
        this.failureTimestamps = []
        this.logger.info('Circuit breaker closed after successful recovery')
      }
    } else if (this.state === 'closed') {
      // Clear old failure timestamps in closed state
      this.cleanupFailureTimestamps()
    }
  }

  /**
   * Handle failed execution
   */
  private onFailure(): void {
    const now = Date.now()
    this.failures++
    this.lastFailureTime = now
    this.failureTimestamps.push(now)

    // Clean up old timestamps if monitoring window is configured
    this.cleanupFailureTimestamps()

    // Check if we should open the circuit
    const shouldOpen = this.config.monitoringWindow
      ? this.failureTimestamps.length >= this.config.failureThreshold
      : this.failures >= this.config.failureThreshold

    if (shouldOpen) {
      this.state = 'open'
      this.nextAttemptTime = now + this.config.resetTimeout
      this.logger.warn(`Circuit breaker opened after ${this.failures} failures`, {
        nextAttemptTime: new Date(this.nextAttemptTime).toISOString(),
      })
    }

    // If we're in half-open state and we get a failure, immediately open
    if (this.state === 'half-open') {
      this.state = 'open'
      this.nextAttemptTime = now + this.config.resetTimeout
      this.logger.warn('Circuit breaker opened from half-open state after failure')
    }
  }

  /**
   * Clean up old failure timestamps outside the monitoring window
   */
  private cleanupFailureTimestamps(): void {
    if (!this.config.monitoringWindow) {
      return
    }

    const cutoff = Date.now() - this.config.monitoringWindow
    this.failureTimestamps = this.failureTimestamps.filter((ts) => ts > cutoff)
  }

  /**
   * Get the current state of the circuit breaker
   * @returns Current state
   */
  getState(): 'closed' | 'open' | 'half-open' {
    // Check if we should transition from open to half-open
    if (this.state === 'open' && Date.now() >= (this.nextAttemptTime ?? 0)) {
      return 'half-open'
    }
    return this.state
  }

  /**
   * Reset the circuit breaker to closed state
   */
  reset(): void {
    this.state = 'closed'
    this.failures = 0
    this.successfulRequests = 0
    this.failureTimestamps = []
    this.lastFailureTime = undefined
    this.nextAttemptTime = undefined
    this.logger.info('Circuit breaker manually reset')
  }

  /**
   * Force the circuit breaker to open state
   * @param duration - How long to keep the circuit open (ms)
   */
  trip(duration?: number): void {
    this.state = 'open'
    this.nextAttemptTime = Date.now() + (duration ?? this.config.resetTimeout)
    this.logger.warn('Circuit breaker manually tripped', {
      nextAttemptTime: new Date(this.nextAttemptTime).toISOString(),
    })
  }

  /**
   * Get circuit breaker statistics
   * @returns Statistics object
   */
  getStats(): {
    state: 'closed' | 'open' | 'half-open'
    failures: number
    successfulRequests: number
    lastFailureTime?: Date
    nextAttemptTime?: Date
    recentFailures: number
  } {
    return {
      state: this.getState(),
      failures: this.failures,
      successfulRequests: this.successfulRequests,
      lastFailureTime: this.lastFailureTime ? new Date(this.lastFailureTime) : undefined,
      nextAttemptTime: this.nextAttemptTime ? new Date(this.nextAttemptTime) : undefined,
      recentFailures: this.failureTimestamps.length,
    }
  }

  /**
   * Check if the circuit breaker allows execution
   * @returns true if execution is allowed
   */
  canExecute(): boolean {
    const state = this.getState()
    return state === 'closed' || state === 'half-open'
  }

  /**
   * Update configuration
   * @param config - New configuration
   */
  updateConfig(config: Partial<CircuitBreakerConfig>): void {
    this.config = { ...this.config, ...config }
  }
}
