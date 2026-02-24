// packages/lib/src/providers/outlook/outlook-errors.ts

import { AuthError, InteractionRequiredAuthError, ServerError } from '@azure/msal-node'

/**
 * Classified error codes for Outlook/Graph API operations.
 */
export type OutlookErrorCode =
  | 'INVALID_REFRESH_TOKEN' // Permanent — requires re-auth
  | 'INSUFFICIENT_PERMISSIONS' // Permanent — missing scopes or revoked
  | 'SYNC_CURSOR_ERROR' // Delta link expired — reset and resync
  | 'TEMPORARY_ERROR' // Transient — retry with backoff
  | 'NOT_FOUND' // Resource not found
  | 'UNKNOWN' // Unclassified

export class OutlookProviderError extends Error {
  constructor(
    message: string,
    public readonly code: OutlookErrorCode,
    public readonly statusCode?: number,
    public readonly retryable: boolean = false,
    options?: ErrorOptions
  ) {
    super(message, options)
    this.name = 'OutlookProviderError'
  }
}

// --- MSAL Error Classification ---

/** @see https://learn.microsoft.com/en-us/entra/identity-platform/reference-error-codes */
const PERMANENT_AUTH_ERROR_CODES = new Set([
  'invalid_grant',
  'invalid_client',
  'unauthorized_client',
  'invalid_request',
])

/** @see https://github.com/AzureAD/microsoft-authentication-library-for-js/blob/dev/lib/msal-common/src/error/ClientAuthErrorCodes.ts */
const TRANSIENT_AUTH_ERROR_CODES = new Set([
  'network_error',
  'no_network_connectivity',
  'endpoints_resolution_error',
  'openid_config_error',
  'request_cannot_be_made',
])

export function parseMsalError(error: unknown): OutlookProviderError {
  if (error instanceof InteractionRequiredAuthError) {
    return new OutlookProviderError(
      `Microsoft token refresh requires re-authentication: ${error.errorCode}`,
      'INVALID_REFRESH_TOKEN',
      undefined,
      false,
      { cause: error }
    )
  }

  if (error instanceof ServerError) {
    if (error.status === 429) {
      return new OutlookProviderError(
        'Microsoft rate limit exceeded',
        'TEMPORARY_ERROR',
        429,
        true,
        { cause: error }
      )
    }
    if (error.status && error.status >= 500) {
      return new OutlookProviderError(
        `Microsoft server error (${error.status}): ${error.errorMessage}`,
        'TEMPORARY_ERROR',
        error.status,
        true,
        { cause: error }
      )
    }
  }

  if (error instanceof AuthError) {
    if (TRANSIENT_AUTH_ERROR_CODES.has(error.errorCode)) {
      return new OutlookProviderError(
        `Microsoft network error: ${error.errorCode} - ${error.errorMessage}`,
        'TEMPORARY_ERROR',
        undefined,
        true,
        { cause: error }
      )
    }
    if (PERMANENT_AUTH_ERROR_CODES.has(error.errorCode)) {
      return new OutlookProviderError(
        `Microsoft auth error: ${error.errorCode} - ${error.errorMessage}`,
        'INVALID_REFRESH_TOKEN',
        undefined,
        false,
        { cause: error }
      )
    }
  }

  const message = error instanceof Error ? error.message : String(error)
  return new OutlookProviderError(
    `Microsoft token refresh failed: ${message}`,
    'UNKNOWN',
    undefined,
    false,
    { cause: error instanceof Error ? error : undefined }
  )
}

// --- Graph API Error Classification ---

export function parseGraphApiError(error: unknown): OutlookProviderError {
  const statusCode = (error as any)?.statusCode ?? (error as any)?.status
  const message = (error as any)?.message ?? String(error)
  const code = (error as any)?.code

  if (statusCode === 400) {
    return new OutlookProviderError(
      `Invalid request to Microsoft Graph API: ${message}`,
      'UNKNOWN',
      400,
      false,
      { cause: error instanceof Error ? error : undefined }
    )
  }

  if (statusCode === 401) {
    return new OutlookProviderError(
      'Unauthorized access to Microsoft Graph API',
      'INSUFFICIENT_PERMISSIONS',
      401,
      false,
      { cause: error instanceof Error ? error : undefined }
    )
  }

  if (statusCode === 403) {
    return new OutlookProviderError(
      'Forbidden access to Microsoft Graph API',
      'INSUFFICIENT_PERMISSIONS',
      403,
      false,
      { cause: error instanceof Error ? error : undefined }
    )
  }

  if (statusCode === 404) {
    if (message?.includes('inactive, soft-deleted, or is hosted on-premise')) {
      return new OutlookProviderError(
        `Disabled or inactive Microsoft account: ${code}`,
        'INSUFFICIENT_PERMISSIONS',
        404,
        false,
        { cause: error instanceof Error ? error : undefined }
      )
    }
    return new OutlookProviderError(`Resource not found: ${code}`, 'NOT_FOUND', 404, false, {
      cause: error instanceof Error ? error : undefined,
    })
  }

  if (statusCode === 410) {
    return new OutlookProviderError(
      `Sync cursor expired: ${message}`,
      'SYNC_CURSOR_ERROR',
      410,
      true,
      { cause: error instanceof Error ? error : undefined }
    )
  }

  if ([429, 500, 502, 503, 504, 509].includes(statusCode)) {
    return new OutlookProviderError(
      `Microsoft Graph API error (${statusCode}): ${message}`,
      'TEMPORARY_ERROR',
      statusCode,
      true,
      { cause: error instanceof Error ? error : undefined }
    )
  }

  return new OutlookProviderError(
    `Microsoft Graph API unknown error (${statusCode}): ${message}`,
    'UNKNOWN',
    statusCode,
    false,
    { cause: error instanceof Error ? error : undefined }
  )
}
