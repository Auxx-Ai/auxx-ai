// packages/lib/src/providers/google/messages/parse-message.ts

import { createScopedLogger } from '@auxx/logger'
import { extractEmailAddress, isUserEmail } from '@auxx/utils'
import parse from 'gmail-api-parse-message'
import { EmailLabel, type MessageData } from '../../../email/email-storage'
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
 * Convert parsed Gmail messages to MessageData format
 */
export function convertMessagesToMessageData(
  messages: ParsedGmailMessage[],
  integrationId: string,
  inboxId: string | undefined,
  organizationId: string,
  userEmails: string[]
): MessageData[] {
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
            if (!isNaN(parsedDate.getTime())) {
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

        // Process attachments
        const attachments = (message.attachments || []).map((att: any) => ({
          filename: att.filename || 'attachment',
          mimeType: att.mimeType || 'application/octet-stream',
          size: att.size || 0,
          inline: !!att.inline,
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
  if (message.headers && message.headers['from']) {
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
