// apps/api/src/middleware/cors.ts

import { getTrustedOrigins } from '@auxx/config/server'
import { configService } from '@auxx/credentials'
import { createScopedLogger } from '@auxx/logger'
import { cors } from 'hono/cors'

const log = createScopedLogger('cors')

const isDev = (process.env.NODE_ENV || 'development') === 'development'

function buildAllowedOrigins(): Set<string> {
  const origins = new Set(getTrustedOrigins())

  const extra = configService.get<string>('EXTRA_ALLOWED_ORIGINS')
  if (extra) {
    for (const o of extra.split(',')) {
      const trimmed = o.trim()
      if (trimmed) origins.add(trimmed)
    }
  }

  return origins
}

export const allowedOrigins = buildAllowedOrigins()

if (!isDev) {
  for (const origin of allowedOrigins) {
    if (origin.includes('localhost') || origin.includes('127.0.0.1')) {
      log.warn(
        `CORS origin "${origin}" contains localhost in non-development environment. ` +
          'Check that APP_URL and DOMAIN env vars are set.'
      )
    }
  }
}

/**
 * CORS middleware configuration.
 * Origins are derived from getTrustedOrigins() (WEBAPP_URL, DEV_PORTAL_URL, API_URL)
 * plus any extras from EXTRA_ALLOWED_ORIGINS env var.
 * Localhost is only allowed in development.
 */
export const corsMiddleware = cors({
  origin: (origin: string) => {
    if (!origin) return '*'
    if (allowedOrigins.has(origin)) return origin
    if (
      isDev &&
      (origin.startsWith('http://localhost:') || origin.startsWith('http://127.0.0.1:'))
    ) {
      return origin
    }
    return ''
  },
  allowHeaders: ['Content-Type', 'Authorization', 'X-Workflow-Passport'],
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  credentials: true,
  maxAge: 600,
})
