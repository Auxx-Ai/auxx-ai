// packages/lib/src/quick-actions/types.ts

import type { DraftActionPayload } from '@auxx/types/draft'

export type { DraftActionPayload } from '@auxx/types/draft'

/** Context for executing a quick action on the server */
export interface QuickActionExecutionContext {
  userId: string
  organizationId: string
  organizationHandle: string
  userEmail: string
  userName: string
  threadId?: string
  ticketId?: string
}

/** Result from a single quick action execution */
export interface QuickActionResult {
  actionId: string
  success: boolean
  outputs?: Record<string, unknown>
  error?: string
}

/** Input for the quick action execute mutation */
export interface ExecuteQuickActionsInput {
  actions: DraftActionPayload[]
  context: {
    threadId?: string
    ticketId?: string
  }
}
