// packages/services/src/organizations/errors.ts

import type { DatabaseError } from '../shared/errors'

/**
 * Organization-specific errors
 */
export type OrganizationError =
  | {
      code: 'ORG_NOT_FOUND'
      message: string
      organizationId?: string
      handle?: string
    }
  | {
      code: 'ORG_DISABLED'
      message: string
      organizationId: string
      disabledReason?: string | null
    }
  | {
      code: 'ORG_HANDLE_TAKEN'
      message: string
      handle: string
    }
  | {
      code: 'ORG_ACCESS_DENIED'
      message: string
      organizationId: string
      userId: string
    }
  | {
      code: 'ORG_ROLE_INSUFFICIENT'
      message: string
      required: string[]
      actual: string
    }
  | DatabaseError
