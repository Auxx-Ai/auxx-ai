// apps/api/src/routes/app-runtime.ts

import { Hono } from 'hono'
import { serveStatic } from '@hono/node-server/serve-static'
import { createScopedLogger } from '@auxx/logger'

const log = createScopedLogger('app-runtime')

/**
 * App Runtime Routes
 *
 * Serves the platform runtime files (index.html and platform.{HASH}.js)
 * that are loaded by all extensions in an iframe.
 *
 * These files are static and shared across ALL extensions for optimal caching.
 */
const app = new Hono()

// Serve static files from public/app-runtime directory
app.get(
  '/*',
  serveStatic({
    root: './public/app-runtime',
    rewriteRequestPath: (path) => {
      // Remove the /api/v1/app-runtime prefix to get the actual file path
      // e.g., /api/v1/app-runtime/index.html -> /index.html
      const rewritten = path.replace(/^\/api\/v1\/app-runtime/, '')
      log.info(`Serving: ${path} -> ${rewritten}`)
      return rewritten
    },
  })
)

export default app
