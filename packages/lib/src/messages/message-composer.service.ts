// packages/lib/src/messages/message-composer.service.ts

import { getAppHostname } from '@auxx/config/server'
import { type Database, schema, type Transaction } from '@auxx/database'
import { ParticipantRole, SendStatus } from '@auxx/database/enums'
import { createScopedLogger } from '@auxx/logger'
import { and, eq } from 'drizzle-orm'
import { type FileAttachment, MessageAttachmentService } from './message-attachment.service'
import type { ComposedMessage, ProcessedParticipants } from './types/message-sending.types'

const logger = createScopedLogger('message-composer')

/**
 * Handles message composition and preparation for sending
 */
export class MessageComposerService {
  constructor(
    private organizationId: string,
    private db: Database
  ) {
    // Note: We'll need userId for MessageAttachmentService, will be passed in methods
  }

  /**
   * Composes a message for sending
   * Creates the database record in PENDING state
   */
  async composeMessage(input: {
    threadId: string
    userId: string
    organizationId: string
    integrationId: string
    messageId?: string // Optional pre-generated Message-ID
    subject: string
    textHtml?: string | null
    textPlain?: string | null
    participants: ProcessedParticipants
    signatureId?: string | null
    draftMessageId?: string | null
    keepAsDraft?: boolean // @deprecated - no longer used, drafts use separate Draft table
    inReplyTo?: string | null
    references?: string | null
    attachmentIds?: string[] // MediaAsset IDs to attach
  }): Promise<ComposedMessage> {
    const messageId = input.messageId || this.generateMessageId()
    const sendToken = this.generateSendToken()

    if (input.draftMessageId) {
      if (input.keepAsDraft) {
        // Update existing draft without promoting to pending
        return this.updateExistingDraft({
          ...input,
          draftMessageId: input.draftMessageId,
          messageId,
          sendToken,
        })
      } else {
        // Promote draft to pending send
        return this.promoteDraftToPending({
          ...input,
          draftMessageId: input.draftMessageId,
          messageId,
          sendToken,
        })
      }
    }

    // Create new message in PENDING state
    return this.createPendingMessage({
      ...input,
      messageId,
      sendToken,
    })
  }

