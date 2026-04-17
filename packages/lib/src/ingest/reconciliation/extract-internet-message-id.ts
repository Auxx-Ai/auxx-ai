// packages/lib/src/ingest/reconciliation/extract-internet-message-id.ts

import type { MessageData } from '../types'

/**
 * Best-effort Internet Message-ID lookup from a MessageData: direct field,
 * metadata.headers map, or internetHeaders array (case-insensitive header name).
 */
export function extractInternetMessageId(messageData: MessageData): string | undefined {
  if (messageData.internetMessageId) return messageData.internetMessageId

  const metadata = messageData.metadata as any
  const headers = metadata?.headers
  if (headers?.['message-id']) return headers['message-id']
  if (headers?.['Message-ID']) return headers['Message-ID']

  if (messageData.internetHeaders && Array.isArray(messageData.internetHeaders)) {
    for (const header of messageData.internetHeaders) {
      const h = header as any
      if (h.name?.toLowerCase() === 'message-id' && h.value) return h.value
    }
  }

  return undefined
}
