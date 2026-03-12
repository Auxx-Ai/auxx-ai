// packages/lib/src/providers/google/messages/gmail-attachment-fetcher.ts

import { createScopedLogger } from '@auxx/logger'
import type { MessageAttachmentMeta } from '../../../email/email-storage'
import { getGmailQuotaCost, type UniversalThrottler } from '../../../utils/rate-limiter'
import { executeWithThrottle } from '../shared/utils'

const logger = createScopedLogger('gmail-attachment-fetcher')

/**
 * Decodes a base64url-encoded string to a Buffer.
 */
function decodeBase64Url(data: string): Buffer {
  // base64url → base64: replace URL-safe chars and add padding
  const base64 = data.replace(/-/g, '+').replace(/_/g, '/')
  return Buffer.from(base64, 'base64')
}

/**
 * Fetches a single attachment's bytes from the Gmail API.
 */
export async function fetchGmailAttachmentBytes(
  gmailMessageId: string,
  gmailAttachmentId: string,
  context: { accessToken: string; integrationId: string; throttler: UniversalThrottler }
): Promise<Buffer> {
  const url = `https://gmail.googleapis.com/gmail/v1/users/me/messages/${gmailMessageId}/attachments/${gmailAttachmentId}`

  const response = await executeWithThrottle(
    'gmail.messages.attachments.get',
    async () =>
      fetch(url, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${context.accessToken}`,
          'User-Agent': 'AuxxGoogleProvider/1.0',
        },
      }),
    {
      userId: context.integrationId,
      throttler: context.throttler,
      cost: getGmailQuotaCost('messages.get'),
      queue: true,
      priority: 5,
    }
  )

  if (!response.ok) {
    throw new Error(`Gmail attachment fetch failed: ${response.status} ${response.statusText}`)
  }

  const json = (await response.json()) as { data: string; size: number }
  return decodeBase64Url(json.data)
}

/**
 * Fetches all attachment bytes for a message, handling both embedded data and API fetches.
 * Returns a map from attachment index to Buffer, plus a count of failures.
 */
export async function fetchAllGmailAttachmentBytes(
  gmailMessageId: string,
  attachments: MessageAttachmentMeta[],
  context: { accessToken: string; integrationId: string; throttler: UniversalThrottler }
): Promise<{ resolved: Map<number, Buffer>; failedCount: number }> {
  const resolved = new Map<number, Buffer>()
  let failedCount = 0

  for (let i = 0; i < attachments.length; i++) {
    const att = attachments[i]!

    try {
      if (att.embeddedData) {
        // Small embedded part — decode directly, no API call needed
        resolved.set(i, decodeBase64Url(att.embeddedData))
      } else if (att.providerAttachmentId) {
        // Large part — fetch from Gmail API
        const bytes = await fetchGmailAttachmentBytes(
          gmailMessageId,
          att.providerAttachmentId,
          context
        )
        resolved.set(i, bytes)
      } else {
        // Neither embedded data nor attachmentId — unexpected
        logger.warn('Attachment has neither embeddedData nor providerAttachmentId', {
          gmailMessageId,
          filename: att.filename,
          index: i,
        })
        failedCount++
      }
    } catch (error) {
      logger.warn('Failed to fetch attachment bytes', {
        gmailMessageId,
        filename: att.filename,
        providerAttachmentId: att.providerAttachmentId,
        index: i,
        error: error instanceof Error ? error.message : error,
      })
      failedCount++
    }
  }

  return { resolved, failedCount }
}