  /**
   * Creates a new message in PENDING state
   */
  private async createPendingMessage(input: {
    threadId: string
    userId: string
    organizationId: string
    integrationId: string
    subject: string
    textHtml?: string | null
    textPlain?: string | null
    participants: ProcessedParticipants
    signatureId?: string | null
    messageId: string
    sendToken: string
    inReplyTo?: string | null
    references?: string | null
    attachmentIds?: string[]
  }): Promise<ComposedMessage> {
    logger.info('Creating pending message', {
      threadId: input.threadId,
      messageId: input.messageId,
      sendToken: input.sendToken,
    })

    const now = new Date()

    // Ensure we have plain text version
    const textPlain = input.textPlain || (input.textHtml ? this.stripHtml(input.textHtml) : '')

    // Get thread info
    const thread = await this.db.query.Thread.findFirst({
      where: (threads, { eq }) => eq(threads.id, input.threadId),
      columns: {
        externalId: true,
      },
    })

    if (!thread) {
      throw new Error(`Thread ${input.threadId} not found`)
    }

    // Create message with participants in a transaction
    const result = await this.db.transaction(async (tx: Transaction) => {
      // Create the message
      const [message] = await tx
        .insert(schema.Message)
        .values({
          // IDs and references
          threadId: input.threadId,
          organizationId: input.organizationId,
          integrationId: input.integrationId,
          // Note: integrationType removed - derived from Integration.provider
          createdById: input.userId,

          // Use placeholder external IDs that will be updated
          externalId: `pending_${input.sendToken}`,
          externalThreadId: thread.externalId ?? null,

          // Message identifiers
          internetMessageId: input.messageId,
          sendToken: input.sendToken,
          sendStatus: SendStatus.PENDING,

          // Content
          subject: input.subject,
          textHtml: input.textHtml,
          textPlain: textPlain,

          // Participants
          fromId: input.participants.from.id,

          // Signature
          signatureId: input.signatureId,

          // Timestamps
          createdAt: now,
          updatedAt: now,
          sentAt: null, // Will be set when actually sent

          // Flags
          isInbound: false,
          hasAttachments: input.attachmentIds && input.attachmentIds.length > 0,

          // Initialize send tracking
          attempts: 0,
          lastAttemptAt: null,
          providerError: null,
        })
        .returning()

      if (!message) {
        throw new Error('No message created')
      }
      // Create MessageParticipant links
      const participantLinks = [
        // From
        {
          messageId: message.id,
          participantId: input.participants.from.id,
          role: ParticipantRole.FROM,
        },
        // To
        ...input.participants.to.map((p) => ({
          messageId: message.id,
          participantId: p.id,
          role: ParticipantRole.TO,
        })),
        // CC
        ...(input.participants.cc || []).map((p) => ({
          messageId: message.id,
          participantId: p.id,
          role: ParticipantRole.CC,
        })),
        // BCC
        ...(input.participants.bcc || []).map((p) => ({
          messageId: message.id,
          participantId: p.id,
          role: ParticipantRole.BCC,
        })),
      ]

      await tx.insert(schema.MessageParticipant).values(participantLinks).onConflictDoNothing()

      // Update thread latestMessageId
      // All messages are now "real" messages - drafts are in separate Draft table
      await tx
        .update(schema.Thread)
        .set({ latestMessageId: message.id })
        .where(eq(schema.Thread.id, input.threadId))

      // Note: Attachments will be linked outside transaction using MessageAttachmentService

      return message
    })

    // Link attachments after transaction using MessageAttachmentService
    if (input.attachmentIds && input.attachmentIds.length > 0) {
      const messageAttachmentService = new MessageAttachmentService(
        input.organizationId,
        input.userId,
        this.db
      )
      // Detect actual types and friendly names for each ID
      const fileAttachments = await this.detectAttachmentTypes(
        input.attachmentIds,
        input.organizationId
      )
      if (fileAttachments.length > 0) {
        await messageAttachmentService.linkFilesToMessage(result.id, fileAttachments)
      }
    }

    return {
      id: result.id,
      messageId: input.messageId,
      sendToken: input.sendToken,
      threadId: input.threadId,
      subject: input.subject,
      textHtml: input.textHtml,
      textPlain: textPlain,
      references: input.references,
      inReplyTo: input.inReplyTo,
      participantIds: input.participants.all.map((p) => p.id),
    }
  }

  /**
   * Detect whether provided IDs are MediaAssets or FolderFiles and build FileAttachment entries.
   * Keeps input order; falls back to generic names when metadata is missing.
   */
  private async detectAttachmentTypes(
    ids: string[],
    organizationId: string
  ): Promise<FileAttachment[]> {
    const results: FileAttachment[] = []

    for (let i = 0; i < ids.length; i++) {
      const id = ids[i]
      // Try MediaAsset first
      const asset = await this.db.query.MediaAsset.findFirst({
        where: (assets, { eq, and }) =>
          and(eq(assets.id, id!), eq(assets.organizationId, organizationId)),
        columns: { id: true, name: true },
      })
      if (asset) {
        results.push({
          id,
          name: asset.name || `attachment-${i + 1}`,
          type: 'asset',
        })
        continue
      }

      // Try FolderFile
      const file = await this.db.query.FolderFile.findFirst({
        where: (files, { eq, and }) =>
          and(eq(files.id, id!), eq(files.organizationId, organizationId)),
        columns: { id: true, name: true },
      })
      if (file) {
        results.push({
          id,
          name: file.name || `attachment-${i + 1}`,
          type: 'file',
        })
        continue
      }

      // Neither found: skip with a warning
      logger.warn('Attachment ID not found in asset or file tables; skipping', { id })
    }

    return results
  }

