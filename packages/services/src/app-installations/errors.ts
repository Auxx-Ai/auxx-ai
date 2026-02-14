// packages/services/src/app-installations/errors.ts

import type { AppError } from '../apps/errors'
import type { DatabaseError } from '../shared/errors'

/**
 * App installation-specific errors
 */
export type AppInstallationError =
  | {
      code: 'INSTALLATION_NOT_FOUND'
      message: string
      appId: string
      organizationId: string
    }
  | {
      code: 'INSTALLATION_FAILED'
      message: string
      appId: string
      organizationId: string
      reason: string
    }
  | {
      code: 'NO_VERSION_INSTALLED'
      message: string
      installationId: string
    }
  | {
      code: 'NO_BUNDLE_FOUND'
      message: string
      installationId: string
    }
  | AppError
  | DatabaseError
