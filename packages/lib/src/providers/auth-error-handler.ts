// ~/lib/src/providers/auth-error-handler.ts

import { database as db, schema } from '@auxx/database'
import { IntegrationAuthStatus } from '@auxx/database/enums'
import { createScopedLogger } from '@auxx/logger'
import { eq } from 'drizzle-orm'

const logger = createScopedLogger('auth-error-handler')
/**
 * Standardized authentication error types across all OAuth providers
 */
export enum AuthErrorType {
  INVALID_GRANT = 'invalid_grant',
  EXPIRED_TOKEN = 'expired_token',
  REVOKED_ACCESS = 'revoked_access',
  INSUFFICIENT_SCOPE = 'insufficient_scope',
  RATE_LIMITED = 'rate_limited',
  PROVIDER_ERROR = 'provider_error',
  NETWORK_ERROR = 'network_error',
  UNKNOWN_ERROR = 'unknown_error',
}
/**
 * Authentication error details
 */
export interface AuthErrorDetails {
  type: AuthErrorType
  message: string
  originalError?: any
  requiresReauth: boolean
  retryable: boolean
  providerId: string
  integrationId: string
}
/**
 * Standardized authentication error handler for all OAuth providers
 * Provides consistent error handling, logging, and database updates
 */
export class AuthErrorHandler {
  constructor(
    private providerId: string,
    private integrationId: string
  ) {}
  /**
   * Handle authentication errors consistently across providers
   */
  async handleAuthError(error: any, context: string = 'unknown'): Promise<AuthErrorDetails> {
    const errorDetails = this.parseError(error)
    // Log the FULL error with Google API response for debugging
    logger.error(`[${this.providerId}] Authentication error in ${context}`, {
      integrationId: this.integrationId,
      errorType: errorDetails.type,
      errorMessage: errorDetails.message,
      requiresReauth: errorDetails.requiresReauth,
      retryable: errorDetails.retryable,
      context,
      // Full error details for debugging
      httpStatus: error?.response?.status,
      googleError: error?.response?.data?.error,
      googleErrorDescription: error?.response?.data?.error_description,
      googleErrorSubtype: error?.response?.data?.error_subtype,
      stack: error?.stack?.split('\n').slice(0, 5).join('\n'),
    })
    // Update integration status in database
    await this.updateIntegrationStatus(errorDetails, error)
    // Trigger real-time notifications if needed
    await this.notifyAuthError(errorDetails)
    return errorDetails
  }
  /**
   * Parse provider-specific errors into standardized format
   */
  private parseError(error: any): AuthErrorDetails {
    const errorMessage = error?.message || error?.toString() || 'Unknown error'
    const errorCode = error?.code || error?.error || ''
    const responseData = error?.response?.data
    let type: AuthErrorType
    let requiresReauth = false
    let retryable = false
    // Google-specific error parsing
    if (this.providerId === 'google') {
      // Check for invalid_rapt specifically - this requires re-authentication
      // This can appear in the response data or in the error message
      const hasInvalidRapt =
        responseData?.error_subtype === 'invalid_rapt' ||
        responseData?.error_description?.includes('invalid_rapt') ||
        errorMessage.includes('invalid_rapt') ||
        errorMessage.includes('reauth related error')

      if (hasInvalidRapt) {
        type = AuthErrorType.INVALID_GRANT
        requiresReauth = true
        retryable = false
      } else if (
        errorMessage.includes('invalid_grant') ||
        errorCode === 'invalid_grant' ||
        responseData?.error === 'invalid_grant'
      ) {
        type = AuthErrorType.INVALID_GRANT
        requiresReauth = true
        retryable = false
      } else if (errorMessage.includes('unauthorized') || errorCode === 'unauthorized') {
        type = AuthErrorType.REVOKED_ACCESS
        requiresReauth = true
        retryable = false
      } else if (errorMessage.includes('expired') || errorCode === 'expired_token') {
        type = AuthErrorType.EXPIRED_TOKEN
        requiresReauth = false
        retryable = true
      } else if (errorMessage.includes('insufficient_scope')) {
        type = AuthErrorType.INSUFFICIENT_SCOPE
        requiresReauth = true
        retryable = false
      } else if (errorMessage.includes('rate_limit') || errorCode === 'rate_limit_exceeded') {
        type = AuthErrorType.RATE_LIMITED
        requiresReauth = false
        retryable = true
      } else {
        type = AuthErrorType.PROVIDER_ERROR
        requiresReauth = false
        retryable = true
      }
    }
    // Outlook-specific error parsing
    else if (this.providerId === 'outlook') {
      if (errorMessage.includes('invalid_grant') || errorCode === 'invalid_grant') {
        type = AuthErrorType.INVALID_GRANT
        requiresReauth = true
        retryable = false
      } else if (errorMessage.includes('unauthorized') || errorCode === 'unauthorized') {
        type = AuthErrorType.REVOKED_ACCESS
        requiresReauth = true
        retryable = false
      } else if (errorMessage.includes('token_expired')) {
        type = AuthErrorType.EXPIRED_TOKEN
        requiresReauth = false
        retryable = true
      } else {
        type = AuthErrorType.PROVIDER_ERROR
        requiresReauth = false
        retryable = true
      }
    }
    // Generic error handling for other providers
    else {
      if (errorMessage.includes('network') || errorMessage.includes('timeout')) {
        type = AuthErrorType.NETWORK_ERROR
        requiresReauth = false
        retryable = true
      } else {
        type = AuthErrorType.UNKNOWN_ERROR
        requiresReauth = false
        retryable = true
      }
    }
    return {
      type,
      message: errorMessage,
      originalError: error,
      requiresReauth,
      retryable,
      providerId: this.providerId,
      integrationId: this.integrationId,
    }
  }
  /** Threshold for consecutive failures before disabling integration */
  private static readonly DISABLE_THRESHOLD = 3

