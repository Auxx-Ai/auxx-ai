// packages/lib/src/ai/clients/base/base-specialized-client.ts

import { createScopedLogger, Logger } from '@auxx/logger'

import { RetryManager } from '../utils/retry-manager'
import { CircuitBreaker } from '../utils/circuit-breaker'
import type {
  ClientConfig,
  OperationContext,
  UsageMetrics,
  ModelValidationResult,
  ModelCapabilities,
  MultiModalContent,
} from './types'
import { DEFAULT_CLIENT_CONFIG } from './types'

/**
 * Abstract base class for all specialized AI clients
 * Provides common functionality like logging, retries, circuit breaking, and error handling
 */
export abstract class BaseSpecializedClient {
  protected logger: Logger
  protected retryManager: RetryManager
  protected circuitBreaker: CircuitBreaker

  constructor(
    protected config: ClientConfig,
    protected clientName: string,
    logger?: Logger
  ) {
    this.logger = logger || createScopedLogger(`BaseSpecializedClient:${clientName}`)
    this.retryManager = new RetryManager(config.retries)
    this.circuitBreaker = new CircuitBreaker(config.circuitBreaker, clientName)
  }

  // ===== ABSTRACT METHODS (must be implemented by each client) =====

  /**
   * Core invoke method - specific implementation varies by client type
   */
  abstract invoke(params: any): Promise<any> | AsyncGenerator<any>

  /**
   * Calculate number of tokens for given content (optional)
   * Implementations can provide accurate tokenization if available
   */
  getNumTokens?(content: string | MultiModalContent[], model?: string): number

  /**
   * Calculate usage metrics from response (optional)
   * Default implementation extracts standard usage fields
   */
  calcUsage?(response: any): UsageMetrics

  /**
   * Validate if model is supported (optional)
   */
  validateModel?(model: string): Promise<ModelValidationResult>

  /**
   * Get model capabilities (optional)
   */
  getModelCapabilities?(model: string): Promise<ModelCapabilities>

  // ===== PROTECTED HELPER METHODS =====

  /**
   * Execute operation with retry logic and circuit breaker
   */
  protected async withRetryAndCircuitBreaker<T>(
    operation: () => Promise<T>,
    context: OperationContext
  ): Promise<T> {
    return await this.retryManager.execute(operation, {
      maxRetries: this.config.retries.maxAttempts,
      backoffStrategy: this.config.retries.backoffStrategy,
      circuitBreaker: this.circuitBreaker,
      context,
    })
  }

  /**
   * Log operation start with context
   */
  protected logOperationStart(operation: string, context?: Record<string, any>): void {
    this.logger.debug(`Starting ${operation}`, {
      client: this.clientName,
      ...context,
    })
  }

  /**
   * Log operation success with metrics
   */
  protected logOperationSuccess(
    operation: string,
    duration: number,
    context?: Record<string, any>
  ): void {
    this.logger.info(`${operation} completed successfully`, {
      client: this.clientName,
      duration: `${duration}ms`,
      ...context,
    })
  }

  /**
   * Log operation error with details
   */
  protected logOperationError(
    operation: string,
    error: Error,
    context?: Record<string, any>
  ): void {
    this.logger.error(`${operation} failed`, {
      client: this.clientName,
      error: error.message,
      stack: error.stack,
      ...context,
    })
  }

  /**
   * Extract usage metrics from response
   */
  protected extractUsageMetrics(response: any): UsageMetrics {
    const usage = response.usage || response.meta?.usage || {}

    return {
      prompt_tokens: usage.prompt_tokens || usage.input_tokens || 0,
      completion_tokens: usage.completion_tokens || usage.output_tokens || 0,
      total_tokens:
        usage.total_tokens ||
        (usage.prompt_tokens || usage.input_tokens || 0) +
          (usage.completion_tokens || usage.output_tokens || 0),
    }
  }

  /**
   * Handle common API errors
   */
  protected handleApiError(error: any, operation: string): never {
    // Extract error details
    let errorMessage = 'Unknown error'
    let errorCode = 'UNKNOWN'

    if (error?.error?.message) {
      errorMessage = error.error.message
      errorCode = error.error.code || error.error.type || 'API_ERROR'
    } else if (error?.message) {
      errorMessage = error.message
      errorCode = error.code || error.type || 'CLIENT_ERROR'
    } else if (typeof error === 'string') {
      errorMessage = error
    }

    // Log the error
    this.logOperationError(operation, new Error(errorMessage), {
      errorCode,
      originalError: error,
    })

    // Throw standardized error
    const standardError = new Error(`${this.clientName} ${operation} failed: ${errorMessage}`)
    ;(standardError as any).code = errorCode
    ;(standardError as any).originalError = error

    throw standardError
  }

  /**
   * Validate required parameters
   */
  protected validateRequiredParams(params: any, required: string[]): void {
    for (const field of required) {
      if (params[field] === undefined || params[field] === null) {
        throw new Error(`Missing required parameter: ${field}`)
      }
    }
  }

  /**
   * Get current timestamp for metrics
   */
  protected getTimestamp(): number {
    return Date.now()
  }

  // ===== GETTERS =====

  /**
   * Get client name
   */
  getClientName(): string {
    return this.clientName
  }

  /**
   * Get circuit breaker state
   */
  getCircuitBreakerState() {
    return this.circuitBreaker.getState()
  }

  /**
   * Get circuit breaker metrics
   */
  getCircuitBreakerMetrics() {
    return this.circuitBreaker.getMetrics()
  }

  /**
   * Get retry configuration
   */
  getRetryConfig() {
    return this.config.retries
  }

  // ===== STATIC METHODS =====

  /**
   * Create default client configuration
   */
  static createDefaultConfig(): ClientConfig {
    return { ...DEFAULT_CLIENT_CONFIG }
  }

  /**
   * Merge configurations
   */
  static mergeConfig(base: ClientConfig, override: Partial<ClientConfig>): ClientConfig {
    return {
      retries: { ...base.retries, ...override.retries },
      circuitBreaker: { ...base.circuitBreaker, ...override.circuitBreaker },
      timeouts: { ...base.timeouts, ...override.timeouts },
    }
  }
}
