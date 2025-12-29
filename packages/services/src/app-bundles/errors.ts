// packages/services/src/app-bundles/errors.ts

import type { DatabaseError, S3Error } from '../shared/errors'

/**
 * App bundle-specific errors
 */
export type AppBundleError =
  | {
      code: 'BUNDLE_NOT_FOUND'
      message: string
      bundleId: string
    }
  | {
      code: 'BUNDLE_UPLOAD_FAILED'
      message: string
      bundleId: string
      reason: string
    }
  | {
      code: 'BUNDLE_NOT_COMPLETE'
      message: string
      bundleId: string
    }
  | {
      code: 'BUNDLE_ALREADY_COMPLETE'
      message: string
      bundleId: string
    }
  | DatabaseError
  | S3Error
