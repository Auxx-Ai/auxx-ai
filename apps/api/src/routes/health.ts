// apps/api/src/routes/health.ts

import { database } from '@auxx/database'
import { Hono } from 'hono'
import { errorResponse, successResponse } from '../lib/response'

const health = new Hono()

/**
 * Health check endpoint
 * Returns API status and database connectivity
 */
health.get('/', async (c) => {
  try {
    // Check database connectivity
    await database.execute('SELECT 1')

    return c.json(
      successResponse({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        version: process.env.APP_VERSION || 'dev',
        sha: process.env.GIT_SHA?.slice(0, 7) || 'local',
        buildTime: process.env.BUILD_TIME || null,
        database: 'connected',
      })
    )
  } catch (_error) {
    return c.json(
      errorResponse('UNHEALTHY', 'Service unhealthy', {
        database: 'disconnected',
      }),
      503
    )
  }
})

export default health
