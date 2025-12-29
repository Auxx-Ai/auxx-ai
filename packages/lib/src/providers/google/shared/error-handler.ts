// packages/lib/src/providers/google/shared/error-handler.ts
import { createScopedLogger } from '@auxx/logger'
import { RateLimitError, CircuitBreakerError } from '../../../utils/rate-limiter'
import type { Common } from 'googleapis'

type GaxiosError = Common.GaxiosError

const logger = createScopedLogger('google-error-handler')

/**
 * Standardized error handling for Gmail operations
 */
export async function handleGmailError(
  error: any,
  operation: string,
  integrationId: string
): Promise<never> {
  // Check for rate limiting errors
  if (error instanceof RateLimitError || error instanceof CircuitBreakerError) {
    logger.warn('Rate limit hit for Google provider', {
      operation,
      integrationId,
      retryAfter: error instanceof RateLimitError ? error.retryAfter : undefined,
    })
    throw error
  }

  const gaxiosError = error as GaxiosError

  // Check for authentication errors
  const isAuthError =
    gaxiosError.response?.status === 401 ||
    gaxiosError.message?.includes('invalid_grant') ||
    gaxiosError.message?.includes('unauthorized') ||
    gaxiosError.response?.data?.error === 'invalid_grant'

  if (isAuthError) {
    const { AuthErrorHandler } = await import('../../auth-error-handler')
    const errorHandler = new AuthErrorHandler('google', integrationId)
    const errorDetails = await errorHandler.handleAuthError(error, operation)
    throw new Error(`Gmail ${operation} failed: ${errorDetails.message}`)
  }

  // Log and re-throw other errors
  logger.error(`Gmail ${operation} error`, {
    message: gaxiosError.message,
    status: gaxiosError.response?.status,
    data: gaxiosError.response?.data,
    integrationId,
  })

  throw new Error(`Gmail ${operation} failed: ${gaxiosError.message}`)
}

/**
 * Check if error is recoverable
 */
export function isRecoverableError(error: any): boolean {
  if (error instanceof RateLimitError) return true
  if (error instanceof CircuitBreakerError) return false

  const gaxiosError = error as GaxiosError
  const status = gaxiosError.response?.status

  // Recoverable status codes
  return status === 429 || status === 503 || status === 500
}
