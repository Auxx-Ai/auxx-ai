// filepath: /Users/mklooth/Sites/auxx-ai/packages/lib/src/threads/draft-service.ts
import { database as defaultDb, type Database, type Transaction, schema } from '@auxx/database'
import { DraftMode, ParticipantRole as ParticipantRoleEnum } from '@auxx/database/enums'

import type { IdentifierType, ParticipantRole } from '@auxx/database/types'
import {
  MessageEntity as Message,
  MessageParticipantEntity,
  ParticipantEntity,
  ContactEntity,
  SignatureEntity,
} from '@auxx/database/models'
import { TRPCError } from '@trpc/server'
import { v4 as uuidv4 } from 'uuid'
import { createScopedLogger } from '@auxx/logger'
import { and, asc, count, eq } from 'drizzle-orm'
import { ParticipantService } from '../participants/participant-service'
import { ThreadManagerService } from '../messages/thread-manager.service'
import { MessageComposerService } from '../messages/message-composer.service'
import { MessageAttachmentService, FileAttachment } from '../messages/message-attachment.service'
import { AttachmentService } from '../files/core/attachment-service'
import {
  transformAttachmentsForMessage,
  type MessageAttachmentInfo,
} from '../messages/attachment-transformers'

/** Logger scoped to the draft service. */
const logger = createScopedLogger('draft-service')

/** Relation config for loading draft messages with participant context. */
const draftMessageWith = {
  participants: {
    orderBy: [asc(schema.MessageParticipant.role)], // Consistent order (FROM, TO, CC, BCC...)
    with: {
      participant: {
        with: {
          contact: true,
        },
      },
    },
  },
  from: true,
  replyTo: true,
  signature: true,
} as const

/** Message participant relation shape used by draft queries. */
type DraftParticipant = MessageParticipantEntity & {
  participant: (ParticipantEntity & { contact: ContactEntity | null }) | null
}

/** Draft message payload including hydrated relations and attachments. */
type DraftMessageType = Message & {
  participants: DraftParticipant[]
  from: ParticipantEntity | null
  replyTo: ParticipantEntity | null
  signature: SignatureEntity | null
  attachments: MessageAttachmentInfo[]
}

/**
 * Input interface for creating or updating drafts
 */
export interface UpsertDraftInput {
  threadId?: string | null // Optional: will create thread if not provided
  integrationId: string // Integration to use for draft context
  draftId?: string | null // Optional: existing draft ID to update

  // Message content
  subject?: string | null
  textHtml?: string | null
  textPlain?: string | null
  signatureId?: string | null

  // Participants (provide identifiers)
  to?: { identifier: string; identifierType: IdentifierType; name?: string | null }[]
  cc?: { identifier: string; identifierType: IdentifierType; name?: string | null }[]
  bcc?: { identifier: string; identifierType: IdentifierType; name?: string | null }[]

  // File attachments
  attachments?: FileAttachment[] // File attachments to attach

  // Optional metadata
  metadata?: Record<string, unknown>
}

/**
 * Service class for handling draft-related operations
 * Updated to use new modular message services architecture
 */
export class DraftService {
  private db: Database
  private organizationId: string
  private userId: string
  private participantService: ParticipantService
  private threadManager: ThreadManagerService
  private composer: MessageComposerService
  private messageAttachmentService: MessageAttachmentService
  private attachmentService: AttachmentService

  /**
   * Constructor for DraftService
   * @param dbInstance - Drizzle database client
   * @param organizationId - Organization ID to scope operations
   * @param userId - User ID for draft ownership
   * @param threadManager - Optional ThreadManagerService instance
   * @param composer - Optional MessageComposerService instance
   */
  constructor(
    dbInstance: Database = defaultDb,
    organizationId: string,
    userId: string,
    threadManager?: ThreadManagerService,
    composer?: MessageComposerService
  ) {
    const resolvedDb = (dbInstance as any)?.select ? dbInstance : defaultDb
    this.db = resolvedDb
    this.organizationId = organizationId
    this.userId = userId
    this.participantService = new ParticipantService(organizationId, resolvedDb)
    this.threadManager = threadManager || new ThreadManagerService(organizationId, resolvedDb)
    this.composer = composer || new MessageComposerService(organizationId, resolvedDb)
    this.messageAttachmentService = new MessageAttachmentService(organizationId, userId, resolvedDb)
    this.attachmentService = new AttachmentService(organizationId, userId, resolvedDb)
  }

