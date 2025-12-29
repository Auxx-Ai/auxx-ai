// packages/services/src/users/errors.ts

import type { DatabaseError } from '../shared/errors'

/**
 * User-specific errors
 */
export type UserError =
  | {
      code: 'USER_NOT_FOUND'
      message: string
      userId: string
    }
  | DatabaseError
