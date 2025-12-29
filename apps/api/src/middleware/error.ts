// apps/api/src/middleware/error.ts

import { createMiddleware } from 'hono/factory'
import { HTTPException } from 'hono/http-exception'
import { ZodError } from 'zod'
import { createScopedLogger } from '@auxx/logger'
import { errorResponse } from '../lib/response'

const logger = createScopedLogger('error-handler')

/**
 * Global error handling middleware
 * Catches all unhandled errors and returns standardized error responses
 */
export const errorMiddleware = createMiddleware(async (c, next) => {
  try {
    await next()
  } catch (error) {
    // Handle Hono HTTPException
    if (error instanceof HTTPException) {
      return c.json(
        errorResponse(error.status === 404 ? 'NOT_FOUND' : 'ERROR', error.message),
        error.status
      )
    }

    // Handle Zod validation errors
    if (error instanceof ZodError) {
      const messages = error.issues.map((e) => `${e.path.join('.')}: ${e.message}`)
      return c.json(
        errorResponse('VALIDATION_ERROR', 'Validation failed', { errors: messages }),
        400
      )
    }

    // Log unexpected errors
    logger.error('Unhandled error', {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    })

    // Return generic error
    return c.json(errorResponse('INTERNAL_ERROR', 'An unexpected error occurred'), 500)
  }
})