  /**
   * Updates an existing draft message without promoting to pending
   */
  private async updateExistingDraft(input: {
    draftMessageId: string
    userId: string
    organizationId: string
    threadId: string
    subject: string
    textHtml?: string | null
    textPlain?: string | null
    participants: ProcessedParticipants
    signatureId?: string | null
    messageId: string
    sendToken: string
    inReplyTo?: string | null
    references?: string | null
  }): Promise<ComposedMessage> {
    // @deprecated - This method is deprecated. Drafts are now stored in separate Draft table.
    logger.info('Updating existing draft', {
      draftMessageId: input.draftMessageId,
      messageId: input.messageId,
    })

    const now = new Date()

    // Ensure we have plain text version
    const textPlain = input.textPlain || (input.textHtml ? this.stripHtml(input.textHtml) : '')

    // Update the draft message
    const result = await this.db.transaction(async (tx) => {
      // Update the draft
      const [message] = await tx
        .update(schema.Message)
        .set({
          // Update content
          subject: input.subject,
          textHtml: input.textHtml,
          textPlain: textPlain,

          // Update references
          inReplyTo: input.inReplyTo,
          references: input.references,

          // Update signature
          signatureId: input.signatureId,

          // Update timestamps
          updatedAt: now,

          // Update participants
          fromId: input.participants.from.id,
        })
        .where(
          and(
            eq(schema.Message.id, input.draftMessageId),
            eq(schema.Message.createdById, input.userId),
            eq(schema.Message.organizationId, input.organizationId)
          )
        )
        .returning()

      if (!message) throw new Error('no message')

      // Update participants - first delete existing ones
      await tx
        .delete(schema.MessageParticipant)
        .where(eq(schema.MessageParticipant.messageId, message.id))

      const participantLinks = [
        // From
        {
          messageId: message.id,
          participantId: input.participants.from.id,
          role: ParticipantRole.FROM,
        },
        // To
        ...input.participants.to.map((p) => ({
          messageId: message.id,
          participantId: p.id,
          role: ParticipantRole.TO,
        })),
        // CC
        ...(input.participants.cc || []).map((p) => ({
          messageId: message.id,
          participantId: p.id,
          role: ParticipantRole.CC,
        })),
        // BCC
        ...(input.participants.bcc || []).map((p) => ({
          messageId: message.id,
          participantId: p.id,
          role: ParticipantRole.BCC,
        })),
      ]

      await tx.insert(schema.MessageParticipant).values(participantLinks).onConflictDoNothing()

      return message
    })

    return {
      id: result.id,
      messageId: input.messageId,
      sendToken: input.sendToken,
      threadId: input.threadId,
      subject: input.subject,
      textHtml: input.textHtml,
      textPlain: textPlain,
      references: input.references,
      inReplyTo: input.inReplyTo,
      participantIds: input.participants.all.map((p) => p.id),
    }
  }