  /**
   * Update integration status in database
   */
  private async updateIntegrationStatus(
    errorDetails: AuthErrorDetails,
    originalError?: any
  ): Promise<void> {
    try {
      const currentMetadata = await this.getCurrentMetadata()
      const currentFailureCount = currentMetadata?.auth?.consecutiveFailures || 0
      const newFailureCount = currentFailureCount + 1

      logger.info(`[${this.providerId}] Current metadata before update`, {
        integrationId: this.integrationId,
        currentFailureCount,
        newFailureCount,
        disableThreshold: AuthErrorHandler.DISABLE_THRESHOLD,
      })

      const newAuthData = {
        lastError: errorDetails.message,
        lastErrorAt: new Date().toISOString(),
        requiresReauth: errorDetails.requiresReauth,
        type: errorDetails.type,
        retryable: errorDetails.retryable,
        consecutiveFailures: newFailureCount,
        // Store full error details for debugging
        googleError: originalError?.response?.data?.error,
        googleErrorDescription: originalError?.response?.data?.error_description,
        googleErrorSubtype: originalError?.response?.data?.error_subtype,
        httpStatus: originalError?.response?.status,
      }

      const updates: any = {
        authStatus: this.mapErrorTypeToStatus(errorDetails.type),
        // Store auth error details in metadata (columns were removed)
        metadata: {
          ...currentMetadata,
          auth: newAuthData,
        },
      }

      logger.info(`[${this.providerId}] Metadata being written to database`, {
        integrationId: this.integrationId,
        authData: newAuthData,
        requiresReauth: errorDetails.requiresReauth,
      })

      // Only disable integration after threshold consecutive failures
      if (errorDetails.requiresReauth && newFailureCount >= AuthErrorHandler.DISABLE_THRESHOLD) {
        updates.enabled = false
        logger.warn(
          `[${this.providerId}] Disabling integration after ${newFailureCount} consecutive auth failures`,
          {
            integrationId: this.integrationId,
            errorType: errorDetails.type,
            consecutiveFailures: newFailureCount,
            threshold: AuthErrorHandler.DISABLE_THRESHOLD,
          }
        )
      } else if (errorDetails.requiresReauth) {
        logger.info(
          `[${this.providerId}] Auth error requires reauth, but not disabling yet (${newFailureCount}/${AuthErrorHandler.DISABLE_THRESHOLD} failures)`,
          {
            integrationId: this.integrationId,
            errorType: errorDetails.type,
            consecutiveFailures: newFailureCount,
            threshold: AuthErrorHandler.DISABLE_THRESHOLD,
          }
        )
      }

      await db
        .update(schema.Integration)
        .set(updates)
        .where(eq(schema.Integration.id, this.integrationId))

      logger.info(`[${this.providerId}] Updated integration status in database`, {
        integrationId: this.integrationId,
        requiresReauth: errorDetails.requiresReauth,
        disabled:
          errorDetails.requiresReauth && newFailureCount >= AuthErrorHandler.DISABLE_THRESHOLD,
        consecutiveFailures: newFailureCount,
      })
    } catch (dbError) {
      logger.error(`[${this.providerId}] Failed to update integration status`, {
        integrationId: this.integrationId,
        error: (dbError as Error).message,
      })
    }
  }
  /**
   * Get current metadata to preserve existing data
   */
  private async getCurrentMetadata(): Promise<any> {
    try {
      const [integration] = await db
        .select({ metadata: schema.Integration.metadata })
        .from(schema.Integration)
        .where(eq(schema.Integration.id, this.integrationId))
        .limit(1)
      return integration?.metadata || {}
    } catch (error) {
      logger.warn('Failed to get current metadata, using empty object', {
        integrationId: this.integrationId,
        error: (error as Error).message,
      })
      return {}
    }
  }
  /**
   * Trigger real-time notifications for auth errors
   */
  private async notifyAuthError(errorDetails: AuthErrorDetails): Promise<void> {
    try {
      // TODO: Implement Pusher notification when real-time system is ready
      // await pusher.trigger(`integration-${this.integrationId}`, 'auth-error', {
      //   type: errorDetails.type,
      //   requiresReauth: errorDetails.requiresReauth,
      //   message: errorDetails.message
      // })
      logger.info(`[${this.providerId}] Auth error notification triggered`, {
        integrationId: this.integrationId,
        errorType: errorDetails.type,
        requiresReauth: errorDetails.requiresReauth,
      })
    } catch (notificationError) {
      logger.warn(`[${this.providerId}] Failed to send auth error notification`, {
        integrationId: this.integrationId,
        error: (notificationError as Error).message,
      })
    }
  }
  /**
   * Map internal error types to database enum values
   */
  private mapErrorTypeToStatus(errorType: AuthErrorType): IntegrationAuthStatus {
    switch (errorType) {
      case AuthErrorType.INVALID_GRANT:
        return IntegrationAuthStatus.INVALID_GRANT
      case AuthErrorType.EXPIRED_TOKEN:
        return IntegrationAuthStatus.EXPIRED_TOKEN
      case AuthErrorType.REVOKED_ACCESS:
        return IntegrationAuthStatus.REVOKED_ACCESS
      case AuthErrorType.INSUFFICIENT_SCOPE:
        return IntegrationAuthStatus.INSUFFICIENT_SCOPE
      case AuthErrorType.RATE_LIMITED:
        return IntegrationAuthStatus.RATE_LIMITED
      case AuthErrorType.PROVIDER_ERROR:
        return IntegrationAuthStatus.PROVIDER_ERROR
      case AuthErrorType.NETWORK_ERROR:
        return IntegrationAuthStatus.NETWORK_ERROR
      case AuthErrorType.UNKNOWN_ERROR:
        return IntegrationAuthStatus.UNKNOWN_ERROR
      default:
        return IntegrationAuthStatus.ERROR
    }
  }
  /**
   * Check if error should trigger re-authentication
   */
  static requiresReauth(errorType: AuthErrorType): boolean {
    return [
      AuthErrorType.INVALID_GRANT,
      AuthErrorType.REVOKED_ACCESS,
      AuthErrorType.INSUFFICIENT_SCOPE,
    ].includes(errorType)
  }
  /**
   * Check if error is retryable
   */
  static isRetryable(errorType: AuthErrorType): boolean {
    return [
      AuthErrorType.EXPIRED_TOKEN,
      AuthErrorType.RATE_LIMITED,
      AuthErrorType.NETWORK_ERROR,
      AuthErrorType.PROVIDER_ERROR,
      AuthErrorType.UNKNOWN_ERROR,
    ].includes(errorType)
  }
  /**
   * Reset consecutive failure counter after successful operation
   * Should be called after a successful sync to clear the failure state
   */
  static async resetFailureCounter(integrationId: string): Promise<void> {
    try {
      const [integration] = await db
        .select({ metadata: schema.Integration.metadata })
        .from(schema.Integration)
        .where(eq(schema.Integration.id, integrationId))
        .limit(1)

      const currentMetadata = integration?.metadata || {}
      const currentAuth = (currentMetadata as any)?.auth

      // Only update if there were previous failures
      if (currentAuth?.consecutiveFailures && currentAuth.consecutiveFailures > 0) {
        const updatedMetadata = {
          ...currentMetadata,
          auth: {
            ...(currentAuth || {}),
            consecutiveFailures: 0,
            lastSuccessAt: new Date().toISOString(),
          },
        }

        await db
          .update(schema.Integration)
          .set({
            metadata: updatedMetadata,
            authStatus: IntegrationAuthStatus.AUTHENTICATED,
          })
          .where(eq(schema.Integration.id, integrationId))

        logger.info('Reset consecutive failure counter after successful sync', {
          integrationId,
          previousFailures: currentAuth.consecutiveFailures,
        })
      }
    } catch (error) {
      logger.warn('Failed to reset failure counter', {
        integrationId,
        error: (error as Error).message,
      })
    }
  }

