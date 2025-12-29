// ~/lib/src/types/integration-auth-status.ts

/**
 * Integration authentication status enum
 * Used to track the current authentication state of OAuth integrations
 * Note: This matches the drizzle enum in the database schema
 */
export enum IntegrationAuthStatus {
  AUTHENTICATED = 'AUTHENTICATED',
  UNAUTHENTICATED = 'UNAUTHENTICATED',
  ERROR = 'ERROR',
  INVALID_GRANT = 'INVALID_GRANT',
  EXPIRED_TOKEN = 'EXPIRED_TOKEN',
  REVOKED_ACCESS = 'REVOKED_ACCESS',
  INSUFFICIENT_SCOPE = 'INSUFFICIENT_SCOPE',
  RATE_LIMITED = 'RATE_LIMITED',
  PROVIDER_ERROR = 'PROVIDER_ERROR',
  NETWORK_ERROR = 'NETWORK_ERROR',
  UNKNOWN_ERROR = 'UNKNOWN_ERROR',
}

/**
 * Helper functions for status checking
 */
export class IntegrationAuthStatusHelper {
  /**
   * Check if status requires re-authentication
   */
  static requiresReauth(status: IntegrationAuthStatus): boolean {
    return [
      IntegrationAuthStatus.ERROR,
      IntegrationAuthStatus.INVALID_GRANT,
      IntegrationAuthStatus.REVOKED_ACCESS,
      IntegrationAuthStatus.INSUFFICIENT_SCOPE,
      IntegrationAuthStatus.UNAUTHENTICATED,
    ].includes(status)
  }

  /**
   * Check if status indicates a healthy integration
   */
  static isHealthy(status: IntegrationAuthStatus): boolean {
    return [IntegrationAuthStatus.AUTHENTICATED].includes(status)
  }

  /**
   * Check if status allows retry operations
   */
  static canRetry(status: IntegrationAuthStatus): boolean {
    return [
      IntegrationAuthStatus.EXPIRED_TOKEN,
      IntegrationAuthStatus.RATE_LIMITED,
      IntegrationAuthStatus.NETWORK_ERROR,
      IntegrationAuthStatus.PROVIDER_ERROR,
    ].includes(status)
  }

  /**
   * Check if status requires user attention
   */
  static requiresUserAction(status: IntegrationAuthStatus): boolean {
    return [
      IntegrationAuthStatus.ERROR,
      IntegrationAuthStatus.INVALID_GRANT,
      IntegrationAuthStatus.REVOKED_ACCESS,
      IntegrationAuthStatus.INSUFFICIENT_SCOPE,
      IntegrationAuthStatus.UNAUTHENTICATED,
    ].includes(status)
  }

  /**
   * Get user-friendly status message
   */
  static getStatusMessage(status: IntegrationAuthStatus): string {
    switch (status) {
      case IntegrationAuthStatus.AUTHENTICATED:
        return 'Connected and working'

      case IntegrationAuthStatus.UNAUTHENTICATED:
        return 'Not authenticated - authentication required'

      case IntegrationAuthStatus.ERROR:
        return 'Authentication error - re-authentication required'

      case IntegrationAuthStatus.INVALID_GRANT:
        return 'Invalid credentials - re-authentication required'

      case IntegrationAuthStatus.EXPIRED_TOKEN:
        return 'Session expired - refreshing automatically'

      case IntegrationAuthStatus.REVOKED_ACCESS:
        return 'Access revoked - please re-authenticate'

      case IntegrationAuthStatus.INSUFFICIENT_SCOPE:
        return 'Insufficient permissions - re-authentication required'

      case IntegrationAuthStatus.RATE_LIMITED:
        return 'Rate limited - will retry automatically'

      case IntegrationAuthStatus.PROVIDER_ERROR:
        return 'Provider error - will retry automatically'

      case IntegrationAuthStatus.NETWORK_ERROR:
        return 'Network error - check connection'

      case IntegrationAuthStatus.UNKNOWN_ERROR:
        return 'Unknown error - please try again'

      default:
        return 'Unknown status'
    }
  }

  /**
   * Get status color for UI
   */
  static getStatusColor(
    status: IntegrationAuthStatus
  ): 'green' | 'yellow' | 'red' | 'blue' | 'gray' {
    switch (status) {
      case IntegrationAuthStatus.AUTHENTICATED:
        return 'green'

      case IntegrationAuthStatus.EXPIRED_TOKEN:
      case IntegrationAuthStatus.RATE_LIMITED:
      case IntegrationAuthStatus.PROVIDER_ERROR:
        return 'yellow'

      case IntegrationAuthStatus.ERROR:
      case IntegrationAuthStatus.INVALID_GRANT:
      case IntegrationAuthStatus.REVOKED_ACCESS:
      case IntegrationAuthStatus.INSUFFICIENT_SCOPE:
        return 'red'

      case IntegrationAuthStatus.UNAUTHENTICATED:
      case IntegrationAuthStatus.NETWORK_ERROR:
      case IntegrationAuthStatus.UNKNOWN_ERROR:
        return 'gray'

      default:
        return 'gray'
    }
  }
}
