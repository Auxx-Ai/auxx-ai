// packages/lib/src/providers/google/shared/utils.ts
import type { gmail_v1 } from 'googleapis'
import { getGmailQuotaCost, type UniversalThrottler } from '../../../utils/rate-limiter'
import type { GoogleThrottleContext } from '../types'

/**
 * Map Gmail API operations to throttler contexts
 */
const THROTTLE_CONTEXT_MAP: Record<string, GoogleThrottleContext> = {
  'gmail.settings.sendAs.list': 'sync',
  'gmail.messages.send': 'send',
  'gmail.drafts.create': 'send',
  'gmail.drafts.update': 'send',
  'gmail.drafts.send': 'send',
  'gmail.users.watch': 'webhook',
  'gmail.users.stop': 'sync',
  'gmail.history.list': 'history',
  'gmail.messages.list': 'sync',
  'gmail.messages.batchGet': 'batch',
  'gmail.messages.modify': 'sync',
  'gmail.threads.modify': 'sync',
  'gmail.messages.trash': 'sync',
  'gmail.threads.trash': 'sync',
  'gmail.messages.untrash': 'sync',
  'gmail.threads.untrash': 'sync',
  'gmail.labels.list': 'labels',
  'gmail.labels.create': 'labels',
  'gmail.labels.update': 'labels',
  'gmail.labels.delete': 'labels',
  'gmail.threads.get': 'sync',
}

/**
 * Get throttler context for an operation
 */
export function getThrottleContext(operation: string): GoogleThrottleContext {
  return THROTTLE_CONTEXT_MAP[operation] || 'sync'
}

/**
 * Execute Gmail API call with throttling
 */
export async function executeWithThrottle<T>(
  operation: string,
  fn: () => Promise<T>,
  options: {
    userId: string
    throttler: UniversalThrottler
    cost?: number
    queue?: boolean
    priority?: number
  }
): Promise<T> {
  const context = getThrottleContext(operation)
  const cost = options.cost ?? getGmailQuotaCost(operation as any)

  return options.throttler.execute(context, fn, {
    userId: options.userId,
    cost,
    queue: options.queue ?? true,
    priority: options.priority ?? 5,
    metadata: { operation },
  })
}

/**
 * Modify Gmail message or thread with throttling
 */
export async function modifyWithThrottling(
  gmail: gmail_v1.Gmail,
  type: 'message' | 'thread',
  id: string,
  requestBody: {
    addLabelIds?: string[]
    removeLabelIds?: string[]
  },
  integrationId: string,
  throttler: UniversalThrottler
): Promise<any> {
  const operation = type === 'message' ? 'messages.modify' : 'threads.modify'

  return executeWithThrottle(
    `gmail.${operation}`,
    async () =>
      gmail.users[type === 'message' ? 'messages' : 'threads'].modify({
        userId: 'me',
        id,
        requestBody,
      }),
    {
      userId: integrationId,
      throttler,
      priority: 7,
    }
  )
}
