// packages/lib/src/ai/errors/quota-errors.ts

/**
 * Custom error class for quota-related issues
 */
export class QuotaExceededError extends Error {
  /**
   * Creates a new QuotaExceededError
   * @param message - Error message describing the quota issue
   * @param provider - The provider that exceeded quota
   * @param quotaUsed - Current quota usage
   * @param quotaLimit - Maximum quota limit
   */
  constructor(
    message: string,
    public provider: string,
    public quotaUsed: number,
    public quotaLimit: number
  ) {
    super(message)
    this.name = 'QuotaExceededError'
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
  return new QuotaExceededError(message, provider, quotaUsed, quotaLimit)
}
