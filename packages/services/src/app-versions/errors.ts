// packages/services/src/app-versions/errors.ts

import type { DatabaseError } from '../shared/errors'

/**
 * App version-specific errors
 */
export type AppVersionError =
  | {
      code: 'VERSION_NOT_FOUND'
      message: string
      versionId: string
    }
  | {
      code: 'VERSION_CREATE_FAILED'
      message: string
      appId: string
      reason: string
    }
  | {
      code: 'NO_VERSIONS_AVAILABLE'
      message: string
      appId: string
      versionType?: string
    }
  | {
      code: 'VERSION_ACCESS_DENIED'
      message: string
      versionId: string
      organizationId: string
    }
  | {
      code: 'INVALID_VERSION_NUMBER'
      message: string
      details: string
    }
  | {
      code: 'VERSION_NOT_PROD'
      message: string
      versionId: string
      versionType: string
    }
  | {
      code: 'VERSION_IS_LAST_PUBLISHED'
      message: string
      versionId: string
    }
  | {
      code: 'VERSION_APP_NOT_ELIGIBLE'
      message: string
      versionId: string
      appPublicationStatus: string
    }
  | {
      code: 'INVALID_LIFECYCLE_TRANSITION'
      message: string
      versionId: string
      currentStatus: string
      targetStatus: string
    }
  | {
      code: 'VERSION_INVALID_STATUS'
      message: string
      versionId: string
      currentStatus: string
    }
  | {
      code: 'VERSION_UPDATE_FAILED'
      message: string
      versionId: string
    }
  | {
      code: 'VERSION_INVALID_STATE'
      message: string
      versionId: string
      currentReviewStatus: string | null
    }
  | {
      code: 'VERSION_ALREADY_PUBLISHED'
      message: string
      versionId: string
    }
  | {
      code: 'VERSION_NOT_PUBLISHED'
      message: string
      versionId: string
      currentPublicationStatus: string
    }
  | {
      code: 'VERSION_NOT_IN_REVIEW'
      message: string
      versionId: string
      currentReviewStatus: string | null
    }
  | {
      code: 'INVALID_ACTION'
      message: string
      versionId: string
    }
  | {
      code: 'VERSION_NOT_APPROVED'
      message: string
      versionId: string
      currentReviewStatus: string | null
    }
  | DatabaseError
