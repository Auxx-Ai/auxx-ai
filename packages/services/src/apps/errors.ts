// packages/services/src/apps/errors.ts

import type { DatabaseError } from '../shared/errors'

/**
 * App-specific errors
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
      code: 'DEPLOYMENT_ACCESS_DENIED'
      message: string
      deploymentId: string
      organizationId: string
    }
  | {
      code: 'INVALID_INSTALLATION_TYPE'
      message: string
      details: string
    }
  | {
      code: 'APP_SLUG_TAKEN'
      message: string
      slug: string
    }
  | {
      code: 'DEVELOPER_ACCOUNT_NOT_FOUND'
      message: string
      slug: string
    }
  | {
      code: 'DEVELOPER_ACCESS_DENIED'
      message: string
      userId: string
      appId?: string
      developerAccountId?: string
      requiredLevel?: string
    }
  | {
      code: 'APP_CREATE_FAILED'
      message: string
      details?: string
    }
  | {
      code: 'APP_UPDATE_FAILED'
      message: string
      appId: string
      details?: string
    }
  | {
      code: 'INVALID_STATUS_TRANSITION'
      message: string
      appId: string
      currentStatus?: string
      targetStatus?: string
    }
  | {
      code: 'APP_NOT_ELIGIBLE_FOR_REVIEW'
      message: string
      appId: string
      reason: string
    }
  | {
      code: 'APP_HAS_ACTIVE_INSTALLATIONS'
      message: string
      appId: string
      installationCount: number
    }
  | {
      code: 'APP_LISTING_INCOMPLETE'
      message: string
      appId: string
      missingFields: string[]
    }
  | {
      code: 'APP_OAUTH_CONFIG_INCOMPLETE'
      message: string
      appId: string
      missingFields: string[]
    }
  | {
      code: 'APP_NO_PROD_VERSION'
      message: string
      appId: string
    }
  | DatabaseError
