// packages/lib/src/ai/clients/utils/circuit-breaker.ts

import { createScopedLogger, type Logger } from '@auxx/logger'

interface CircuitBreakerConfig {
  failureThreshold: number
  resetTimeout: number // milliseconds
  monitoringPeriod: number // milliseconds
}

export enum CircuitState {
  CLOSED = 'closed',
  OPEN = 'open',
  HALF_OPEN = 'half_open',
}

interface CircuitMetrics {
  failures: number
  successes: number
  requests: number
  lastFailureTime?: number
  lastSuccessTime?: number
}

export class CircuitBreaker {
  private state: CircuitState = CircuitState.CLOSED
  private metrics: CircuitMetrics = {
    failures: 0,
    successes: 0,
    requests: 0,
  }
  private lastStateChange = Date.now()
  private logger: Logger

  constructor(
    private config: CircuitBreakerConfig,
    private name: string = 'unknown'
  ) {
    this.logger = createScopedLogger(`CircuitBreaker:${name}`)
  }

  /**
   * Check if the circuit allows execution
   */
  canExecute(): boolean {
    const now = Date.now()

    switch (this.state) {
      case CircuitState.CLOSED:
        return true

      case CircuitState.OPEN:
        // Check if reset timeout has passed
        if (now - this.lastStateChange >= this.config.resetTimeout) {
          this.setState(CircuitState.HALF_OPEN)
          this.logger.info('Circuit breaker transitioning to half-open state')
          return true
        }
        return false

      case CircuitState.HALF_OPEN:
        return true

      default:
        return true
    }
  }

  /**
   * Record a successful operation
   */
  recordSuccess(): void {
    this.metrics.successes++
    this.metrics.requests++
    this.metrics.lastSuccessTime = Date.now()

    if (this.state === CircuitState.HALF_OPEN) {
      this.setState(CircuitState.CLOSED)
      this.resetMetrics()
      this.logger.info('Circuit breaker closed after successful test')
    }

    this.cleanupOldMetrics()
  }

  /**
   * Record a failed operation
   */
  recordFailure(): void {
    this.metrics.failures++
    this.metrics.requests++
    this.metrics.lastFailureTime = Date.now()

    // Calculate failure rate within monitoring period
    const failureRate = this.getFailureRate()

    if (this.state === CircuitState.CLOSED && failureRate >= this.config.failureThreshold) {
      this.setState(CircuitState.OPEN)
      this.logger.warn('Circuit breaker opened due to high failure rate', {
        failureRate,
        threshold: this.config.failureThreshold,
        failures: this.metrics.failures,
        requests: this.metrics.requests,
      })
    } else if (this.state === CircuitState.HALF_OPEN) {
      this.setState(CircuitState.OPEN)
      this.logger.warn('Circuit breaker reopened after test failure')
    }

    this.cleanupOldMetrics()
  }

  /**
   * Get current failure rate as a percentage
   */
  getFailureRate(): number {
    if (this.metrics.requests === 0) return 0
    return (this.metrics.failures / this.metrics.requests) * 100
  }

  /**
   * Get current circuit state
   */
  getState(): CircuitState {
    return this.state
  }

  /**
   * Get current metrics
   */
  getMetrics(): CircuitMetrics & { state: CircuitState; failureRate: number } {
    return {
      ...this.metrics,
      state: this.state,
      failureRate: this.getFailureRate(),
    }
  }

  /**
   * Force reset the circuit breaker
   */
  reset(): void {
    this.setState(CircuitState.CLOSED)
    this.resetMetrics()
    this.logger.info('Circuit breaker manually reset')
  }

  /**
   * Set the circuit state
   */
  private setState(newState: CircuitState): void {
    const oldState = this.state
    this.state = newState
    this.lastStateChange = Date.now()

    if (oldState !== newState) {
      this.logger.info('Circuit breaker state changed', {
        from: oldState,
        to: newState,
        metrics: this.getMetrics(),
      })
    }
  }

  /**
   * Reset metrics counters
   */
  private resetMetrics(): void {
    this.metrics = {
      failures: 0,
      successes: 0,
      requests: 0,
    }
  }

  /**
   * Clean up metrics older than monitoring period
   */
  private cleanupOldMetrics(): void {
    const now = Date.now()
    const monitoringCutoff = now - this.config.monitoringPeriod

    // Simple implementation - reset if last activity was outside monitoring period
    if (
      this.metrics.lastFailureTime &&
      this.metrics.lastSuccessTime &&
      Math.max(this.metrics.lastFailureTime, this.metrics.lastSuccessTime) < monitoringCutoff
    ) {
      this.resetMetrics()
    }
  }

  /**
   * Create a circuit breaker with default configuration
   */
  static createDefault(name?: string): CircuitBreaker {
    return new CircuitBreaker(
      {
        failureThreshold: 50, // 50% failure rate
        resetTimeout: 60000, // 1 minute
        monitoringPeriod: 300000, // 5 minutes
      },
      name
    )
  }
}
