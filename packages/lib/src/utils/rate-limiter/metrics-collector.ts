// packages/lib/src/utils/rate-limiter/metrics-collector.ts

import { createScopedLogger } from '../../logger'
import type { ThrottlerMetrics } from './types'

/**
 * Metrics collector for monitoring rate limiting
 */
export class MetricsCollector {
  private counters = new Map<string, number>()
  private histograms = new Map<string, number[]>()
  private gauges = new Map<string, number>()
  private timestamps = new Map<string, number>()
  private logger = createScopedLogger('MetricsCollector')
  private providerMetrics = new Map<
    string,
    {
      requestsPerMinute: number
      errorRate: number
      avgResponseTime: number
      quotaUnitsConsumed: number
      lastUpdated: number
    }
  >()

  /**
   * Create a new metrics collector
   * @param enabled - Whether metrics collection is enabled
   */
  constructor(private enabled: boolean = false) {}

  /**
   * Record a successful request
   * @param context - Context/provider name
   * @param latencyMs - Request latency in milliseconds
   * @param quotaUnits - Quota units consumed (default: 1)
   */
  recordSuccess(context: string, latencyMs: number, quotaUnits: number = 1): void {
    if (!this.enabled) return

    this.incrementCounter(`${context}.success`)
    this.incrementCounter(`${context}.total`)
    this.recordLatency(`${context}.latency`, latencyMs)
    this.recordQuotaUsage(context, quotaUnits)
    this.updateProviderMetrics(context, { success: true, latency: latencyMs, quotaUnits })
  }

  /**
   * Record a failed request
   * @param context - Context/provider name
   * @param error - The error that occurred
   */
  recordFailure(context: string, error: any): void {
    if (!this.enabled) return

    this.incrementCounter(`${context}.failure`)
    this.incrementCounter(`${context}.total`)

    if (this.isRateLimitError(error)) {
      this.incrementCounter(`${context}.rate_limited`)
    }

    this.updateProviderMetrics(context, { success: false })
  }

  /**
   * Record a retried request
   * @param context - Context/provider name
   * @param attemptNumber - The attempt number
   */
  recordRetry(context: string, attemptNumber: number): void {
    if (!this.enabled) return

    this.incrementCounter(`${context}.retried`)
    this.recordValue(`${context}.retry_attempts`, attemptNumber)
  }

  /**
   * Record queue size
   * @param context - Context/provider name
   * @param size - Current queue size
   */
  recordQueueSize(context: string, size: number): void {
    if (!this.enabled) return

    this.setGauge(`${context}.queue_size`, size)
  }

  /**
   * Record available tokens
   * @param context - Context/provider name
   * @param tokens - Number of available tokens
   */
  recordAvailableTokens(context: string, tokens: number): void {
    if (!this.enabled) return

    this.setGauge(`${context}.tokens_available`, tokens)
  }

  /**
   * Record circuit breaker state
   * @param context - Context/provider name
   * @param state - Circuit breaker state
   */
  recordCircuitBreakerState(context: string, state: 'open' | 'closed' | 'half-open'): void {
    if (!this.enabled) return

    // Map state to numeric value for metrics
    const stateValue = state === 'open' ? 2 : state === 'half-open' ? 1 : 0
    this.setGauge(`${context}.circuit_breaker_state`, stateValue)
  }

  /**
   * Increment a counter
   * @param key - Counter key
   * @param value - Value to increment by (default: 1)
   */
  private incrementCounter(key: string, value: number = 1): void {
    const current = this.counters.get(key) || 0
    this.counters.set(key, current + value)
  }

  /**
   * Record a latency value
   * @param key - Histogram key
   * @param value - Latency value in milliseconds
   */
  private recordLatency(key: string, value: number): void {
    if (!this.histograms.has(key)) {
      this.histograms.set(key, [])
    }

    const histogram = this.histograms.get(key)!
    histogram.push(value)

    // Keep only last 1000 samples for memory efficiency
    if (histogram.length > 1000) {
      histogram.shift()
    }
  }

  /**
   * Record a generic value
   * @param key - Key for the value
   * @param value - The value to record
   */
  private recordValue(key: string, value: number): void {
    this.recordLatency(key, value) // Reuse histogram logic for now
  }

