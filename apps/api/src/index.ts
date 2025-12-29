// apps/api/src/index.ts

import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { logger } from 'hono/logger'
import { prettyJSON } from 'hono/pretty-json'
import { createScopedLogger } from '@auxx/logger'
import { PORT, NODE_ENV, allowedOrigins } from './config'

// Middleware
import { corsMiddleware } from './middleware/cors'
import { errorMiddleware } from './middleware/error'

// Routes
import health from './routes/health'
import developers from './routes/developers'
import me from './routes/me'
import apps from './routes/apps'
import versions from './routes/versions'
import installations from './routes/installations'
import organizations from './routes/organizations'
import appRuntime from './routes/app-runtime'
import webhookHandlers from './routes/webhook-handlers'
import settings from './routes/settings'
import webhooks from './routes/webhooks'
import workflows from './routes/workflows'

const log = createScopedLogger('api-server')

/**
 * Auxx API Server
 * Provides RESTful endpoints for SDK and external clients
 */
const app = new Hono()

// Global middleware
app.use('*', logger())
app.use('*', corsMiddleware)
app.use('*', errorMiddleware)

// Pretty JSON in development
if (NODE_ENV === 'development') {
  app.use('*', prettyJSON())
}

// Root endpoint
app.get('/', (c) => {
  return c.json({
    name: 'Auxx API',
    version: '1.0.0',
    status: 'online',
    environment: NODE_ENV,
  })
})

// Mount routes
app.route('/health', health)
app.route('/api/v1/developers', developers)
app.route('/api/v1/me', me)
app.route('/api/v1/apps', apps)
app.route('/api/v1/apps', versions)
app.route('/api/v1/apps', installations)
app.route('/api/v1/organizations', organizations) // Organization-scoped routes (including bundles)
app.route('/api/v1/app-runtime', appRuntime) // Platform runtime files (shared by all extensions)
app.route('/api/v1/apps/webhooks', webhookHandlers) // For SDK calls from Lambda
app.route('/api/v1/apps/settings', settings) // For SDK settings calls from Lambda
app.route('/api/v1/workflows', workflows) // Workflow execution routes
app.route('/webhooks', webhooks) // Public webhook receiver (no /api/v1 prefix)

// 404 handler
app.notFound((c) => {
  return c.json(
    {
      success: false,
      error: {
        code: 'NOT_FOUND',
        message: 'Route not found',
      },
    },
    404
  )
})

// Start server
log.info(`Starting Auxx API server on port ${PORT}`)
log.info(`Environment: ${NODE_ENV}`)
log.info(`Allowed origins: ${allowedOrigins.join(', ')}`)

serve({
  fetch: app.fetch,
  port: PORT,
})

log.info(`✓ Auxx API server running at http://localhost:${PORT}`)
