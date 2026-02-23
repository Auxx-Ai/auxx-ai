// apps/api/src/index.ts

import { configService } from '@auxx/credentials'
import { createScopedLogger } from '@auxx/logger'
import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { logger } from 'hono/logger'
import { prettyJSON } from 'hono/pretty-json'
import { allowedOrigins, NODE_ENV, PORT } from './config'

// Middleware
import { corsMiddleware } from './middleware/cors'
import { errorMiddleware } from './middleware/error'
import appRuntime from './routes/app-runtime'
import apps from './routes/apps'
import developers from './routes/developers'
// Routes
import health from './routes/health'
import installations from './routes/installations'
import me from './routes/me'
import organizations from './routes/organizations'
import settings from './routes/settings'
import versions from './routes/versions'
import webhookHandlers from './routes/webhook-handlers'
import webhooks from './routes/webhooks'
import workflows from './routes/workflows'

const log = createScopedLogger('api-server')

/**
 * Auxx API Server
 * Provides RESTful endpoints for SDK and external clients
 */
async function main() {
  await configService.init()

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

  const server = serve(
    {
      fetch: app.fetch,
      port: PORT,
    },
    (info) => {
      log.info(`✓ Auxx API server running at http://localhost:${info.port}`)
    }
  )

  server.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') {
      log.error(
        `Port ${PORT} is already in use. Check if another service is running on this port. ` +
          `Set API_PORT in your environment to use a different port.`
      )
    } else {
      log.error('Server error:', err)
    }
    process.exit(1)
  })
}

main().catch((error) => {
  log.error('Failed to start API server:', error)
  process.exit(1)
})
