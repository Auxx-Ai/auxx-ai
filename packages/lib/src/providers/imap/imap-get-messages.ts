// packages/lib/src/providers/imap/imap-get-messages.ts

import { createScopedLogger } from '@auxx/logger'
import type { MessageData } from '../../email/email-storage'
import { ImapClientProvider } from './imap-client-provider'
import { ImapMessageParserService } from './imap-message-parser'
import { ImapMessageTextExtractorService } from './imap-text-extractor'
import type { ImapCredentialData } from './types'
import { parseMessageId } from './utils/parse-message-id'

const logger = createScopedLogger('imap-get-messages')

interface GetMessagesArgs {
  externalIds: string[]
  credentials: ImapCredentialData
  integrationId: string
  organizationId: string
  inboxId?: string
  userEmail: string
}

export class ImapGetMessagesService {
  private clientProvider = new ImapClientProvider()
  private parser = new ImapMessageParserService()
  private textExtractor = new ImapMessageTextExtractorService()

  /** Fetch and parse messages by external IDs (Phase 2 of two-phase sync) */
  async getMessages(args: GetMessagesArgs): Promise<MessageData[]> {
    const { externalIds, credentials, integrationId, organizationId, inboxId, userEmail } = args

    // Group message IDs by folder
    const messagesByFolder = new Map<string, number[]>()

    for (const externalId of externalIds) {
      const parsed = parseMessageId(externalId)
      if (!parsed) continue

      const existing = messagesByFolder.get(parsed.folder) ?? []
      existing.push(parsed.uid)
      messagesByFolder.set(parsed.folder, existing)
    }

    const messages: MessageData[] = []
    const client = await this.clientProvider.getClient(credentials)

    try {
      for (const [folderPath, uids] of messagesByFolder) {
        let lock

        try {
          lock = await client.getMailboxLock(folderPath)

          for (const uid of uids) {
            const parsed = await this.parser.parseMessage(client, uid)
            if (!parsed) continue

            const fromAddress = parsed.from[0]?.address || ''
            const isInbound = fromAddress.toLowerCase() !== userEmail.toLowerCase()

            // Extract clean text
            const cleanText = this.textExtractor.extractText(parsed.text, parsed.html)

            // Build thread external ID from References or In-Reply-To headers
            const threadExternalId =
              parsed.references?.split(/\s+/)[0] ||
              parsed.inReplyTo ||
              parsed.messageId ||
              `${folderPath}:${uid}`

            const sentAt = parsed.date ? new Date(parsed.date) : new Date()

            const messageData: MessageData = {
              externalId: `${folderPath}:${uid}`,
              externalThreadId: threadExternalId,
              inboxId,
              integrationId,
              organizationId,
              isInbound,
              subject: parsed.subject || null,
              textHtml: parsed.html || null,
              textPlain: cleanText || null,
              snippet: cleanText ? cleanText.substring(0, 200) : null,
              metadata: null,
              createdTime: sentAt,
              sentAt,
              receivedAt: sentAt,
              from: {
                address: fromAddress,
                name: parsed.from[0]?.name || '',
              },
              to: parsed.to.map((addr) => ({
                address: addr.address,
                name: addr.name,
              })),
              cc: parsed.cc.map((addr) => ({
                address: addr.address,
                name: addr.name,
              })),
              bcc: parsed.bcc.map((addr) => ({
                address: addr.address,
                name: addr.name,
              })),
              hasAttachments: parsed.attachments.length > 0,
              attachments: parsed.attachments.map((att) => ({
                filename: att.filename,
                mimeType: att.mimeType,
                size: att.size,
              })),
              internetMessageId: parsed.messageId || null,
              inReplyTo: parsed.inReplyTo || null,
              references: parsed.references || null,
              labelIds: [folderPath],
              folderId: folderPath,
            }

            messages.push(messageData)
          }
        } catch (error) {
          logger.error(`Error fetching messages from folder ${folderPath}`, {
            error: error instanceof Error ? error.message : String(error),
            uids,
          })
        } finally {
          if (lock) lock.release()
        }
      }
    } finally {
      await this.clientProvider.closeClient(client)
    }

    return messages
  }
}
