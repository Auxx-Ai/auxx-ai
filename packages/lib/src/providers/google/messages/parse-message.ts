// packages/lib/src/providers/google/messages/parse-message.ts

import { createScopedLogger } from '@auxx/logger'
import { extractEmailAddress, isUserEmail } from '@auxx/utils'
import parse from 'gmail-api-parse-message'
import type { gmail_v1 } from 'googleapis'
import {
  EmailLabel,
  type MessageAttachmentMeta,
  type MessageData,
} from '../../../email/email-storage'
import { isDefined, parseMultipleParticipants, parseParticipantString } from '../../provider-utils'
import type { GmailMessageWithPayload, ParsedGmailMessage } from '../types'

const logger = createScopedLogger('google-parse-message')

/**
 * Parse a Gmail message using gmail-api-parse-message library
 */
export function parseGmailMessage(message: GmailMessageWithPayload): ParsedGmailMessage {
  try {
    return parse(message) as ParsedGmailMessage
  } catch (error) {
    logger.error('Error parsing message', {
      messageId: message.id,
      error,
    })

    // Return minimal structure on error
    return {
      id: message.id,
      threadId: message.threadId,
      labelIds: message.labelIds || [],
      snippet: 'Error parsing message',
      historyId: message.historyId || '0',
      internalDate: message.internalDate || '0',
      attachments: [],
      headers: {},
      textPlain: 'Error parsing content.',
      textHtml: '<p>Error.</p>',
    }
  }
}

/**
 * Attachment metadata extracted directly from the raw Gmail API payload.
 * Bypasses the gmail-api-parse-message library which discards body.data for inline parts.
 */
export interface GmailPayloadAttachment {
  filename: string
  mimeType: string
  size: number
  inline: boolean
  contentId: string | null
  /** Gmail attachmentId for large parts (requires separate API fetch) */
  gmailAttachmentId: string | null
  /** base64url-encoded body.data for small embedded parts */
  embeddedData: string | null
}

/**
 * Index MIME part headers into a lowercase key map for easy lookup.
 */
function indexPartHeaders(
  headers: gmail_v1.Schema$MessagePartHeader[] | undefined
): Record<string, string> {
  const result: Record<string, string> = {}
  if (!headers) return result
  for (const h of headers) {
    if (h.name && h.value) {
      result[h.name.toLowerCase()] = h.value
    }
  }
  return result
}

/**
 * Recursively walks the raw Gmail API payload to extract all attachment/inline parts.
 * This replaces the library's attachments[] and inline[] with a single unified list
 * that preserves embedded body.data for small parts and Content-ID for inline images.
 */
export function extractPayloadAttachments(
  payload: gmail_v1.Schema$MessagePart
): GmailPayloadAttachment[] {
  const results: GmailPayloadAttachment[] = []

  function walk(part: gmail_v1.Schema$MessagePart) {
    if (part.parts) {
      for (const child of part.parts) walk(child)
    }

    if (!part.body) return

    const headers = indexPartHeaders(part.headers)
    const isText = part.mimeType?.startsWith('text/html') || part.mimeType?.startsWith('text/plain')
    const hasAttachmentId = !!part.body.attachmentId
    const disposition = headers['content-disposition']?.toLowerCase() ?? ''
    const isInline = disposition.includes('inline')
    const isAttachmentDisposition = disposition.includes('attachment')

    // Skip text body parts (handled separately as textHtml/textPlain)
    if (isText && !hasAttachmentId && !isAttachmentDisposition) return

    // Detect Content-ID presence (identifies inline images even without Content-Disposition)
    const contentIdRaw = headers['content-id']
    const hasContentId = !!contentIdRaw
    const contentId = contentIdRaw ? contentIdRaw.replace(/^<|>$/g, '') : null

    // This is a file part if it has any attachment/inline indicator.
    // Content-ID alone (without Content-Disposition) qualifies as inline —
    // many MIME inline images omit Content-Disposition entirely.
    // A filename also qualifies, as it indicates a file part.
    if (hasAttachmentId || isAttachmentDisposition || isInline || hasContentId || part.filename) {
      results.push({
        filename: part.filename || 'attachment',
        mimeType: part.mimeType || 'application/octet-stream',
        size: part.body.size || 0,
        inline:
          (isInline || (hasContentId && !isAttachmentDisposition)) && !isAttachmentDisposition,
        contentId,
        gmailAttachmentId: part.body.attachmentId || null,
        embeddedData: part.body.data || null,
      })
    }
  }

  walk(payload)
  return results
}

/**
 * Convert parsed Gmail messages to MessageData format.
 * Requires both parsed messages (for headers, body text) and raw messages (for attachment extraction).
 */
