// packages/lib/src/health/index.ts

export { getIndicatorHealth, getSystemHealth } from './health-service'
export { getQueueMetrics } from './queue-metrics'
export { HealthStateManager } from './state-manager'
export { withHealthCheckTimeout } from './timeout'
export {
  FAILURE_RATE_THRESHOLD,
  HEALTH_CHECK_TIMEOUT_MS,
  HEALTH_ERROR_MESSAGES,
  type HealthIndicatorDefinition,
  type HealthIndicatorId,
  type HealthIndicatorSummary,
  HealthStatus,
  type IndicatorHealth,
  type QueueHealth,
  type QueueMetricsPoint,
  type QueueMetricsResponse,
  type QueueMetricsSeries,
  type QueueMetricsTimeRange,
  type SystemHealth,
} from './types'
