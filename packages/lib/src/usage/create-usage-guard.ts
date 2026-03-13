// packages/lib/src/usage/create-usage-guard.ts

import type { Database } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { getRedisClient } from '@auxx/redis'
import { FeaturePermissionService } from '../permissions/feature-permission-service'
import { UsageCounter } from './usage-counter'
import { UsageGuard } from './usage-guard'

const logger = createScopedLogger('create-usage-guard')

/**
 * Creates a UsageGuard instance for consumption checks.
 * Returns null if Redis is unavailable (fail-open: allow the action).
 */
export async function createUsageGuard(db: Database): Promise<UsageGuard | null> {
  try {
    const redis = await getRedisClient(true)
    if (!redis) {
      logger.warn('Redis unavailable — usage guard skipped (fail-open)')
      return null
    }
    const featureService = new FeaturePermissionService(db)
    const counter = new UsageCounter(redis, db)
    return new UsageGuard(featureService, counter)
  } catch (error) {
    logger.warn('Failed to create usage guard — skipped (fail-open)', {
      error: (error as Error).message,
    })
    return null
  }
}
