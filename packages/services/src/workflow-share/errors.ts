// packages/services/src/workflow-share/errors.ts

import type { DatabaseError } from '../shared/errors'

/**
 * Workflow share error types
 */
export type WorkflowShareError =
  | DatabaseError
  | {
      code: 'WORKFLOW_NOT_FOUND'
      message: string
      shareToken: string
    }
  | {
      code: 'WORKFLOW_SHARING_DISABLED'
      message: string
      shareToken: string
    }
  | {
      code: 'WORKFLOW_DISABLED'
      message: string
      workflowAppId: string
    }
  | {
      code: 'ACCESS_DENIED'
      message: string
      reason: string
      accessMode: string
    }
  | {
      code: 'INVALID_PASSPORT'
      message: string
    }
  | {
      code: 'PASSPORT_EXPIRED'
      message: string
    }
  | {
      code: 'RATE_LIMIT_EXCEEDED'
      message: string
      retryAfterMs?: number
    }
  | {
      code: 'INVALID_API_KEY'
      message: string
    }
  | {
      code: 'END_USER_CREATION_FAILED'
      message: string
    }
