// packages/lib/src/ai/errors/quota-errors.ts

/**
 * Canonical error raised when an organization runs out of AI credits.
 * Thrown by LLMOrchestrator when both the monthly quota pool and the
 * bonus `creditsBalance` pool are exhausted.
 */
export class QuotaExceededError extends Error {
  public readonly quotaUsed: number
  public readonly quotaLimit: number
  public readonly bonusCredits: number
  public readonly resetsAt: Date | null
  public readonly provider: string

  constructor(
    message: string,
    details?: {
      provider?: string
      quotaUsed?: number
      quotaLimit?: number
      bonusCredits?: number
      resetsAt?: Date | null
    }
  ) {
    super(message)
    this.name = 'QuotaExceededError'
    this.provider = details?.provider ?? 'system'
    this.quotaUsed = details?.quotaUsed ?? 0
    this.quotaLimit = details?.quotaLimit ?? 0
    this.bonusCredits = details?.bonusCredits ?? 0
    this.resetsAt = details?.resetsAt ?? null
  }
}

/**
 * Custom error class for quota period expiration
 */
export class QuotaPeriodExpiredError extends Error {
  /**
   * Creates a new QuotaPeriodExpiredError
   * @param message - Error message describing the expiration
   * @param provider - The provider with expired quota period
   * @param periodEnd - When the quota period ended
   */
  constructor(
    message: string,
    public provider: string,
    public periodEnd: Date
  ) {
    super(message)
    this.name = 'QuotaPeriodExpiredError'
  }
}

/**
 * Custom error class for quota configuration issues
 */
export class QuotaConfigurationError extends Error {
  /**
   * Creates a new QuotaConfigurationError
   * @param message - Error message describing the configuration issue
   * @param provider - The provider with configuration issues
   * @param configField - The specific configuration field that failed
   */
  constructor(
    message: string,
    public provider: string,
    public configField?: string
  ) {
    super(message)
    this.name = 'QuotaConfigurationError'
  }
}

/**
 * Utility function to create appropriate quota error based on context
 * @param quotaCheck - Result from quota availability check
 * @param provider - The provider name
 * @param quotaUsed - Current quota usage
 * @param quotaLimit - Maximum quota limit
 * @returns QuotaExceededError - Appropriate error for the situation
 */
export function createQuotaError(
  quotaCheck: { available: boolean; reason?: string },
  provider: string,
  quotaUsed: number,
  quotaLimit: number
): QuotaExceededError {
  const message = quotaCheck.reason || 'Quota exceeded'
  return new QuotaExceededError(message, { provider, quotaUsed, quotaLimit })
}
