// packages/lib/src/health/health-service.ts

import type { Database } from '@auxx/database'
import { checkApp, checkDatabase, checkJobs, checkRedis, checkWorker } from './indicators'
import { withHealthCheckTimeout } from './timeout'
import {
  type HealthIndicatorDefinition,
  type HealthIndicatorId,
  HealthStatus,
  type IndicatorHealth,
  type SystemHealth,
} from './types'

/**
 * Builds the indicator definitions. Requires `db` from tRPC context.
 */
function buildIndicators(db: Database): Record<HealthIndicatorId, HealthIndicatorDefinition> {
  return {
    database: {
      id: 'database',
      label: 'Database',
      description: 'PostgreSQL connection and performance metrics',
      check: () => checkDatabase(db),
    },
    redis: {
      id: 'redis',
      label: 'Redis',
      description: 'Redis connection, memory, and performance',
      check: () => checkRedis(),
    },
    worker: {
      id: 'worker',
      label: 'Worker',
      description: 'BullMQ background job worker status',
      check: () => checkWorker(),
    },
    jobs: {
      id: 'jobs',
      label: 'Jobs',
      description: 'Background job health and failure rates',
      check: () => checkJobs(),
    },
    app: {
      id: 'app',
      label: 'App',
      description: 'Application runtime and connectivity',
      check: () => checkApp(db),
    },
  }
}

/**
 * Get system health overview — runs all indicators in parallel.
 */
export async function getSystemHealth(db: Database): Promise<SystemHealth> {
  const indicators = buildIndicators(db)
  const indicatorList = Object.values(indicators)

  const results = await Promise.allSettled(
    indicatorList.map(async (indicator) => {
      const result = await withHealthCheckTimeout(
        indicator.check(),
        `${indicator.label} check timeout`
      )
      return {
        id: indicator.id,
        label: indicator.label,
        status: result.status,
      }
    })
  )

  return {
    services: results.map((result, index) => {
      const indicator = indicatorList[index]!

      if (result.status === 'fulfilled') {
        return result.value
      }

      return {
        id: indicator.id,
        label: indicator.label,
        status: HealthStatus.OUTAGE,
      }
    }),
  }
}

/**
 * Get detailed health for a single indicator.
 */
export async function getIndicatorHealth(
  db: Database,
  indicatorId: HealthIndicatorId
): Promise<IndicatorHealth> {
  const indicators = buildIndicators(db)
  const indicator = indicators[indicatorId]

  if (!indicator) {
    throw new Error(`Unknown indicator: ${indicatorId}`)
  }

  try {
    const result = await withHealthCheckTimeout(
      indicator.check(),
      `${indicator.label} check timeout`
    )

    return {
      id: indicator.id,
      label: indicator.label,
      description: indicator.description,
      status: result.status,
      errorMessage: null,
      details: result.details,
      ...(result.queues && { queues: result.queues }),
    }
  } catch (error) {
    return {
      id: indicator.id,
      label: indicator.label,
      description: indicator.description,
      status: HealthStatus.OUTAGE,
      errorMessage: error instanceof Error ? error.message : 'Unknown error',
      details: null,
    }
  }
}