  /**
   * Generate RFC-compliant Message-ID
   * Format: <auxx.timestamp.uuid@auxx.ai>
   */
  private generateMessageId(): string {
    const timestamp = Date.now()
    const uuid = uuidv4()
    return `<auxx.${timestamp}.${uuid}@auxx.ai>`
  }

  /**
   * Creates or updates a private draft message for a user within a thread.
   * If no threadId is provided, creates a new thread for the draft.
   * Updated to use ThreadManagerService and MessageComposerService.
   * @param input - Draft input parameters
   * @returns Promise resolving to the draft message with detailed includes
   */
  async createOrUpdateDraft(input: UpsertDraftInput): Promise<DraftMessageType> {
    const {
      threadId,
      integrationId,
      subject,
      textHtml,
      textPlain,
      signatureId,
      to = [],
      cc = [],
      bcc = [],
      attachments = [],
      metadata,
    } = input

    logger.info('Upserting draft', {
      userId: this.userId,
      threadId,
      integrationId,
      organizationId: this.organizationId,
    })

    // Basic validation
    if (!this.userId || !integrationId) {
      throw new Error('Missing required fields for draft upsert')
    }

    // 1. Handle thread creation/retrieval using ThreadManagerService
    const threadContext = await this.threadManager.getOrCreateThreadForSending({
      threadId: threadId!,
      subject: subject || 'Draft',
      integrationId: integrationId,
      organizationId: this.organizationId,
    })

    const finalThreadId = threadContext.id
    logger.info('Thread context prepared for draft', {
      threadId: finalThreadId,
      isPending: threadContext.isPending,
    })

    // 2. Prepare participants for composition
    const fromParticipant = await this.participantService.findOrCreateParticipantForUser(
      this.userId
    )
    if (!fromParticipant) {
      throw new Error(`Could not find or create participant for user ${this.userId}`)
    }

    const participantPromises = [
      ...to.map(async (p) => ({
        participant: await this.participantService.findOrCreateParticipant(p),
        role: ParticipantRoleEnum.TO,
      })),
      ...cc.map(async (p) => ({
        participant: await this.participantService.findOrCreateParticipant(p),
        role: ParticipantRoleEnum.CC,
      })),
      ...bcc.map(async (p) => ({
        participant: await this.participantService.findOrCreateParticipant(p),
        role: ParticipantRoleEnum.BCC,
      })),
    ]
    const resolvedParticipants = await Promise.all(participantPromises)
    const validParticipants = resolvedParticipants.filter((p) => p.participant !== null) as {
      participant: { id: string }
      role: ParticipantRole
    }[]

    // Transform participants to expected format
    const processedParticipants = {
      from: { ...fromParticipant, role: ParticipantRoleEnum.FROM } as any,
      to: validParticipants
        .filter((p) => p.role === ParticipantRoleEnum.TO)
        .map((p) => ({ ...p.participant, role: p.role })),
      cc: validParticipants
        .filter((p) => p.role === ParticipantRoleEnum.CC)
        .map((p) => ({ ...p.participant, role: p.role })),
      bcc: validParticipants
        .filter((p) => p.role === ParticipantRoleEnum.BCC)
        .map((p) => ({ ...p.participant, role: p.role })),
      all: [
        { ...fromParticipant, role: ParticipantRoleEnum.FROM } as any,
        ...validParticipants.map((p) => ({ ...p.participant, role: p.role })),
      ],
    }

    // 3. Use MessageComposerService to create/update draft
    try {
      // Find existing draft to get its ID
      const existingDraft = await this.db.query.Message.findFirst({
        where: and(
          eq(schema.Message.threadId, finalThreadId),
          eq(schema.Message.createdById, this.userId),
          eq(schema.Message.draftMode, DraftMode.PRIVATE)
        ),
        columns: {
          id: true,
        },
      })

      // If trying to update a specific draft that doesn't exist
      if (input.draftId && !existingDraft) {
        // Don't throw error - draft was likely deleted
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Draft no longer exists',
        })
      }

