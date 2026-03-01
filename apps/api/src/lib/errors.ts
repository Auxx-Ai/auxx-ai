// apps/api/src/lib/errors.ts

/**
 * Base error interface with context for all service errors
 */
export interface ServiceError {
  /** Error code for identifying the error type */
  code: string
  /** Human-readable error message */
  message: string
  /** Optional context data for debugging */
  context?: Record<string, unknown>
  /** Original error cause if applicable */
  cause?: unknown
}

/**
 * Developer account related errors
 */
export type DeveloperAccountError =
  | {
      code: 'APP_NOT_FOUND'
      message: string
      appId: string
    }
  | {
      code: 'ACCESS_DENIED'
      message: string
      userId: string
      appId: string
    }
  | {
      code: 'DEVELOPER_ACCOUNT_NOT_FOUND'
      message: string
      developerAccountId?: string
    }
  | {
      code: 'DATABASE_ERROR'
      message: string
      cause: unknown
    }

/**
 * Organization membership related errors
 */
export type OrganizationMemberError =
  | {
      code: 'NOT_MEMBER'
      message: string
      userId: string
      organizationId: string
    }
  | {
      code: 'ORGANIZATION_NOT_FOUND'
      message: string
      organizationId: string
    }
  | {
      code: 'DATABASE_ERROR'
      message: string
      cause: unknown
    }

/**
 * App deployment related errors
 */
export type AppDeploymentError =
  | {
      code: 'DEPLOYMENT_NOT_FOUND'
      message: string
      deploymentId?: string
      appId?: string
    }
  | {
      code: 'INVALID_STATUS_TRANSITION'
      message: string
      details: string
    }
  | {
      code: 'DATABASE_ERROR'
      message: string
      cause: unknown
    }

/**
 * App bundle related errors
 */
export type AppBundleError =
  | {
      code: 'BUNDLE_NOT_FOUND'
      message: string
      bundleId?: string
    }
  | {
      code: 'BUNDLE_NOT_UPLOADED'
      message: string
      bundleId?: string
    }
  | {
      code: 'S3_ERROR'
      message: string
      cause: unknown
      operation?: string
    }
  | {
      code: 'DATABASE_ERROR'
      message: string
      cause: unknown
    }

/**
 * App installation related errors
 */
export type AppInstallationError =
  | {
      code: 'INSTALLATION_NOT_FOUND'
      message: string
      installationId?: string
      appId?: string
      organizationId?: string
    }
  | {
      code: 'NO_DEPLOYMENT_ACTIVE'
      message: string
      installationId: string
    }
  | {
      code: 'ORGANIZATION_NOT_FOUND'
      message: string
      organizationId: string
    }
  | {
      code: 'APP_NOT_FOUND'
      message: string
      appId: string
    }
  | {
      code: 'DATABASE_ERROR'
      message: string
      cause: unknown
    }

/**
 * App-related errors for marketplace and app management
 */
export type AppError =
  | {
      code: 'APP_NOT_FOUND'
      message: string
      appSlug: string
    }
  | {
      code: 'APP_ACCESS_DENIED'
      message: string
      appSlug: string
      organizationId: string
    }
  | {
      code: 'APP_ALREADY_INSTALLED'
      message: string
      appSlug: string
      organizationId: string
      installationType: 'development' | 'production'
    }
  | {
      code: 'NO_DEPLOYMENTS_AVAILABLE'
      message: string
      appId: string
      deploymentType?: string
    }
  | {
      code: 'INVALID_INSTALLATION_TYPE'
      message: string
      details: string
    }
  | {
      code: 'DATABASE_ERROR'
      message: string
      cause: unknown
    }

/**
 * Organization access related errors
 */
export type OrganizationAccessError =
  | {
      code: 'ORG_NOT_FOUND'
      message: string
      handle: string
    }
  | {
      code: 'ORG_ACCESS_DENIED'
      message: string
      userId: string
      handle: string
    }
  | {
      code: 'ORG_DISABLED'
      message: string
      handle: string
      disabledReason?: string | null
    }
  | {
      code: 'ORG_ROLE_INSUFFICIENT'
      message: string
      required: string[]
      actual: string
    }
  | {
      code: 'DATABASE_ERROR'
      message: string
      cause: unknown
    }

/**
 * Union of all service error types
 */
export type AnyServiceError =
  | DeveloperAccountError
  | OrganizationMemberError
  | OrganizationAccessError
  | AppDeploymentError
  | AppBundleError
  | AppInstallationError
  | AppError
