// packages/lib/src/providers/outlook/outlook-attachment-fetcher.ts

import { createScopedLogger } from '@auxx/logger'
import type { Client } from '@microsoft/microsoft-graph-client'
import type { MessageAttachmentMeta } from '../../email/email-storage'

const logger = createScopedLogger('outlook-attachment-fetcher')

/**
 * Microsoft Graph file attachment shape.
 */
export interface GraphAttachment {
  '@odata.type': string
  id: string
  name: string
  contentType: string
  size: number
  isInline: boolean
  contentId?: string | null
  contentBytes?: string | null // base64-encoded, present for FileAttachments < 3MB
}

export interface OutlookFetchContext {
  client: Client
  integrationId: string
}

export interface OutlookFetchedAttachment {
  providerIndex: number // Original position in provider's attachment list (stable across retries)
  meta: MessageAttachmentMeta
  content: Buffer
}

/**
 * Fetches all file attachments for a single Outlook message.
 * Skips ItemAttachment and ReferenceAttachment types.
 * Returns attachment metadata with content bytes.
 */
export async function fetchOutlookAttachments(
  messageExternalId: string,
  context: OutlookFetchContext
): Promise<{ attachments: OutlookFetchedAttachment[]; failedCount: number }> {
  const response = await context.client
    .api(`/me/messages/${messageExternalId}/attachments`)
    .version('v1.0')
    .get()

  const items: GraphAttachment[] = response.value ?? []
  const results: OutlookFetchedAttachment[] = []
  let failedCount = 0

  // Filter to file attachments only, preserving original provider index
  const fileAttachments = items
    .map((item, index) => ({ item, providerIndex: index }))
    .filter(({ item }) => item['@odata.type']?.includes('fileAttachment'))

  for (const { item, providerIndex } of fileAttachments) {
    try {
      let content: Buffer

      if (item.contentBytes) {
        // Small attachment — contentBytes is base64-encoded
        content = Buffer.from(item.contentBytes, 'base64')
      } else {
        // Large attachment — fetch individual attachment object (always includes contentBytes)
        const fullAttachment = await context.client
          .api(`/me/messages/${messageExternalId}/attachments/${item.id}`)
          .version('v1.0')
          .get()
        content = Buffer.from(fullAttachment.contentBytes, 'base64')
      }

      if (content.length === 0) {
        logger.warn('Skipping 0-byte Outlook attachment', {
          messageExternalId,
          attachmentId: item.id,
          filename: item.name,
          providerIndex,
        })
        failedCount++
        continue
      }

      results.push({
        providerIndex,
        meta: {
          filename: item.name || 'attachment',
          mimeType: item.contentType || 'application/octet-stream',
          size: item.size || content.length,
          inline: item.isInline || false,
          contentId: item.contentId ? item.contentId.replace(/^<|>$/g, '') : null,
          providerAttachmentId: item.id,
        },
        content,
      })
    } catch (error) {
      logger.warn('Failed to fetch Outlook attachment', {
        messageExternalId,
        attachmentId: item.id,
        filename: item.name,
        providerIndex,
        error: error instanceof Error ? error.message : error,
      })
      failedCount++
    }
  }

  return { attachments: results, failedCount }
}