      const composed = await this.composer.composeMessage({
        threadId: finalThreadId,
        userId: this.userId,
        organizationId: this.organizationId,
        integrationId: integrationId,
        subject: subject || 'Draft',
        textHtml: textHtml,
        textPlain: textPlain,
        participants: processedParticipants,
        signatureId: signatureId,
        draftMessageId: existingDraft?.id || undefined,
        draftMode: DraftMode.PRIVATE, // Force private draft mode
        keepAsDraft: true, // Keep as draft, don't promote to pending
        inReplyTo: null,
        references: null,
      })

      // Handle file attachments if provided
      if (attachments.length > 0) {
        try {
          await this.updateMessageAttachments(composed.id, attachments, existingDraft?.id)
        } catch (attachmentError) {
          logger.error('Failed to update message attachments, continuing without them', {
            messageId: composed.id,
            attachmentCount: attachments.length,
            error: attachmentError instanceof Error ? attachmentError.message : attachmentError,
          })
          // Don't fail the entire draft save if attachments fail
          // The draft content is more important than the attachments
        }
      }

      // Fetch the complete draft with includes
      const draftMessage = await this.db.query.Message.findFirst({
        where: eq(schema.Message.id, composed.id),
        with: draftMessageWith,
      })

      if (!draftMessage) {
        throw new Error('Draft message not found after composition')
      }

      // Fetch attachments from the unified Attachment system
      const attachmentMap = await this.attachmentService.fetchAttachmentsForEntities('MESSAGE', [
        composed.id,
      ])
      const messageAttachments = attachmentMap.get(composed.id) || []

      // Transform to the expected format for compatibility
      const transformedAttachments = transformAttachmentsForMessage(messageAttachments)

      // Add attachments to the draft message
      const draftWithAttachments = {
        ...draftMessage,
        attachments: transformedAttachments,
      } as DraftMessageType

