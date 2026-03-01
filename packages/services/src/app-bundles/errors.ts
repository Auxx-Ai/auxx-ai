// packages/services/src/app-bundles/errors.ts

import type { DatabaseError, S3Error } from '../shared/errors'

/**
 * App bundle-specific errors
 */
export type AppBundleError =
  | {
      code: 'BUNDLE_NOT_FOUND'
      message: string
      appId: string
      sha256: string
    }
  | {
      code: 'BUNDLE_UPLOAD_FAILED'
      message: string
      bundleId: string
      reason: string
    }
  | {
      code: 'BUNDLE_NOT_UPLOADED'
      message: string
      bundleId: string
    }
  | DatabaseError
  | S3Error
