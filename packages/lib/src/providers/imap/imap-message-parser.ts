// packages/lib/src/providers/imap/imap-message-parser.ts

import { createScopedLogger } from '@auxx/logger'
import type { ImapFlow } from 'imapflow'
import PostalMime from 'postal-mime'
import { pickMachineMailHeaders } from '../../ingest/filtering/machine-mail'
import type { ParsedEmail } from './types'

const logger = createScopedLogger('imap-parser')

/**
 * PostalMime hands attachment bodies back as an ArrayBuffer by default, but as a
 * string when a text/base64 encoding is requested. Measure both correctly.
 */
function attachmentByteLength(content: ArrayBuffer | string | undefined): number {
  if (!content) return 0
  return typeof content === 'string' ? Buffer.byteLength(content) : content.byteLength
}

export class ImapMessageParserService {
  /** Fetch and parse a single message by UID from an already-locked mailbox */
  async parseMessage(client: ImapFlow, uid: number): Promise<ParsedEmail | null> {
    try {
      const rawMessage = await client.download(String(uid), undefined, {
        uid: true,
      })

      if (!rawMessage || !rawMessage.content) {
        return null
      }

      // Read the stream into a buffer
      const chunks: Buffer[] = []
      for await (const chunk of rawMessage.content) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
      }
      const rawBuffer = Buffer.concat(chunks)

      // Parse with PostalMime
      const parser = new PostalMime()
      const parsed = await parser.parse(rawBuffer)

      return {
        messageId: parsed.messageId || undefined,
        inReplyTo: parsed.inReplyTo || undefined,
        references: parsed.headers?.find((h) => h.key === 'references')?.value || undefined,
        headers: pickMachineMailHeaders(parsed.headers),
        date: parsed.date || undefined,
        subject: parsed.subject || undefined,
        from: parsed.from
          ? [{ address: parsed.from.address || '', name: parsed.from.name || '' }]
          : [],
        to: (parsed.to || []).map((addr) => ({
          address: addr.address || '',
          name: addr.name || '',
        })),
        cc: (parsed.cc || []).map((addr) => ({
          address: addr.address || '',
          name: addr.name || '',
        })),
        bcc: (parsed.bcc || []).map((addr) => ({
          address: addr.address || '',
          name: addr.name || '',
        })),
        text: parsed.text || undefined,
        html: parsed.html || undefined,
        attachments: (parsed.attachments || []).map((att) => ({
          filename: att.filename || 'unnamed',
          mimeType: att.mimeType || 'application/octet-stream',
          size: attachmentByteLength(att.content),
        })),
      }
    } catch (error) {
      logger.error(`Failed to parse message UID ${uid}`, {
        error: error instanceof Error ? error.message : String(error),
      })
      return null
    }
  }
}