export function convertMessagesToMessageData(
  messages: ParsedGmailMessage[],
  rawMessages: GmailMessageWithPayload[],
  integrationId: string,
  inboxId: string | undefined,
  organizationId: string,
  userEmails: string[]
): MessageData[] {
  // Index raw messages by ID for lookup
  const rawMessageMap = new Map<string, GmailMessageWithPayload>()
  for (const raw of rawMessages) {
    rawMessageMap.set(raw.id, raw)
  }
  return messages
    .map((message): MessageData | null => {
      try {
        if (!inboxId) {
          logger.error('Inbox ID missing during message conversion.', {
            messageId: message.id,
          })
          return null
        }

        logger.info('Converting Gmail message to MessageData', {
          messageId: message.id,
          integrationId,
        })

        // Extract participants
        const fromInput = parseParticipantString(message.headers['from'] || '')
        const toInputs = parseMultipleParticipants(message.headers['to'] || '')
        const ccInputs = parseMultipleParticipants(message.headers['cc'] || '')
        const bccInputs = parseMultipleParticipants(message.headers['bcc'] || '')
        const replyToInputs = parseMultipleParticipants(message.headers['reply-to'] || '')

        if (!fromInput?.identifier) {
          logger.error('Skipping message conversion: cannot parse from header.', {
            messageId: message.id,
          })
          return null
        }

        // Parse dates
        const internalDate = message.internalDate
        const receivedAt = new Date(parseInt(internalDate, 10))

        let sentAt = receivedAt
        const dateHeader = message.headers['date']
        if (dateHeader) {
          try {
            const parsedDate = new Date(dateHeader)
            if (!Number.isNaN(parsedDate.getTime())) {
              sentAt = parsedDate
            }
          } catch (e) {
            logger.debug('Failed to parse Date header, using internalDate', {
              dateHeader,
              messageId: message.id,
            })
          }
        }

        // Determine if inbound
        const isInbound = determineIsInbound(message, userEmails)

        // Determine email label
        const emailLabel = determineEmailLabel(message.labelIds || [])

        // Extract attachments from raw payload (bypasses library limitations)
        const rawMessage = rawMessageMap.get(message.id)
        const payloadAttachments = rawMessage?.payload
          ? extractPayloadAttachments(rawMessage.payload)
          : []

        // Map to MessageAttachmentMeta for downstream ingest
        const providerAttachments: MessageAttachmentMeta[] = payloadAttachments.map((att) => ({
          filename: att.filename,
          mimeType: att.mimeType,
          size: att.size,
          inline: att.inline,
          contentId: att.contentId,
          providerAttachmentId: att.gmailAttachmentId,
          embeddedData: att.embeddedData,
        }))

        // Legacy attachments array (for hasAttachments and backward compat)
        const attachments = payloadAttachments.map((att) => ({
          filename: att.filename,
          mimeType: att.mimeType,
          size: att.size,
          inline: att.inline,
          contentId: att.contentId,
        }))

        return {
          externalId: message.id,
          externalThreadId: message.threadId,
          inboxId,
          integrationId,
          organizationId,
          createdTime: receivedAt,
          sentAt,
          receivedAt,
          subject: message.headers['subject'] || '',
          from: fromInput,
          to: toInputs,
          cc: ccInputs,
          bcc: bccInputs,
          replyTo: replyToInputs,
          hasAttachments: attachments.length > 0,
          attachments,
          providerAttachments,
          textHtml: message.textHtml || '',
          textPlain: message.textPlain || '',
          snippet: message.snippet || '',
          historyId: message.historyId ? Number(message.historyId) : null,
          internetMessageId: message.headers['message-id'] || message.id,
          labelIds: message.labelIds || [],
          keywords: [],
          inReplyTo: message.headers['in-reply-to'],
          references: message.headers['references'],
          metadata: { headers: message.headers },
          isInbound,
          isAutoReply: !!message.headers['auto-submitted'],
        } as MessageData
      } catch (error: any) {
        logger.error('Error converting Gmail message to MessageData:', {
          error: error.message,
          messageId: message.id,
        })
        return null
      }
    })
    .filter(isDefined)
}

/**
 * Determine if message is inbound based on labels and sender
 */
function determineIsInbound(message: ParsedGmailMessage, userEmails: string[]): boolean {
  const labelIds = message.labelIds || []

  // Drafts are not inbound
  if (labelIds.includes('DRAFT')) {
    return false
  }

  // SENT label is authoritative - messages with SENT are outbound
  if (labelIds.includes('SENT')) {
    return false
  }

  // Check if from address matches any user email
  if (message.headers?.['from']) {
    const fromEmail = extractEmailAddress(message.headers['from'])
    if (fromEmail && isUserEmail(fromEmail, userEmails)) {
      return false
    }
  }

  // Default: messages received from others are inbound
  return true
}

/**
 * Determine the email label based on Gmail labels
 */
function determineEmailLabel(labelIds: string[]): EmailLabel {
  if (labelIds.includes('DRAFT')) return EmailLabel.draft
  if (labelIds.includes('SENT')) return EmailLabel.sent
  // Note: EmailLabel enum doesn't have spam/trash, so we map them to inbox
  // SPAM and TRASH messages are still inbound, just in different folders
  if (labelIds.includes('INBOX')) return EmailLabel.inbox
  // Default for messages with only custom labels, SPAM, TRASH, etc.
  return EmailLabel.inbox
}
