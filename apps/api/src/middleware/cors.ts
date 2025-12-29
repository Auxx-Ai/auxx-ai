// apps/api/src/middleware/cors.ts

import { cors } from 'hono/cors'
import { allowedOrigins } from '../config'

/**
 * CORS middleware configuration
 * Allows requests from specified origins with credentials
 */
export const corsMiddleware = cors({
  origin: (origin: string) => {
    // Allow requests with no origin (like mobile apps or curl)
    if (!origin) return '*'

    // Check if origin is in allowed list
    if (allowedOrigins.includes(origin)) return origin

    // Development: allow localhost on any port
    if (origin.startsWith('http://localhost:') || origin.startsWith('http://127.0.0.1:')) {
      return origin
    }

    // Reject other origins
    return ''
  },
  allowHeaders: ['Content-Type', 'Authorization', 'X-Workflow-Passport'],
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  credentials: true,
  maxAge: 600,
})