      logger.info('Draft composed successfully', {
        messageId: draftMessage.id,
        attachmentCount: transformedAttachments.length,
      })
      return draftWithAttachments
    } catch (error: unknown) {
      logger.error('Failed to compose draft', {
        userId: this.userId,
        threadId: finalThreadId,
        error: error instanceof Error ? error.message : error,
        stack: error instanceof Error ? error.stack : undefined,
      })
      throw new Error(`Failed to save draft: ${error instanceof Error ? error.message : error}`)
    }
  }

  /**
   * Links file attachments to a message using MessageAttachmentService
   * @param messageId - ID of the message to attach files to
   * @param attachments - Array of FileAttachment objects to attach
   */
  private async linkFilesToMessage(
    messageId: string,
    attachments: FileAttachment[]
  ): Promise<void> {
    logger.info('Linking files to message via MessageAttachmentService', {
      messageId,
      attachmentCount: attachments.length,
    })

    await this.messageAttachmentService.linkFilesToMessage(messageId, attachments)
  }

  /**
   * Update message attachments, handling adds/removes properly for draft updates
   * @param messageId - ID of the message to update attachments for
   * @param newAttachments - Array of FileAttachment objects that should be attached
   * @param existingDraftId - ID of existing draft if this is an update (optional)
   */
  private async updateMessageAttachments(
    messageId: string,
    newAttachments: FileAttachment[],
    existingDraftId?: string
  ): Promise<void> {
    logger.info('Updating message attachments', {
      messageId,
      newAttachmentCount: newAttachments.length,
      isUpdate: !!existingDraftId,
    })

    // For existing drafts, we need to compare and only add new attachments
    if (existingDraftId) {
      // Get current attachments for this message
      const currentAttachmentMap = await this.attachmentService.fetchAttachmentsForEntities(
        'MESSAGE',
        [messageId]
      )
      const currentAttachments = currentAttachmentMap.get(messageId) || []

      // Extract IDs of currently attached files
      const currentFileIds = new Set(
        currentAttachments.map((att) => att.fileId || att.mediaAssetId).filter(Boolean)
      )

      // Filter new attachments to only include ones not already attached
      const attachmentsToAdd = newAttachments.filter((att) => !currentFileIds.has(att.id))

      if (attachmentsToAdd.length > 0) {
        logger.info('Adding new attachments to existing draft', {
          messageId,
          attachmentsToAdd: attachmentsToAdd.length,
          currentAttachments: currentAttachments.length,
        })
        await this.messageAttachmentService.linkFilesToMessage(messageId, attachmentsToAdd)
      } else {
        logger.info('No new attachments to add to existing draft', { messageId })
      }
    } else {
      // For new drafts, link all attachments
      await this.messageAttachmentService.linkFilesToMessage(messageId, newAttachments)
    }
  }

  /**
   * Deletes a specific private draft message owned by the user.
   * @param draftMessageId - ID of the draft message to delete
   * @returns Promise resolving to success status
   */
  async deleteDraft(draftMessageId: string): Promise<{ success: boolean }> {
    logger.info('Attempting to delete draft', { userId: this.userId, draftMessageId })

    try {
      // First, get the draft message with its thread info
      const draftMessage = await this.db.query.Message.findFirst({
        where: and(
          eq(schema.Message.id, draftMessageId),
          eq(schema.Message.createdById, this.userId),
          eq(schema.Message.draftMode, DraftMode.PRIVATE),
          eq(schema.Message.organizationId, this.organizationId)
        ),
        columns: {
          id: true,
          threadId: true,
        },
      })

      if (!draftMessage) {
        // Check if it exists but belongs to someone else
        const exists = await this.db.query.Message.findFirst({
          where: eq(schema.Message.id, draftMessageId),
          columns: {
            id: true,
            createdById: true,
          },
        })

        if (!exists) {
          // Draft doesn't exist - likely already deleted
          logger.info('Draft already deleted', { draftMessageId })
          return { success: true } // Return success to avoid UI errors
        }

        if (exists.createdById !== this.userId) {
          logger.warn('User does not have permission to delete this draft', {
            userId: this.userId,
            draftMessageId,
            ownerId: exists.createdById,
          })
          throw new Error('You do not have permission to delete this draft')
        }

        throw new Error('Draft not found')
      }

      // Use a transaction to ensure atomicity
      const result = await this.db.transaction(async (tx: Transaction) => {
        await tx
          .delete(schema.Message)
          .where(
            and(
              eq(schema.Message.id, draftMessageId),
              eq(schema.Message.createdById, this.userId),
              eq(schema.Message.draftMode, DraftMode.PRIVATE),
              eq(schema.Message.organizationId, this.organizationId)
            )
          )

        const [{ total }] = await tx
          .select({ total: count(schema.Message.id) })
          .from(schema.Message)
          .where(
            and(
              eq(schema.Message.threadId, draftMessage.threadId),
              eq(schema.Message.organizationId, this.organizationId)
            )
          )

        const remainingMessages = Number(total ?? 0)

        if (remainingMessages === 0) {
          await tx
            .delete(schema.Thread)
            .where(
              and(
                eq(schema.Thread.id, draftMessage.threadId),
                eq(schema.Thread.organizationId, this.organizationId)
              )
            )

          logger.info('Deleted orphaned thread after draft deletion', {
            threadId: draftMessage.threadId,
            userId: this.userId,
          })
        }

        return { success: true }
      })

      logger.info('Draft deleted successfully', {
        userId: this.userId,
        draftMessageId,
      })

      return { success: true }
    } catch (error: unknown) {
      logger.error('Failed to delete draft', {
        userId: this.userId,
        draftMessageId,
        error: error instanceof Error ? error.message : error,
        stack: error instanceof Error ? error.stack : undefined,
      })
      if (error instanceof Error && error.message.includes('forbidden')) throw error // Rethrow specific errors
      throw new Error(`Failed to delete draft: ${error instanceof Error ? error.message : error}`)
    }
  }
}
