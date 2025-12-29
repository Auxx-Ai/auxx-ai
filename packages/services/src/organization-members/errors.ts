// packages/services/src/organization-members/errors.ts

import type { DatabaseError } from '../shared/errors'

/**
 * Organization member-specific errors
 */
export type OrganizationMemberError =
  | {
      code: 'NOT_MEMBER'
      message: string
      organizationId: string
      userId: string
    }
  | {
      code: 'INSUFFICIENT_PERMISSIONS'
      message: string
      organizationId: string
      userId: string
      requiredRole: string
    }
  | {
      code: 'ORGANIZATION_NOT_FOUND'
      message: string
      organizationId: string
    }
  | DatabaseError
