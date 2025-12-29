// packages/services/src/developer-accounts/errors.ts

import type { DatabaseError } from '../shared/errors'

/**
 * Developer account-specific errors
 */
export type DeveloperAccountError =
  | {
      code: 'DEVELOPER_ACCOUNT_NOT_FOUND'
      message: string
      slug: string
    }
  | {
      code: 'DEVELOPER_ACCOUNT_SLUG_TAKEN'
      message: string
      slug: string
    }
  | {
      code: 'DEVELOPER_ACCOUNT_CREATE_FAILED'
      message: string
      details?: string
    }
  | {
      code: 'DEVELOPER_ACCOUNT_UPDATE_FAILED'
      message: string
      developerAccountId: string
      details?: string
    }
  | {
      code: 'DEVELOPER_ACCESS_DENIED'
      message: string
      userId: string
      developerAccountId?: string
      requiredLevel?: string
    }
  | DatabaseError
