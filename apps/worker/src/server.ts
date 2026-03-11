// apps/worker/src/server.ts

import { getDevPort } from '@auxx/config/server'
import { configService } from '@auxx/credentials'
import { closePools } from '@auxx/database'
import { closeAllQueues, closeFlowProducer } from '@auxx/lib/jobs/queues'
import { serve } from '@hono/node-server'
import type { Worker } from 'bullmq'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { type InboundEmailPoller, startInboundEmailPoller } from './inbound-email'
import { devInboundEmailRoutes } from './inbound-email/dev-inbound-email'
/**
 * The apps/worker directory is responsible for running the worker processes.
 * It is responsible for processing jobs from the queues defined in the packages/lib/src/queues directory.
 *
 */
import { setupSchedules, startWorkers } from './workers'

// --- Declare variables needed outside the async function ---
let server: ReturnType<typeof serve> // Hono server type
let workersInstance: Worker[] // Use a different name to avoid conflict with the imported 'workers' module/namespace if any
let inboundEmailPoller: InboundEmailPoller | null = null

// --- Wrap async setup in an async function ---
async function initializeApp() {
  await configService.init()

  console.log('Setting up schedules...')
  await setupSchedules()
  console.log('Schedules configured.')

  console.log('Starting workers...')
  // Assign the result to the outer scope variable
  workersInstance = await startWorkers()
  console.log('Workers started.')

  inboundEmailPoller = startInboundEmailPoller()
  console.log(`Inbound email poller ${inboundEmailPoller ? 'started' : 'disabled'}.`)

  // Setup Hono App
  const app = new Hono()

  // Enable CORS for all routes
  app.use('*', cors())

  const port = getDevPort('worker')
  const host = '0.0.0.0'

  app.get('/health', (c) => {
    // You might want to add more checks here, e.g., worker health
    return c.json({
      status: 'OK',
      message: 'Workers are healthy',
      inboundEmail: inboundEmailPoller ? 'running' : 'disabled',
    })
  })

  if (process.env.NODE_ENV !== 'production') {
    app.route('', devInboundEmailRoutes)
    console.log('Dev inbound email endpoint enabled: POST /dev/inbound-email')
  }

  // Handle 404s - Should be after all other routes
  app.notFound((c) => {
    return c.json({ status: 'Not Found' }, 404)
  })

  // Error handler
  app.onError((err, c) => {
    console.error('Server error:', err)
    return c.json({ error: 'Internal Server Error' }, 500)
  })

  // Start the server and assign to the outer scope variable
  server = serve(
    {
      fetch: app.fetch,
      port,
      hostname: host,
    },
    (info) => {
      console.log(`Worker health check server running on http://${info.address}:${info.port}`)
    }
  )
}

// --- Graceful Shutdown Logic ---
// This needs access to 'server' and 'workersInstance', defined outside 'initializeApp'
const gracefulShutdown = async (signal: string) => {
  console.log(`Received ${signal}, closing workers and server...`)

  try {
    if (inboundEmailPoller) {
      console.log('Stopping inbound email poller...')
      await inboundEmailPoller.stop()
      console.log('Inbound email poller stopped.')
    }

    if (workersInstance) {
      // Close all workers gracefully
      console.log('Closing workers...')
      await Promise.all(Object.values(workersInstance).map((w) => w.close()))
      console.log('Workers closed.')
    } else {
      console.log('No worker instances to close.')
    }

    // Close FlowProducer
    console.log('Closing FlowProducer...')
    await closeFlowProducer()
    console.log('FlowProducer closed.')

    // Close all queues
    console.log('Closing queues...')
    await closeAllQueues()
    console.log('Queues closed.')

    // Close database connection pools
    console.log('Closing database pools...')
    await closePools()
    console.log('Database pools closed.')

    if (server) {
      server.close((err) => {
        if (err) {
          console.error('Error closing server:', err)
          process.exit(1) // Exit with error code
        } else {
          console.log('Server closed.')
          process.exit(0) // Exit gracefully
        }
      })
    } else {
      console.log('No server instance to close.')
      process.exit(0) // Exit gracefully if server wasn't started
    }

    // Force exit after a timeout if graceful shutdown hangs
    setTimeout(() => {
      console.error('Graceful shutdown timed out, forcing exit.')
      process.exit(1)
    }, 10000) // 10 seconds timeout for graceful shutdown
  } catch (err: unknown) {
    console.error('Error during graceful shutdown:', err)
    process.exit(1)
  }
}

// --- Process Event Handlers ---
// These should be attached outside the async function
process.on('SIGINT', () => gracefulShutdown('SIGINT'))
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'))

process.on('uncaughtException', (err) => {
  console.error('UNCAUGHT EXCEPTION:', err)
  // Consider a more robust shutdown here as well, or logging service integration
  // process.exit(1); // Optionally exit on uncaught exceptions
})

process.on('unhandledRejection', (reason, promise) => {
  console.error('UNHANDLED REJECTION:', reason, 'at promise:', promise)
  // Consider a more robust shutdown here as well
  // process.exit(1); // Optionally exit on unhandled rejections
})

// --- Start the application ---
// Call the async function and handle potential errors during initialization
initializeApp().catch((error) => {
  console.error('Failed to initialize the application:', error)
  process.exit(1) // Exit if initialization fails
})
