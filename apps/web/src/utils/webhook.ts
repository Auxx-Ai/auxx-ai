// apps/web/src/utils/webhook.ts

import type { ExecutedRule } from '@auxx/database/types'
import { getUserByEmail } from '@auxx/lib/users'
import { createScopedLogger } from '@auxx/logger'
import { sleep } from './sleep'

const logger = createScopedLogger('webhook')
type WebhookPayload = {
  email: {
    threadId: string
    messageId: string
    subject: string
    from: string
    cc?: string
    bcc?: string
    headerMessageId: string
  }
  executedRule: Pick<ExecutedRule, 'id' | 'ruleId' | 'reason' | 'automated' | 'createdAt'>
}
export const callWebhook = async (userEmail: string, url: string, payload: WebhookPayload) => {
  if (!url) throw new Error('Webhook URL is required')
  const user = await getUserByEmail(userEmail)
  if (!user) throw new Error('User not found')
  try {
    await Promise.race([
      fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Webhook-Secret': user?.webhookSecret || '',
        },
        body: JSON.stringify(payload),
      }),
      sleep(1000),
    ])
    logger.info('Webhook called', { url })
  } catch (error) {
    logger.error('Webhook call failed', { error, url })
    // Don't throw the error since we want to continue execution
    logger.info('Continuing after webhook timeout/error')
  }
}
