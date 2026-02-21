// packages/lib/src/health/types.ts

/** Health status for an indicator */
export enum HealthStatus {
  OPERATIONAL = 'OPERATIONAL',
  OUTAGE = 'OUTAGE',
}

/** Identifiers for each health indicator */
export type HealthIndicatorId = 'database' | 'redis' | 'worker' | 'jobs' | 'app'

/** Failure rate threshold (percent) — above this triggers OUTAGE */
export const FAILURE_RATE_THRESHOLD = 20

/** Timeout for each health check in milliseconds */
export const HEALTH_CHECK_TIMEOUT_MS = 3000

/** Summary of one indicator (used in overview) */
export interface HealthIndicatorSummary {
  id: HealthIndicatorId
  label: string
  status: HealthStatus
}

/** Full system health response (overview) */
export interface SystemHealth {
  services: HealthIndicatorSummary[]
}

/** Detail response for a single indicator */
export interface IndicatorHealth {
  id: HealthIndicatorId
  label: string
  description: string
  status: HealthStatus
  errorMessage: string | null
  details: Record<string, unknown> | null
  queues?: QueueHealth[]
}

/** Individual queue health (for worker indicator) */
export interface QueueHealth {
  queueName: string
  status: HealthStatus
  workers: number
  metrics: {
    failed: number
    completed: number
    waiting: number
    active: number
    delayed: number
    failureRate: number
  }
}

/** Time range options for queue metrics graph */
export type QueueMetricsTimeRange = '1H' | '4H' | '12H' | '1D' | '7D'

/** A single data point for queue metrics chart */
export interface QueueMetricsPoint {
  x: number
  y: number
}

/** A series (completed or failed) for queue metrics chart */
export interface QueueMetricsSeries {
  id: string
  data: QueueMetricsPoint[]
}

/** Full queue metrics response */
export interface QueueMetricsResponse {
  queueName: string
  workers: number
  timeRange: QueueMetricsTimeRange
  failed: number
  completed: number
  waiting: number
  active: number
  delayed: number
  failureRate: number
  data: QueueMetricsSeries[]
}

/** Indicator definition used by the orchestrator */
export interface HealthIndicatorDefinition {
  id: HealthIndicatorId
  label: string
  description: string
  check: () => Promise<{
    status: HealthStatus
    details: Record<string, unknown>
    queues?: QueueHealth[]
  }>
}

/** Error message constants */
export const HEALTH_ERROR_MESSAGES = {
  DATABASE_TIMEOUT: 'Database check timeout',
  DATABASE_CONNECTION_FAILED: 'Database connection failed',
  REDIS_TIMEOUT: 'Redis check timeout',
  REDIS_CONNECTION_FAILED: 'Redis connection failed',
  NO_ACTIVE_WORKERS: 'No active workers found',
  WORKER_TIMEOUT: 'Worker check timeout',
  WORKER_CHECK_FAILED: 'Worker check failed',
  JOB_HIGH_FAILURE_RATE: 'High failure rate in background jobs',
  JOB_CHECK_TIMEOUT: 'Job health check timeout',
} as const
