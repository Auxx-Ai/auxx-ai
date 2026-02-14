// apps/api/src/lib/response.ts

/**
 * HTTP status codes used for error responses
 */
export type ErrorStatusCode = 400 | 401 | 403 | 404 | 409 | 410 | 500

/**
 * Standard API response types
 */
export interface SuccessResponse<T = unknown> {
  success: true
  data: T
}

export interface ErrorResponse {
  success: false
  error: {
    code: string
    message: string
    details?: unknown
  }
}

export type ApiResponse<T = unknown> = SuccessResponse<T> | ErrorResponse

/**
 * Create success response
 */
export function successResponse<T>(data: T): SuccessResponse<T> {
  return {
    success: true,
    data,
  }
}

/**
 * Create error response
 */
export function errorResponse(code: string, message: string, details?: unknown): ErrorResponse {
  return {
    success: false,
    error: {
      code,
      message,
      details,
    },
  }
}

/**
 * Error code to HTTP status code mapping
 * Used by route handlers to map service errors to HTTP responses
 */
export const ERROR_STATUS_MAP: Record<string, ErrorStatusCode> = {
  // Generic errors
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  INTERNAL_ERROR: 500,

  // Developer account errors
  APP_NOT_FOUND: 404,
  ACCESS_DENIED: 403,
  DEVELOPER_ACCOUNT_NOT_FOUND: 404,

  // Organization membership errors
  NOT_MEMBER: 403,
  ORGANIZATION_NOT_FOUND: 404,

  // Organization access errors
  ORG_NOT_FOUND: 404,
  ORG_ACCESS_DENIED: 403,
  ORG_DISABLED: 410,
  ORG_ROLE_INSUFFICIENT: 403,

  // App version errors
  CREATE_FAILED: 500,
  VERSION_NOT_FOUND: 404,
  INVALID_VERSION_NUMBER: 400,

  // App version bundle errors
  BUNDLE_NOT_FOUND: 404,
  BUNDLE_NOT_COMPLETE: 400,
  BUNDLE_ALREADY_COMPLETE: 400,
  S3_ERROR: 500,

  // App installation errors
  INSTALLATION_NOT_FOUND: 404,
  NO_VERSION_INSTALLED: 404,
  NO_BUNDLE_FOUND: 404,
  APP_ALREADY_INSTALLED: 409,
  APP_NOT_INSTALLED: 404,
  APP_INSTALLATION_FAILED: 500,
  APP_VERSION_NOT_FOUND: 404,

  // App marketplace errors
  APP_ACCESS_DENIED: 403,
  NO_VERSIONS_AVAILABLE: 404,
  VERSION_ACCESS_DENIED: 403,
  INVALID_INSTALLATION_TYPE: 400,

  // Database errors
  DATABASE_ERROR: 500,
}
