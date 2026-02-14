import { createScopedLogger } from '@auxx/logger'
import { TRPCError } from '@trpc/server'

const logger = createScopedLogger('auth-errors')

export class ReauthenticationRequiredError extends Error {
  constructor(
    message = 'User re-authentication required',
    public provider = 'unknown'
  ) {
    super(message)
    this.name = 'ReauthenticationRequiredError'
  }
}

export class TokenRevokedError extends Error {
  constructor(
    message = 'Token already revoked or expired',
    public provider = 'unknown'
  ) {
    super(message)
    this.name = 'TokenRevokedError'
  }
}

/**
 * Detects if an error is related to authentication/credentials issues
 * with a third-party provider (Google, Outlook, etc.)
 *
 * @param error - The error object to check
 * @returns True if the error is an authentication error, false otherwise
 */
export function isAuthenticationError(error: any): boolean {
  try {
    // Check direct error message
    const errorMessage = error?.message || ''

    // Check error details from API responses
    const errorDetails = error?.response?.data?.error || {}
    const errorStatus = error?.response?.status

    // Google-specific error detection
    const googleAuthError =
      errorDetails?.reason === 'authError' ||
      errorMessage.includes('Invalid Credentials') ||
      errorDetails?.message?.includes('Invalid Credentials') ||
      errorMessage.includes('invalid_grant') ||
      errorDetails?.message?.includes('invalid_grant')

    // Outlook/Microsoft-specific error detection
    const outlookAuthError =
      errorMessage.includes('invalid_token') ||
      errorDetails?.error === 'invalid_token' ||
      errorMessage.includes('access_denied') ||
      errorDetails?.error === 'access_denied'

    // HTTP 401 Unauthorized response
    const isUnauthorizedResponse = errorStatus === 401

    return googleAuthError || outlookAuthError || isUnauthorizedResponse
  } catch (detectionError) {
    // If we get an error while trying to detect auth errors,
    // log it and return false to be safe
    logger.error('Error while detecting authentication error:', { detectionError })
    return false
  }
}

/**
 * Wraps an operation that interacts with a third-party API,
 * catching authentication errors and converting them to a standardized TRPC error.
 *
 * @param operation - The async function to execute
 * @param providerInfo - Information about the provider to include in the error
 * @returns The result of the operation
 * @throws TRPCError with UNAUTHORIZED code if authentication fails
 */
export async function withAuthErrorHandling<T>(
  operation: () => Promise<T>,
  providerInfo: { provider: string; integrationId: string }
): Promise<T> {
  try {
    return await operation()
  } catch (error) {
    if (isAuthenticationError(error)) {
      logger.warn('Authentication error detected:', {
        provider: providerInfo.provider,
        integrationId: providerInfo.integrationId,
        error,
      })

      throw new TRPCError({
        code: 'UNAUTHORIZED',
        message: 'Authentication required. Please re-connect your integration.',
        cause: {
          requiresReauthentication: true,
          provider: providerInfo.provider,
          integrationId: providerInfo.integrationId,
        },
      })
    }

    // Re-throw other errors
    throw error
  }
}
