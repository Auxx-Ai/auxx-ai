// packages/lib/src/email/inbound/inbound-email-processor.ts

import { createScopedLogger } from '@auxx/logger'
import type { MessageData, ParticipantInputData } from '../email-storage'
import { MessageStorageService } from '../email-storage'
import { InboundAttachmentIngestService } from './attachment-ingest.service'
import { InboundBodyIngestService } from './body-ingest.service'
import { InboundChannelResolver } from './channel-resolver'
import { PermanentProcessingError } from './errors'
import { RawEmailParser } from './raw-email-parser'
import { S3RawEmailStore } from './s3-raw-email'
import { assertSenderAllowed } from './sender-allowlist-guard'
import type { InboundEmailAddress, RawEmailStore, SesInboundQueueMessage } from './types'

const logger = createScopedLogger('inbound-email-processor')

/**
 * InboundEmailSource identifies whether the processor is handling real SES traffic or dev harness input.
 */
type InboundEmailSource = 'ses' | 'dev-harness'

/**
 * InboundEmailProcessorOptions configures optional test/dev overrides for inbound processing.
 */
interface InboundEmailProcessorOptions {
  rawEmailStore?: RawEmailStore
  inboundSource?: InboundEmailSource
}

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
  private rawEmailStore: RawEmailStore

  /**
   * rawEmailParser parses raw MIME into normalized fields.
   */
  private rawEmailParser = new RawEmailParser()

  /**
   * inboundSource marks whether the message came from SES or the dev harness.
   */
  private inboundSource: InboundEmailSource

  /**
   * channelResolver maps forwarded recipients to org channels.
   */
  private channelResolver = new InboundChannelResolver()

  /**
   * bodyIngestService uploads HTML bodies to object storage.
   */
  private bodyIngestService = new InboundBodyIngestService()

  /**
   * attachmentIngestService uploads MIME attachments and creates canonical records.
   */
  private attachmentIngestService = new InboundAttachmentIngestService()

  /**
   * constructor initializes the processor with optional dependency overrides.
   */
  constructor(options: InboundEmailProcessorOptions = {}) {
    this.rawEmailStore = options.rawEmailStore ?? new S3RawEmailStore()
    this.inboundSource = options.inboundSource ?? 'ses'
  }

  /**
   * processFromQueueMessage fetches, parses, authorizes, and stores one inbound email.
   */
  async processFromQueueMessage(message: SesInboundQueueMessage): Promise<void> {
    const rawEmail = await this.rawEmailStore.getRawEmailString(message.s3Bucket, message.s3Key)
    const parsedEmail = await this.rawEmailParser.parse(rawEmail)

    if (!parsedEmail.from?.address) {
      throw new PermanentProcessingError(
        `Inbound SES message ${message.sesMessageId} is missing a sender address`,
        'malformed_email'
      )
    }

    const resolvedIntegration = await this.channelResolver.resolve(message.recipients)
    assertSenderAllowed(parsedEmail.from.address, resolvedIntegration.allowedSenders)

    const organizationId = resolvedIntegration.organizationId
    const contentScopeId = message.sesMessageId

    const receivedAt = new Date(message.receivedAt)
    const sentAt = parsedEmail.sentAt ?? receivedAt
    const fallbackRecipients =
      parsedEmail.to.length > 0
        ? parsedEmail.to
        : message.recipients.map((recipient) => ({ address: recipient.toLowerCase(), name: null }))

    // 1. Upload HTML body to object storage (before storeMessage so we have the storageLocationId)
    const bodyMeta = await this.bodyIngestService.ingestBody(
      { textHtml: parsedEmail.textHtml },
      { organizationId, contentScopeId }
    )

    // 2. Store message with htmlBodyStorageLocationId
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
      organizationId,
      isInbound: true,
      subject: parsedEmail.subject,
      textHtml: parsedEmail.textHtml,
      textPlain: parsedEmail.textPlain,
      snippet: parsedEmail.snippet,
      htmlBodyStorageLocationId: bodyMeta.htmlBodyStorageLocationId,
      metadata: {
        inbound: {
          provider: 'ses',
          ...(this.inboundSource === 'dev-harness' ? { source: this.inboundSource } : {}),
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
      internetMessageId: parsedEmail.internetMessageId,
      inReplyTo: parsedEmail.inReplyTo,
      references: parsedEmail.references,
    }

    const storageService = new MessageStorageService(organizationId)
    const { messageId, isNew } = await storageService.storeMessage(messageData)

    // 3. Ingest MIME-backed attachments (only for new messages)
    if (isNew && parsedEmail.attachments.length > 0) {
      await this.attachmentIngestService.ingestAll(
        parsedEmail.attachments.map((att, index) => ({
          content: Buffer.from(att.content ?? '', 'base64'),
          filename: att.filename,
          mimeType: att.mimeType,
          inline: att.inline,
          contentId: att.contentId ?? null,
          attachmentOrder: index,
        })),
        { organizationId, messageId, contentScopeId }
      )
    }

    logger.info('Stored inbound email from SES queue message', {
      sesMessageId: message.sesMessageId,
      organizationId,
      integrationId: resolvedIntegration.integrationId,
      inboxId: resolvedIntegration.inboxId,
      matchedRecipient: resolvedIntegration.matchedRecipient,
      sender: parsedEmail.from.address,
      hasHtmlBody: !!bodyMeta.htmlBodyStorageLocationId,
      attachmentCount: parsedEmail.attachments.length,
    })
  }
}
