// packages/lib/src/email/inbound/inbound-email-processor.ts

import { createScopedLogger } from '@auxx/logger'
import type { MessageData, ParticipantInputData } from '../email-storage'
import { MessageStorageService } from '../email-storage'
import { InboundIntegrationResolver } from './integration-resolver'
import { RawEmailParser } from './raw-email-parser'
import { S3RawEmailStore } from './s3-raw-email'
import { assertSenderAllowed } from './sender-allowlist-guard'
import type { InboundEmailAddress, SesInboundQueueMessage } from './types'

const logger = createScopedLogger('inbound-email-processor')

/**
 * normalizeParticipant converts a parsed email address into MessageStorageService participant input.
 */
function normalizeParticipant(address: InboundEmailAddress): ParticipantInputData {
  return {
    identifier: address.address,
    name: address.name ?? null,
  }
}

/**
 * normalizeParticipants converts a parsed email-address array into participant inputs.
 */
function normalizeParticipants(addresses: InboundEmailAddress[]): ParticipantInputData[] {
  return addresses.map(normalizeParticipant)
}

/**
 * deriveExternalThreadId derives a stable thread key for inbound MIME messages.
 */
function deriveExternalThreadId(message: {
  references: string | null
  inReplyTo: string | null
  internetMessageId: string | null
  sesMessageId: string
}): string {
  const firstReference = message.references?.split(/\s+/).find(Boolean)
  return (
    firstReference ||
    message.inReplyTo ||
    message.internetMessageId ||
    `ses:${message.sesMessageId}`
  )
}

/**
 * InboundEmailProcessor handles the full Railway-side SES inbound processing pipeline.
 */
export class InboundEmailProcessor {
  /**
   * rawEmailStore fetches raw MIME from S3.
   */
  private rawEmailStore = new S3RawEmailStore()

  /**
   * rawEmailParser parses raw MIME into normalized fields.
   */
  private rawEmailParser = new RawEmailParser()

  /**
   * integrationResolver maps forwarded recipients to org integrations.
   */
  private integrationResolver = new InboundIntegrationResolver()

  /**
   * processFromQueueMessage fetches, parses, authorizes, and stores one inbound email.
   */
  async processFromQueueMessage(message: SesInboundQueueMessage): Promise<void> {
    const rawEmail = await this.rawEmailStore.getRawEmailString(message.s3Bucket, message.s3Key)
    const parsedEmail = await this.rawEmailParser.parse(rawEmail)

    if (!parsedEmail.from?.address) {
      throw new Error(`Inbound SES message ${message.sesMessageId} is missing a sender address`)
    }

    const resolvedIntegration = await this.integrationResolver.resolve(message.recipients)
    assertSenderAllowed(parsedEmail.from.address, resolvedIntegration.allowedSenders)

    const receivedAt = new Date(message.receivedAt)
    const sentAt = parsedEmail.sentAt ?? receivedAt
    const fallbackRecipients =
      parsedEmail.to.length > 0
        ? parsedEmail.to
        : message.recipients.map((recipient) => ({ address: recipient.toLowerCase(), name: null }))

    const messageData: MessageData = {
      externalId: message.sesMessageId,
      externalThreadId: deriveExternalThreadId({
        references: parsedEmail.references,
        inReplyTo: parsedEmail.inReplyTo,
        internetMessageId: parsedEmail.internetMessageId,
        sesMessageId: message.sesMessageId,
      }),
      inboxId: resolvedIntegration.inboxId ?? undefined,
      integrationId: resolvedIntegration.integrationId,
      organizationId: resolvedIntegration.organizationId,
      isInbound: true,
      subject: parsedEmail.subject,
      textHtml: parsedEmail.textHtml,
      textPlain: parsedEmail.textPlain,
      snippet: parsedEmail.snippet,
      metadata: {
        inbound: {
          provider: 'ses',
          sesMessageId: message.sesMessageId,
          s3Bucket: message.s3Bucket,
          s3Key: message.s3Key,
          matchedRecipient: resolvedIntegration.matchedRecipient,
          headers: parsedEmail.headers,
          recipients: message.recipients,
        },
      },
      createdTime: receivedAt,
      sentAt,
      receivedAt,
      from: normalizeParticipant(parsedEmail.from),
      to: normalizeParticipants(fallbackRecipients),
      cc: normalizeParticipants(parsedEmail.cc),
      bcc: normalizeParticipants(parsedEmail.bcc),
      replyTo: normalizeParticipants(parsedEmail.replyTo),
      hasAttachments: parsedEmail.attachments.length > 0,
      attachments: parsedEmail.attachments.map((attachment) => ({
        filename: attachment.filename,
        mimeType: attachment.mimeType,
        size: attachment.size,
        inline: attachment.inline,
        contentId: attachment.contentId ?? null,
        content: attachment.content ?? null,
      })),
      internetMessageId: parsedEmail.internetMessageId,
      inReplyTo: parsedEmail.inReplyTo,
      references: parsedEmail.references,
    }

    const storageService = new MessageStorageService(resolvedIntegration.organizationId)
    await storageService.storeMessage(messageData)

    logger.info('Stored inbound email from SES queue message', {
      sesMessageId: message.sesMessageId,
      organizationId: resolvedIntegration.organizationId,
      integrationId: resolvedIntegration.integrationId,
      inboxId: resolvedIntegration.inboxId,
      matchedRecipient: resolvedIntegration.matchedRecipient,
      sender: parsedEmail.from.address,
    })
  }
}
