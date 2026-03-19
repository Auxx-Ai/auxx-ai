// packages/lib/src/health/indicators/app.ts

import type { Database } from '@auxx/database'
import { sql } from 'drizzle-orm'
import { HealthStateManager } from '../state-manager'
import { HealthStatus } from '../types'

const stateManager = new HealthStateManager()

/**
 * Check application health — verifies DB connectivity and reports runtime info.
 */
export async function checkApp(db: Database) {
  try {
    const result = await db.execute(
      sql`SELECT count(*)::int AS count FROM "Organization" WHERE "demo_expires_at" IS NULL`
    )
    const orgCount = Number(result.rows[0]?.count ?? 0)

    const details = {
      system: {
        nodeVersion: process.version,
        timestamp: new Date().toISOString(),
        environment: process.env.NODE_ENV ?? 'unknown',
      },
      overview: {
        totalOrganizations: orgCount,
      },
    }

    stateManager.updateState(details)
    return { status: HealthStatus.OPERATIONAL, details }
  } catch {
    return {
      status: HealthStatus.OUTAGE,
      details: {
        error: 'Application health check failed',
        stateHistory: stateManager.getStateWithAge(),
      },
    }
  }
}
