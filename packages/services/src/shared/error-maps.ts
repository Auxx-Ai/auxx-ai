// packages/services/src/shared/error-maps.ts

/**
 * Combined HTTP status code mapping for all error codes
 * Used by apps/api to map service errors to HTTP responses
 */
export const ERROR_STATUS_MAP: Record<string, number> = {
  // 404 Not Found
  APP_NOT_FOUND: 404,
  VERSION_NOT_FOUND: 404,
  BUNDLE_NOT_FOUND: 404,
  INSTALLATION_NOT_FOUND: 404,
  ORG_NOT_FOUND: 404,
  USER_NOT_FOUND: 404,
  DEVELOPER_NOT_FOUND: 404,

  // 403 Forbidden
  APP_ACCESS_DENIED: 403,
  VERSION_ACCESS_DENIED: 403,
  ORG_ACCESS_DENIED: 403,
  NOT_MEMBER: 403,
  INSUFFICIENT_PERMISSIONS: 403,

  // 409 Conflict
  APP_ALREADY_INSTALLED: 409,
  ORG_HANDLE_TAKEN: 409,

  // 410 Gone
  ORG_DISABLED: 410,

  // 422 Unprocessable Entity
  BUNDLE_NOT_COMPLETE: 422,
  NO_VERSIONS_AVAILABLE: 422,

  // 500 Internal Server Error
  DATABASE_ERROR: 500,
  S3_ERROR: 500,
  VERSION_CREATE_FAILED: 500,
  BUNDLE_UPLOAD_FAILED: 500,
  INSTALLATION_FAILED: 500,
}

/**
 * Combined tRPC error code mapping for all error codes
 * Used by apps/web to map service errors to tRPC errors
 */
export const ERROR_TRPC_MAP: Record<
  string,
  'BAD_REQUEST' | 'FORBIDDEN' | 'NOT_FOUND' | 'CONFLICT' | 'INTERNAL_SERVER_ERROR'
> = {
  // NOT_FOUND
  APP_NOT_FOUND: 'NOT_FOUND',
  VERSION_NOT_FOUND: 'NOT_FOUND',
  BUNDLE_NOT_FOUND: 'NOT_FOUND',
  INSTALLATION_NOT_FOUND: 'NOT_FOUND',
  ORG_NOT_FOUND: 'NOT_FOUND',
  USER_NOT_FOUND: 'NOT_FOUND',
  DEVELOPER_NOT_FOUND: 'NOT_FOUND',

  // FORBIDDEN
  APP_ACCESS_DENIED: 'FORBIDDEN',
  VERSION_ACCESS_DENIED: 'FORBIDDEN',
  ORG_ACCESS_DENIED: 'FORBIDDEN',
  NOT_MEMBER: 'FORBIDDEN',
  INSUFFICIENT_PERMISSIONS: 'FORBIDDEN',

  // CONFLICT
  APP_ALREADY_INSTALLED: 'CONFLICT',
  ORG_HANDLE_TAKEN: 'CONFLICT',

  // BAD_REQUEST
  BUNDLE_NOT_COMPLETE: 'BAD_REQUEST',
  ORG_DISABLED: 'BAD_REQUEST',
  NO_VERSIONS_AVAILABLE: 'BAD_REQUEST',

  // INTERNAL_SERVER_ERROR
  DATABASE_ERROR: 'INTERNAL_SERVER_ERROR',
  S3_ERROR: 'INTERNAL_SERVER_ERROR',
  VERSION_CREATE_FAILED: 'INTERNAL_SERVER_ERROR',
  BUNDLE_UPLOAD_FAILED: 'INTERNAL_SERVER_ERROR',
  INSTALLATION_FAILED: 'INTERNAL_SERVER_ERROR',
}

/**
 * Union type of all service errors (for exhaustive error handling)
 */
export type AnyServiceError =
  | import('../apps/errors').AppError
  | import('../app-versions/errors').AppVersionError
  | import('../app-bundles/errors').AppBundleError
  | import('../app-installations/errors').AppInstallationError
  | import('../organizations/errors').OrganizationError
  | import('../organization-members/errors').OrganizationMemberError
  | import('../developer-accounts/errors').DeveloperAccountError
  | import('../users/errors').UserError
  | import('./errors').DatabaseError
  | import('./errors').S3Error