  /**
   * Set a gauge value
   * @param key - Gauge key
   * @param value - Gauge value
   */
  private setGauge(key: string, value: number): void {
    this.gauges.set(key, value)
  }

  /**
   * Record quota usage
   * @param context - Context/provider name
   * @param units - Number of quota units consumed
   */
  private recordQuotaUsage(context: string, units: number): void {
    const key = `${context}.quota_units`
    const current = this.counters.get(key) || 0
    this.counters.set(key, current + units)
  }

  /**
   * Update provider-specific metrics
   * @param context - Context/provider name
   * @param data - Metric data
   */
  private updateProviderMetrics(
    context: string,
    data: {
      success?: boolean
      latency?: number
      quotaUnits?: number
    }
  ): void {
    const now = Date.now()
    const existing = this.providerMetrics.get(context) || {
      requestsPerMinute: 0,
      errorRate: 0,
      avgResponseTime: 0,
      quotaUnitsConsumed: 0,
      lastUpdated: now,
    }

    // Update rolling metrics (simplified - in production, use proper time windows)
    const timeDiff = now - existing.lastUpdated
    if (timeDiff > 60000) {
      // Reset after 1 minute
      existing.requestsPerMinute = 0
      existing.lastUpdated = now
    }

    existing.requestsPerMinute++

    if (data.success !== undefined) {
      // Update error rate (simple moving average)
      const errorWeight = data.success ? 0 : 1
      existing.errorRate = existing.errorRate * 0.9 + errorWeight * 0.1
    }

    if (data.latency !== undefined) {
      // Update average response time (simple moving average)
      existing.avgResponseTime = existing.avgResponseTime * 0.9 + data.latency * 0.1
    }

    if (data.quotaUnits !== undefined) {
      existing.quotaUnitsConsumed += data.quotaUnits
    }

    this.providerMetrics.set(context, existing)
  }

  /**
   * Check if an error is a rate limit error
   * @param error - The error to check
   * @returns true if it's a rate limit error
   */
  private isRateLimitError(error: any): boolean {
    const statusCode = error?.response?.status || error?.status || error?.statusCode
    if (statusCode === 429) return true

    const errorMessage = error?.message?.toLowerCase() || ''
    const rateLimitMessages = ['rate limit', 'quota exceeded', 'too many requests', 'throttled']
    return rateLimitMessages.some((msg) => errorMessage.includes(msg))
  }

  /**
   * Calculate percentile from a list of values
   * @param values - Array of values
   * @param percentile - Percentile to calculate (0-100)
   * @returns The percentile value
   */
  private calculatePercentile(values: number[], percentile: number): number {
    if (values.length === 0) return 0

    const sorted = [...values].sort((a, b) => a - b)
    const index = Math.ceil((percentile / 100) * sorted.length) - 1
    return sorted[Math.max(0, index)] || 0
  }

  /**
   * Get metrics for a specific context or globally
   * @param context - Optional context to filter by
   * @returns Metrics object
   */
  getMetrics(context?: string): ThrottlerMetrics {
    const prefix = context || 'global'
    const latencies = this.histograms.get(`${prefix}.latency`) || []

    const circuitBreakerStates = new Map<string, 'open' | 'closed' | 'half-open'>()
    for (const [key, value] of Array.from(this.gauges.entries())) {
      if (key.endsWith('.circuit_breaker_state')) {
        const ctx = key.replace('.circuit_breaker_state', '')
        const state = value === 2 ? 'open' : value === 1 ? 'half-open' : 'closed'
        circuitBreakerStates.set(ctx, state)
      }
    }

    return {
      totalRequests: this.counters.get(`${prefix}.total`) || 0,
      successfulRequests: this.counters.get(`${prefix}.success`) || 0,
      rateLimitedRequests: this.counters.get(`${prefix}.rate_limited`) || 0,
      retriedRequests: this.counters.get(`${prefix}.retried`) || 0,
      failedRequests: this.counters.get(`${prefix}.failure`) || 0,

      averageWaitTime:
        latencies.length > 0 ? latencies.reduce((a, b) => a + b, 0) / latencies.length : 0,
      p50Latency: this.calculatePercentile(latencies, 50),
      p95Latency: this.calculatePercentile(latencies, 95),
      p99Latency: this.calculatePercentile(latencies, 99),

      currentQueueSize: this.gauges.get(`${prefix}.queue_size`) || 0,
      tokensAvailable: this.gauges.get(`${prefix}.tokens_available`) || 0,
      quotaUsagePercent: this.calculateQuotaUsagePercent(prefix),
      rateLimitHeadroom: this.calculateRateLimitHeadroom(prefix),

      circuitBreakerState: circuitBreakerStates,
      providerMetrics: this.providerMetrics,
    }
  }