  /**
   * Get user-friendly error message
   */
  static getUserFriendlyMessage(errorType: AuthErrorType, providerId: string): string {
    const providerName = providerId.charAt(0).toUpperCase() + providerId.slice(1)
    switch (errorType) {
      case AuthErrorType.INVALID_GRANT:
        return `${providerName} authentication has expired. Please re-authenticate to continue email sync.`
      case AuthErrorType.REVOKED_ACCESS:
        return `Access to ${providerName} has been revoked. Please re-authenticate to restore email sync.`
      case AuthErrorType.INSUFFICIENT_SCOPE:
        return `${providerName} permissions are insufficient. Please re-authenticate with the required permissions.`
      case AuthErrorType.EXPIRED_TOKEN:
        return `${providerName} session has expired. Attempting to refresh automatically.`
      case AuthErrorType.RATE_LIMITED:
        return `${providerName} rate limit exceeded. Email sync will retry automatically.`
      case AuthErrorType.NETWORK_ERROR:
        return `Network error connecting to ${providerName}. Please check your connection.`
      case AuthErrorType.PROVIDER_ERROR:
        return `${providerName} service is experiencing issues. Email sync will retry automatically.`
      default:
        return `Unknown error with ${providerName} integration. Please try again or contact support.`
    }
  }
}
