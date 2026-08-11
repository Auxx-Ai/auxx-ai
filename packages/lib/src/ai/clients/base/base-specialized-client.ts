// packages/lib/src/ai/clients/base/base-specialized-client.ts

import { createScopedLogger, type Logger } from '@auxx/logger'
import { CircuitBreaker } from '../utils/circuit-breaker'
import { RetryManager } from '../utils/retry-manager'
import type {
  ClientConfig,
  ModelCapabilities,
  ModelValidationResult,
  MultiModalContent,
  OperationContext,
  UsageMetrics,
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
   * Execute operation with retry logic, a circuit breaker and a TIMEOUT.
   *
   * ⚠️ The timeout is the reason this wrapper exists at all for hung providers.
   * `ClientConfig.timeouts` has carried sane values since it was written and
   * NOTHING read them, so every call ran to the SDK's own default — roughly ten
   * minutes — and a single unresponsive provider could pin a worker slot for
   * that long. Flagged in `05-mail-classification-plan.md` §12.6 as one of the
   * reasons transient failures hurt more than they should.
   *
   * ⚠️ The race does not ABORT the underlying HTTP request; the socket is left
   * to close on its own. That is a deliberate trade: threading an `AbortSignal`
   * through every provider SDK is a much larger change, and the harm being fixed
   * here is the blocked caller, not the idle socket.
   *
   * `timeoutMs` is per-operation because an LLM completion and an embedding have
   * nothing in common in how long they may honestly take — see
   * `ClientConfig.timeouts.completion`.
   */
  protected async withRetryAndCircuitBreaker<T>(
    operation: () => Promise<T>,
    context: OperationContext,
    opts: { timeoutMs?: number } = {}
  ): Promise<T> {
    const timeoutMs = Math.max(1_000, opts.timeoutMs ?? this.config.timeouts.request)

    // Wrapped INSIDE the retry, so each attempt gets its own budget rather than
    // the first slow attempt consuming the whole allowance.
    const withTimeout = async (): Promise<T> => {
      let timer: ReturnType<typeof setTimeout> | undefined
      try {
        return await Promise.race([
          operation(),
          new Promise<never>((_, reject) => {
            timer = setTimeout(
              () =>
                reject(
                  new Error(
                    `${this.clientName} ${context.operation} timed out after ${timeoutMs}ms`
                  )
                ),
              timeoutMs
            )
          }),
        ])
      } finally {
        // Without this the process keeps a live timer per call and a short
        // operation still waits out the full timeout before exiting.
        if (timer) clearTimeout(timer)
      }
    }

    return await this.retryManager.execute(withTimeout, {
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