  /**
   * Calculate quota usage percentage
   * @param context - Context/provider name
   * @returns Quota usage percentage
   */
  private calculateQuotaUsagePercent(context: string): number {
    const used = this.counters.get(`${context}.quota_units`) || 0
    // This would need to be configured based on actual quotas
    const quota = 1000000 // Example quota
    return (used / quota) * 100
  }

  /**
   * Calculate rate limit headroom
   * @param context - Context/provider name
   * @returns Rate limit headroom (0-100)
   */
  private calculateRateLimitHeadroom(context: string): number {
    const available = this.gauges.get(`${context}.tokens_available`) || 0
    const total = 100 // This would need to be configured
    return (available / total) * 100
  }

  /**
   * Report metrics to monitoring service
   */
  async report(): Promise<void> {
    if (!this.enabled) return

    const metrics = this.getMetrics()

    // Log critical metrics
    if (metrics.quotaUsagePercent > 80) {
      this.logger.warn('High quota usage detected', {
        usage: metrics.quotaUsagePercent,
        headroom: metrics.rateLimitHeadroom,
      })
    }

    if (metrics.errorRate > 0.1) {
      this.logger.warn('High error rate detected', {
        errorRate: metrics.errorRate,
        failedRequests: metrics.failedRequests,
      })
    }

    // Check error rate
    const errorRate = this.getErrorRate()
    if (errorRate > 0.1) {
      this.logger.warn('High error rate detected', {
        errorRate,
        failedRequests: metrics.failedRequests,
      })
    }

    // Here you would send to your monitoring service
    // await sendToDatadog(metrics);
    // await sendToCloudWatch(metrics);
    // await sendToPrometheus(metrics);
  }

  /**
   * Reset all metrics
   */
  reset(): void {
    this.counters.clear()
    this.histograms.clear()
    this.gauges.clear()
    this.timestamps.clear()
    this.providerMetrics.clear()
  }

  /**
   * Enable or disable metrics collection
   * @param enabled - Whether to enable metrics collection
   */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled
  }

  /**
   * Check if metrics collection is enabled
   * @returns true if metrics collection is enabled
   */
  isEnabled(): boolean {
    return this.enabled
  }

  /**
   * Export metrics in Prometheus format
   * @returns Prometheus-formatted metrics string
   */
  exportPrometheus(): string {
    const lines: string[] = []

    // Export counters
    for (const [key, value] of Array.from(this.counters.entries())) {
      const metricName = key.replace(/\./g, '_')
      lines.push(`# TYPE ${metricName} counter`)
      lines.push(`${metricName} ${value}`)
    }

    // Export gauges
    for (const [key, value] of Array.from(this.gauges.entries())) {
      const metricName = key.replace(/\./g, '_')
      lines.push(`# TYPE ${metricName} gauge`)
      lines.push(`${metricName} ${value}`)
    }

    // Export histograms
    for (const [key, values] of Array.from(this.histograms.entries())) {
      if (values.length === 0) continue
      const metricName = key.replace(/\./g, '_')
      lines.push(`# TYPE ${metricName} summary`)
      lines.push(`${metricName}_count ${values.length}`)
      lines.push(`${metricName}_sum ${values.reduce((a, b) => a + b, 0)}`)
      lines.push(`${metricName}{quantile="0.5"} ${this.calculatePercentile(values, 50)}`)
      lines.push(`${metricName}{quantile="0.95"} ${this.calculatePercentile(values, 95)}`)
      lines.push(`${metricName}{quantile="0.99"} ${this.calculatePercentile(values, 99)}`)
    }

    return lines.join('\n')
  }

  /**
   * Get error rate across all contexts
   */
  private getErrorRate(): number {
    const total = this.counters.get('global.total') || 0
    const failures = this.counters.get('global.failure') || 0
    return total > 0 ? failures / total : 0
  }
}