  /**
   * Promotes a draft message to PENDING send state
   */
  private async promoteDraftToPending(input: {
    draftMessageId: string
    userId: string
    organizationId: string
    threadId: string
    subject: string
    textHtml?: string | null
    textPlain?: string | null
    participants: ProcessedParticipants
    signatureId?: string | null
    messageId: string
    sendToken: string
    inReplyTo?: string | null
    references?: string | null
  }): Promise<ComposedMessage> {
    // @deprecated - This method is deprecated. Drafts are now stored in separate Draft table.
    logger.info('Promoting draft to pending', {
      draftMessageId: input.draftMessageId,
      messageId: input.messageId,
      sendToken: input.sendToken,
    })

    const now = new Date()

    // Ensure we have plain text version
    const textPlain = input.textPlain || (input.textHtml ? this.stripHtml(input.textHtml) : '')

    // First check what draft actually exists
    const existingDraft = await this.db.query.Message.findFirst({
      where: (messages, { eq }) => eq(messages.id, input.draftMessageId),
      columns: {
        id: true,
        createdById: true,
        organizationId: true,
        sendStatus: true,
      },
    })

    if (!existingDraft) {
      throw new Error(`Draft message ${input.draftMessageId} not found`)
    }

    logger.info('Draft found for promotion', {
      draftMessageId: input.draftMessageId,
      existingDraft,
    })

    // Update the draft message to pending state
    const result = await this.db.transaction(async (tx) => {
      // Update the draft
      const [message] = await tx
        .update(schema.Message)
        .set({
          // Update identifiers
          internetMessageId: input.messageId,
          sendToken: input.sendToken,
          sendStatus: SendStatus.PENDING,

          // Clear draft external IDs
          externalId: null,
          externalThreadId: null,

          // Update content
          subject: input.subject,
          textHtml: input.textHtml,
          textPlain: textPlain,

          // Update references
          inReplyTo: input.inReplyTo,
          references: input.references,

          // Update signature
          signatureId: input.signatureId,

          // Update timestamps
          updatedAt: now,

          // Reset send tracking
          attempts: 0,
          lastAttemptAt: null,
          providerError: null,
        })
        .where(
          and(
            eq(schema.Message.id, input.draftMessageId),
            eq(schema.Message.createdById, input.userId),
            eq(schema.Message.organizationId, input.organizationId)
          )
        )
        .returning()

      if (!message) throw new Error('No message')

      // Update participants - first delete existing ones
      await tx
        .delete(schema.MessageParticipant)
        .where(eq(schema.MessageParticipant.messageId, message.id))

      const participantLinks = [
        // From
        {
          messageId: message.id,
          participantId: input.participants.from.id,
          role: ParticipantRole.FROM,
        },
        // To
        ...input.participants.to.map((p) => ({
          messageId: message.id,
          participantId: p.id,
          role: ParticipantRole.TO,
        })),
        // CC
        ...(input.participants.cc || []).map((p) => ({
          messageId: message.id,
          participantId: p.id,
          role: ParticipantRole.CC,
        })),
        // BCC
        ...(input.participants.bcc || []).map((p) => ({
          messageId: message.id,
          participantId: p.id,
          role: ParticipantRole.BCC,
        })),
      ]

      await tx.insert(schema.MessageParticipant).values(participantLinks).onConflictDoNothing()

      // Update thread latestMessageId
      // All messages are now "real" messages - drafts are in separate Draft table
      await tx
        .update(schema.Thread)
        .set({ latestMessageId: message.id })
        .where(eq(schema.Thread.id, input.threadId))

      return message
    })

    return {
      id: result.id,
      messageId: input.messageId,
      sendToken: input.sendToken,
      threadId: input.threadId,
      subject: input.subject,
      textHtml: input.textHtml,
      textPlain: textPlain,
      references: input.references,
      inReplyTo: input.inReplyTo,
      participantIds: input.participants.all.map((p) => p.id),
    }
  }

  /**
   * Generates an RFC-compliant Message-ID
   * Format: <auxx.timestamp.uuid@auxx.ai>
   */
  private generateMessageId(): string {
    const timestamp = Date.now()
    const uuid = crypto.randomUUID()
    return `<auxx.${timestamp}.${uuid}@${getAppHostname()}>`
  }

  /**
   * Generates a unique send token for idempotency
   */
  private generateSendToken(): string {
    return crypto.randomUUID()
  }

  /**
   * Appends signature to message body
   */
  async appendSignature(
    content: { html?: string | null; plain?: string | null },
    signatureId: string,
    userId: string
  ): Promise<{ html?: string | null; plain?: string | null }> {
    if (!signatureId) return content

    const signature = await this.db.query.Signature.findFirst({
      where: (signatures, { eq, and, or }) =>
        and(
          eq(signatures.id, signatureId),
          or(eq(signatures.createdById, userId), eq(signatures.organizationId, this.organizationId))
        ),
    })

    if (!signature) return content

    return {
      html: content.html ? `${content.html}${signature.body}` : signature.body,
      plain: content.plain
        ? `${content.plain}\n${this.stripHtml(signature.body)}`
        : this.stripHtml(signature.body),
    }
  }

  /**
   * Helper to strip HTML tags for plain text
   */
  private stripHtml(html: string): string {
    return html
      .replace(/<[^>]+>/g, '')
      .replace(/\s+/g, ' ')
      .trim()
  }
}
