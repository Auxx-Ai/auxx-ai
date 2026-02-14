// packages/lib/src/utils/rate-limiter/token-bucket.ts

/**
 * Token bucket implementation for rate limiting
 * Used as a local fallback when Redis is unavailable
 */
export class TokenBucket {
  private tokens: number
  private lastRefill: number

  /**
   * Create a new token bucket
   * @param capacity - Maximum number of tokens in the bucket
   * @param refillRate - Number of tokens to add per millisecond
   */
  constructor(
    private capacity: number,
    private refillRate: number // tokens per ms
  ) {
    this.tokens = capacity
    this.lastRefill = Date.now()
  }

  /**
   * Try to acquire tokens from the bucket (non-blocking)
   * @param tokens - Number of tokens to acquire (default: 1)
   * @returns true if tokens were acquired, false otherwise
   */
  tryAcquire(tokens: number = 1): boolean {
    this.refill()

    if (this.tokens >= tokens) {
      this.tokens -= tokens
      return true
    }

    return false
  }

  /**
   * Acquire tokens from the bucket (blocking)
   * @param tokens - Number of tokens to acquire (default: 1)
   */
  async acquire(tokens: number = 1): Promise<void> {
    this.refill()

    while (this.tokens < tokens) {
      const waitTime = Math.ceil((tokens - this.tokens) / this.refillRate)
      await new Promise((resolve) => setTimeout(resolve, waitTime))
      this.refill()
    }

    this.tokens -= tokens
  }

  /**
   * Refill the bucket based on elapsed time
   */
  private refill(): void {
    const now = Date.now()
    const elapsed = now - this.lastRefill
    const tokensToAdd = elapsed * this.refillRate

    this.tokens = Math.min(this.capacity, this.tokens + tokensToAdd)
    this.lastRefill = now
  }

  /**
   * Get the number of available tokens
   * @returns Number of available tokens
   */
  getAvailableTokens(): number {
    this.refill()
    return Math.floor(this.tokens)
  }

  /**
   * Reset the bucket to full capacity
   */
  reset(): void {
    this.tokens = this.capacity
    this.lastRefill = Date.now()
  }

  /**
   * Get the current capacity
   * @returns Maximum number of tokens
   */
  getCapacity(): number {
    return this.capacity
  }

  /**
   * Get the refill rate
   * @returns Tokens per millisecond
   */
  getRefillRate(): number {
    return this.refillRate
  }

  /**
   * Update the capacity and refill rate
   * @param capacity - New maximum number of tokens
   * @param refillRate - New refill rate (tokens per ms)
   */
  updateConfig(capacity: number, refillRate: number): void {
    this.refill() // Refill before updating config
    this.capacity = capacity
    this.refillRate = refillRate
    // Don't exceed new capacity
    if (this.tokens > this.capacity) {
      this.tokens = this.capacity
    }
  }

  /**
   * Get time until enough tokens are available
   * @param tokens - Number of tokens needed
   * @returns Time in milliseconds until tokens are available, or 0 if available now
   */
  getWaitTime(tokens: number = 1): number {
    this.refill()

    if (this.tokens >= tokens) {
      return 0
    }

    const tokensNeeded = tokens - this.tokens
    return Math.ceil(tokensNeeded / this.refillRate)
  }
}
