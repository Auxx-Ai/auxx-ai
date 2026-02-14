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
        database: 'connected',
      })
    )
  } catch (error) {
    return c.json(
      errorResponse('UNHEALTHY', 'Service unhealthy', {
        database: 'disconnected',
      }),
      503
    )
  }
})

export default health
