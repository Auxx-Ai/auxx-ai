// packages/lib/src/messages/message-sender.service.ts
import { type Database, database as db, schema } from '@auxx/database'
import { ParticipantRole } from '@auxx/database/enums'
import type { ParticipantRole as ParticipantRoleType } from '@auxx/database/types'
import { createScopedLogger } from '@auxx/logger'
import { getRedisClient } from '@auxx/redis'
import { and, asc, desc, eq, sql } from 'drizzle-orm'
import { UsageLimitError } from '../errors'
import { FileService } from '../files/core/file-service'
import { MediaAssetService } from '../files/core/media-asset-service'
import { ParticipantService } from '../participants/participant-service'
import type { AttachmentFile } from '../providers/message-provider-interface'
import type { ProviderRegistryService } from '../providers/provider-registry-service'
import { createUsageGuard } from '../usage/create-usage-guard'
import { MessageComposerService } from './message-composer.service'
import { MessageReconcilerService } from './message-reconciler.service'
import { ThreadManagerService } from './thread-manager.service'
import type {
  ComposedMessage,
  PostSendSyncJob,
  ProcessedParticipant,
  ProcessedParticipants,
  ProviderSendResponse,
  RetryMessageInput,
  RetryMessageResult,
  SendMessageInput,
  SentMessage,
  ThreadContext,
} from './types/message-sending.types'

const logger = createScopedLogger('message-sender')
/**
 * Main orchestrator for sending messages
 * Coordinates thread management, composition, sending, and reconciliation
 */
export class MessageSenderService {
  private threadManager: ThreadManagerService
  private composer: MessageComposerService
  private reconciler: MessageReconcilerService
  private participantService: ParticipantService
  private mediaAssetService: MediaAssetService
  private fileService: FileService
  constructor(
    private organizationId: string,
    private providerRegistry?: ProviderRegistryService,
    private db?: Database
  ) {
    this.threadManager = new ThreadManagerService(organizationId, db)
    this.composer = new MessageComposerService(organizationId, db)
    this.reconciler = new MessageReconcilerService(organizationId, this.threadManager, db)
    this.participantService = new ParticipantService(organizationId, db)
    this.mediaAssetService = new MediaAssetService(organizationId, undefined, db)
    this.fileService = new FileService(organizationId, undefined, db)
  }
  /**
   * Check if a thread ID is a placeholder
   */
  private isPlaceholderThreadId(id?: string | null): boolean {
    if (!id) return true
    if (id.startsWith('new_') || id.startsWith('pending_') || id.startsWith('draft_')) return true
    if (id.includes('-') && id.length === 36) return true // UUID
    return false
  }
  /**
   * Main entry point for sending messages
   */
  async sendMessage(input: SendMessageInput): Promise<SentMessage> {
    logger.info('Starting message send', {
      userId: input.userId,
      organizationId: input.organizationId,
      threadId: input.threadId,
      subject: input.subject,
      recipientCount: input.to.length + (input.cc?.length || 0) + (input.bcc?.length || 0),
    })
    // Validate input
    this.validateInput(input)
    // Usage guard: count outbound email before sending
    const guard = await createUsageGuard(this.db ?? db)
    if (guard) {
      const usageResult = await guard.consume(input.organizationId, 'outboundEmails', {
        userId: input.userId,
      })
      if (!usageResult.allowed) {
        throw new UsageLimitError({
          metric: 'outboundEmails',
          current: usageResult.current ?? 0,
          limit: usageResult.limit ?? 0,
          message:
            'You have reached your monthly email sending limit. Upgrade your plan to send more emails.',
        })
      }
    }
    let threadContext: ThreadContext | undefined
    try {
      // Step 1: Prepare thread
      threadContext = await this.threadManager.getOrCreateThreadForSending({
        threadId: input.threadId,
        subject: input.subject,
        integrationId: input.integrationId,
        organizationId: input.organizationId,
      })
      logger.info('Thread context prepared', {
        threadId: threadContext.id,
        isPending: threadContext.isPending,
        externalId: threadContext.externalId,
      })
      // Step 2: Process participants
      const participants = await this.processParticipants(input)
      // Step 3: Compose message
      const composed = await this.composer.composeMessage({
        threadId: threadContext.id,
        userId: input.userId,
        organizationId: input.organizationId,
        integrationId: input.integrationId,
        messageId: input.messageId, // Pass through provided Message-ID
        subject: input.subject,
        textHtml: input.textHtml,
        textPlain: input.textPlain,
        participants: participants,
        signatureId: input.signatureId,
        draftMessageId: input.draftMessageId,
        inReplyTo: await this.getInReplyTo(threadContext.id),
        references: await this.getReferences(threadContext.id),
        attachmentIds: input.attachmentIds, // Pass attachment IDs to composer
      })
      logger.info('Message composed', {
        messageId: composed.id,
        sendToken: composed.sendToken,
        internetMessageId: composed.messageId,
      })
      // Step 4: Apply signature if needed
      let finalContent = {
        html: composed.textHtml,
        plain: composed.textPlain,
      }
      if (input.signatureId) {
        finalContent = await this.composer.appendSignature(
          finalContent,
          input.signatureId,
          input.userId
        )
      }
      // Step 5: Prepare attachments for provider
      let attachmentFiles: AttachmentFile[] = []
      if (input.attachmentIds && input.attachmentIds.length > 0) {
        attachmentFiles = await this.prepareAttachments(input.attachmentIds)
      }
      // Step 6: Send via provider
      const sendResult = await this.sendViaProvider({
        integrationId: input.integrationId,
        composed: composed,
        participants: participants,
        finalContent: finalContent,
        threadContext: threadContext,
        attachments: attachmentFiles,
      })
      // Step 7: Reconcile with provider response
      await this.reconciler.reconcileSentMessage({
        messageId: composed.id,
        sendToken: composed.sendToken,
        providerResponse: sendResult,
        threadContext: threadContext,
      })
      // Step 8: Update thread metadata
      await this.threadManager.updateThreadMetadata(threadContext.id)
      await this.threadManager.updateThreadParticipants(threadContext.id)
      // Step 9: Trigger post-send sync
      await this.triggerPostSendSync(input.integrationId, {
        messageId: composed.id,
        threadId: threadContext.id,
        sendToken: composed.sendToken,
      })
      // Step 10: Convert temp attachments to permanent after successful send
      if (input.attachmentIds && input.attachmentIds.length > 0 && sendResult.success) {
        await this.convertAttachmentsToPermanent(input.attachmentIds)
      }
      // Step 11: Return result
      return this.getUpdatedMessage(composed.id)
    } catch (error) {
      logger.error('Failed to send message', {
        error,
        input: {
          userId: input.userId,
          subject: input.subject,
          threadId: input.threadId,
        },
      })

      // Clean up orphaned thread if we created a new one during this send attempt
      if (threadContext?.isPending) {
        try {
          await this.threadManager.deletePendingThread(threadContext.id)
          logger.info('Cleaned up orphaned pending thread after send failure', {
            threadId: threadContext.id,
          })
        } catch (cleanupError) {
          logger.warn('Failed to clean up orphaned pending thread', {
            threadId: threadContext.id,
            error: cleanupError instanceof Error ? cleanupError.message : String(cleanupError),
          })
        }
      }

      throw error
    }
  }
  /**
   * Validates send message input
   */
  private validateInput(input: SendMessageInput): void {
    if (!input.userId) {
      throw new Error('User ID is required')
    }
    if (!input.organizationId) {
      throw new Error('Organization ID is required')
    }
    if (input.organizationId !== this.organizationId) {
      throw new Error('Organization mismatch')
    }
    if (!input.integrationId) {
      throw new Error('Integration ID is required')
    }
    if (!input.subject) {
      throw new Error('Subject is required')
    }
    if (!input.to || input.to.length === 0) {
      throw new Error('At least one recipient is required')
    }
    if (!input.textHtml && !input.textPlain) {
      throw new Error('Message content is required')
    }
  }
  /**
   * Processes participants and ensures they exist in the database
   */
  private async processParticipants(input: SendMessageInput): Promise<ProcessedParticipants> {
    // Get sender
    const fromParticipant = await this.participantService.findOrCreateParticipantForUser(
      input.userId
    )
    if (!fromParticipant) {
      throw new Error(`Could not find or create participant for user ${input.userId}`)
    }
    // Process recipients
    const processParticipant = async (p: (typeof input.to)[0], role: ParticipantRoleType) => {
      const participant = await this.participantService.findOrCreateParticipant(p)
      if (!participant) {
        throw new Error(`Could not create participant for ${p.identifier}`)
      }
      return {
        ...participant,
        role,
      } as ProcessedParticipant
    }
    // Process all recipients in parallel
    const [toParticipants, ccParticipants, bccParticipants] = await Promise.all([
      Promise.all(input.to.map((p) => processParticipant(p, ParticipantRole.TO))),
      Promise.all((input.cc || []).map((p) => processParticipant(p, ParticipantRole.CC))),
      Promise.all((input.bcc || []).map((p) => processParticipant(p, ParticipantRole.BCC))),
    ])
    // Combine all unique participants
    const allParticipants = [
      { ...fromParticipant, role: ParticipantRole.FROM } as ProcessedParticipant,
      ...toParticipants,
      ...ccParticipants,
      ...bccParticipants,
    ]
    return {
      from: { ...fromParticipant, role: ParticipantRole.FROM } as ProcessedParticipant,
      to: toParticipants,
      cc: ccParticipants.length > 0 ? ccParticipants : undefined,
      bcc: bccParticipants.length > 0 ? bccParticipants : undefined,
      all: allParticipants,
    }
  }
  /**
   * Gets the In-Reply-To header for threading
   */
  private async getInReplyTo(threadId: string): Promise<string | null> {
    const rows = await db
      .select({ internetMessageId: schema.Message.internetMessageId })
      .from(schema.Message)
      .where(and(eq(schema.Message.threadId, threadId), sql`("internetMessageId" IS NOT NULL)`))
      .orderBy(desc(schema.Message.sentAt))
      .limit(1)
    return rows?.[0]?.internetMessageId ?? null
  }
  /**
   * Gets the References header for threading
   */
  private async getReferences(threadId: string): Promise<string | null> {
    const rows = await db
      .select({ internetMessageId: schema.Message.internetMessageId })
      .from(schema.Message)
      .where(and(eq(schema.Message.threadId, threadId), sql`("internetMessageId" IS NOT NULL)`))
      .orderBy(asc(schema.Message.sentAt))
      .limit(10)
    if (!rows || rows.length === 0) return null
    return rows
      .map((m) => m.internetMessageId)
      .filter(Boolean)
      .join(' ')
  }
  /**
   * Sends message via the appropriate provider
   */
  private async sendViaProvider(input: {
    integrationId: string
    composed: ComposedMessage
    participants: ProcessedParticipants
    finalContent: {
      html?: string | null
      plain?: string | null
    }
    threadContext: ThreadContext
    attachments?: AttachmentFile[]
  }): Promise<ProviderSendResponse> {
    if (!this.providerRegistry) {
      throw new Error('Provider registry not initialized')
    }
    // Get the provider
    const provider = await this.providerRegistry.getProvider(input.integrationId)
    if (!provider) {
      throw new Error(`Provider not found for integration ${input.integrationId}`)
    }
    logger.info('Sending message via provider', {
      integrationId: input.integrationId,
      providerType: (provider as any).type || 'unknown',
    })
    try {
      // Sanitize external thread ID before sending
      const sanitizedExternalThreadId = this.isPlaceholderThreadId(input.threadContext.externalId)
        ? undefined
        : input.threadContext.externalId
      // Call provider's sendMessage method
      const result = await provider.sendMessage({
        messageId: input.composed.messageId,
        from: input.participants.from.identifier,
        to: input.participants.to.map((p) => p.identifier),
        cc: input.participants.cc?.map((p) => p.identifier),
        bcc: input.participants.bcc?.map((p) => p.identifier),
        subject: input.composed.subject,
        html: input.finalContent.html || undefined,
        text: input.finalContent.plain || undefined,
        references: input.composed.references || undefined,
        inReplyTo: input.composed.inReplyTo || undefined,
        externalThreadId: sanitizedExternalThreadId, // Use sanitized ID
        attachments: input.attachments, // Pass attachments to provider
      } as any)
      return {
        success: result.success,
        messageId: result.id,
        threadId: result.threadId,
        historyId: (result as any).historyId,
        labelIds: (result as any).labelIds,
        timestamp: new Date(),
        metadata: result,
      }
    } catch (error: any) {
      // Import error normalizer
      const { ErrorNormalizer, NormalizedEmailError } = await import(
        '../providers/error-normalization'
      )
      // Determine provider type for normalization
      const providerType = (provider as any).getProviderName?.() || 'unknown'
      let normalizedError: NormalizedEmailError
      // Check if already normalized
      if (error && typeof error === 'object' && error.name === 'NormalizedEmailError') {
        normalizedError = error
      } else if (providerType === 'google' || providerType === 'gmail') {
        normalizedError = ErrorNormalizer.normalizeGmailError(error)
      } else if (providerType === 'outlook' || providerType === 'microsoft') {
        normalizedError = ErrorNormalizer.normalizeOutlookError(error)
      } else {
        // Generic error
        normalizedError = new NormalizedEmailError(
          'UNKNOWN' as any,
          error.message || 'Unknown provider error',
          error,
          { provider: providerType }
        )
      }
      // Log structured error
      logger.error('Provider send failed', {
        code: normalizedError.code,
        message: normalizedError.message,
        provider: providerType,
        integrationId: input.integrationId,
        retryable: normalizedError.details?.retryable,
        hasAttachments: !!(input.attachments && input.attachments.length > 0),
        attachmentCount: input.attachments?.length || 0,
      })
      // Get user-friendly message
      const userMessage = ErrorNormalizer.getUserMessage(normalizedError)
      return {
        success: false,
        error: userMessage,
        errorCode: normalizedError.code,
        retryable: normalizedError.details?.retryable,
        timestamp: new Date(),
      }
    }
  }
  /**
   * Triggers immediate sync after sending
   * This ensures we get both SENT and INBOX copies for self-sent messages
   */
  private async triggerPostSendSync(
    integrationId: string,
    metadata: {
      messageId: string
      threadId: string
      sendToken: string
    }
  ): Promise<void> {
    const job: PostSendSyncJob = {
      integrationId,
      type: 'POST_SEND_SYNC',
      priority: 'HIGH',
      delay: 2000, // 2 second delay to ensure provider has processed
      metadata,
    }
    // Queue the sync job via Redis
    const redis = await getRedisClient(false)
    if (redis) {
      const jobData = JSON.stringify(job)
      await redis.lpush?.('sync:high-priority', jobData)
      await redis.expire?.('sync:high-priority', 3600) // 1 hour TTL
      logger.info('Queued post-send sync job', {
        integrationId,
        messageId: metadata.messageId,
      })
    } else {
      logger.warn('Redis not available for post-send sync', {
        integrationId,
      })
    }
  }
  /**
   * Gets the updated message after sending
   */
  private async getUpdatedMessage(messageId: string): Promise<SentMessage> {
    const [message] = await db
      .select({
        id: schema.Message.id,
        externalId: schema.Message.externalId,
        threadId: schema.Message.threadId,
        subject: schema.Message.subject,
        sendStatus: schema.Message.sendStatus,
        sentAt: schema.Message.sentAt,
        providerError: schema.Message.providerError,
      })
      .from(schema.Message)
      .where(eq(schema.Message.id, messageId))
      .limit(1)
    if (!message) {
      throw new Error(`Message ${messageId} not found`)
    }
    return {
      id: message.id,
      externalId: message.externalId,
      threadId: message.threadId,
      subject: message.subject,
      sendStatus: message.sendStatus || 'PENDING',
      sentAt: message.sentAt,
      error: message.providerError,
    }
  }
  /**
   * Checks if we can send messages for an integration
   */
  async canSendMessages(integrationId: string): Promise<boolean> {
    const [integration] = await db
      .select({
        id: schema.Integration.id,
        provider: schema.Integration.provider,
        settings: schema.Integration.settings,
      })
      .from(schema.Integration)
      .where(eq(schema.Integration.id, integrationId))
      .limit(1)
    if (!integration) return false
    // Check if integration is configured for sending
    const settings = integration.settings as any
    return settings?.canSend !== false
  }
  /**
   * Prepares attachments for sending by converting MediaAsset IDs to AttachmentFile format
   */
  private async prepareAttachments(ids: string[]): Promise<AttachmentFile[]> {
    const attachments: AttachmentFile[] = []
    for (const id of ids) {
      try {
        // Try as MediaAsset first
        const [asset] = await db
          .select({ id: schema.MediaAsset.id })
          .from(schema.MediaAsset)
          .where(
            and(
              eq(schema.MediaAsset.id, id),
              eq(schema.MediaAsset.organizationId, this.organizationId)
            )
          )
          .limit(1)
        if (asset) {
          const assetWith = await this.mediaAssetService.getWithRelations(id)
          if (!assetWith) {
            logger.warn(`MediaAsset ${id} not found (post-lookup), skipping`)
            continue
          }
          const content = await this.mediaAssetService.getContent(id)
          attachments.push({
            filename: assetWith.name || 'attachment',
            content,
            contentType: assetWith.mimeType || 'application/octet-stream',
            size: Number(assetWith.size || 0),
            id,
          })
          continue
        }
        // Try as FolderFile
        const [file] = await db
          .select({ id: schema.FolderFile.id })
          .from(schema.FolderFile)
          .where(
            and(
              eq(schema.FolderFile.id, id),
              eq(schema.FolderFile.organizationId, this.organizationId)
            )
          )
          .limit(1)
        if (file) {
          const fileWith = await this.fileService.getWithRelations(id)
          if (!fileWith) {
            logger.warn(`FolderFile ${id} not found (post-lookup), skipping`)
            continue
          }
          const content = await this.fileService.getContent(id)
          const mimeType =
            (fileWith.currentVersion as any)?.mimeType ||
            fileWith.mimeType ||
            'application/octet-stream'
          const size = Number((fileWith.currentVersion as any)?.size || fileWith.size || 0)
          attachments.push({
            filename: fileWith.name || 'attachment',
            content,
            contentType: mimeType,
            size,
            id,
          })
          continue
        }
        // Not found in either table
        logger.warn(`Attachment ID ${id} not found in asset or file tables; skipping`)
      } catch (error) {
        logger.error(`Failed to prepare attachment ${id}`, error)
        // Continue with other attachments
      }
    }
    // Enhanced size validation with detailed error messages
    const MAX_TOTAL_SIZE = 25 * 1024 * 1024 // 25MB
    const MAX_SINGLE_SIZE = 25 * 1024 * 1024 // 25MB per file
    const BASE64_OVERHEAD = 1.37 // 37% overhead for base64 encoding
    // Check individual file sizes
    for (const attachment of attachments) {
      const fileSize = attachment.size || 0
      const encodedSize = Math.ceil(fileSize * BASE64_OVERHEAD)
      if (encodedSize > MAX_SINGLE_SIZE) {
        const { NormalizedEmailError, EmailErrorCode } = await import(
          '../providers/error-normalization'
        )
        throw new NormalizedEmailError(
          EmailErrorCode.ATTACHMENT_TOO_LARGE,
          `Attachment "${attachment.filename}" is too large. ` +
            `Size: ${(fileSize / 1024 / 1024).toFixed(2)}MB, ` +
            `Encoded: ${(encodedSize / 1024 / 1024).toFixed(2)}MB, ` +
            `Max: ${(MAX_SINGLE_SIZE / 1024 / 1024).toFixed(0)}MB`,
          undefined,
          { filename: attachment.filename, size: fileSize, limit: MAX_SINGLE_SIZE }
        )
      }
    }
    // Check total size
    const totalSize = attachments.reduce((sum, att) => sum + (att.size || 0), 0)
    const totalEncodedSize = Math.ceil(totalSize * BASE64_OVERHEAD)
    if (totalEncodedSize > MAX_TOTAL_SIZE) {
      const { NormalizedEmailError, EmailErrorCode } = await import(
        '../providers/error-normalization'
      )
      throw new NormalizedEmailError(
        EmailErrorCode.SIZE_LIMIT_EXCEEDED,
        `Total attachment size exceeds limit. ` +
          `Total: ${(totalSize / 1024 / 1024).toFixed(2)}MB, ` +
          `Encoded: ${(totalEncodedSize / 1024 / 1024).toFixed(2)}MB, ` +
          `Max: ${(MAX_TOTAL_SIZE / 1024 / 1024).toFixed(0)}MB`,
        undefined,
        { size: totalSize, limit: MAX_TOTAL_SIZE }
      )
    }
    logger.info('Attachment size validation passed', {
      fileCount: attachments.length,
      totalSizeMB: (totalSize / 1024 / 1024).toFixed(2),
      encodedSizeMB: (totalEncodedSize / 1024 / 1024).toFixed(2),
    })
    return attachments
  }
  /**
   * Converts temporary attachments to permanent after successful send
   */
  private async convertAttachmentsToPermanent(ids: string[]): Promise<void> {
    // Idempotent, type-aware: convert MediaAssets if needed; ignore FolderFiles
    for (const id of ids) {
      try {
        const [asset] = await db
          .select({ id: schema.MediaAsset.id, kind: schema.MediaAsset.kind })
          .from(schema.MediaAsset)
          .where(
            and(
              eq(schema.MediaAsset.id, id),
              eq(schema.MediaAsset.organizationId, this.organizationId)
            )
          )
          .limit(1)
        if (asset) {
          // If already EMAIL_ATTACHMENT, this is a no-op; if temp, set to permanent
          await this.mediaAssetService.update(id, {
            kind: 'EMAIL_ATTACHMENT',
            expiresAt: null,
          } as any)
          logger.info(`Ensured MediaAsset ${id} is permanent EMAIL_ATTACHMENT`)
          continue
        }
        // If it's a FolderFile, nothing to do
        const [file] = await db
          .select({ id: schema.FolderFile.id })
          .from(schema.FolderFile)
          .where(
            and(
              eq(schema.FolderFile.id, id),
              eq(schema.FolderFile.organizationId, this.organizationId)
            )
          )
          .limit(1)
        if (file) {
          logger.info(`FolderFile ${id} needs no conversion; skipping`)
          continue
        }
        logger.warn(`Attachment ID ${id} not found during conversion`)
      } catch (error) {
        logger.error(`Failed to ensure attachment ${id} permanent state`, error)
        // Continue processing other IDs
      }
    }
  }
  /**
   * Retries sending a failed message
   * - Validates the message exists and is in failed state
   * - Resets status and increments attempt counter
   * - Reuses existing message composition
   * - Sends via provider with existing content
   */
  async retryFailedMessage(input: RetryMessageInput): Promise<RetryMessageResult> {
    logger.info('Starting message retry', {
      messageId: input.messageId,
      userId: input.userId,
      organizationId: input.organizationId,
    })
    try {
      // 1. Load the failed message with all relations
      const failedMessage = await this.loadFailedMessage(input.messageId)
      // 2. Validate retry eligibility
      this.validateRetryEligibility(failedMessage, input.organizationId)
      // 3. Reset message status and get attempt number
      const attemptNumber = await this.resetMessageForRetry(input.messageId)
      // 4. Extract send parameters from existing message
      const sendParams = await this.extractRetryParameters(failedMessage)
      // 5. Send directly via provider (skip composition)
      const result = await this.retrySendViaProvider(sendParams)
      // 6. Handle result and update message status
      return await this.processRetryResult(failedMessage.id, result, attemptNumber)
    } catch (error) {
      logger.error('Failed to retry message', {
        messageId: input.messageId,
        error: error instanceof Error ? error.message : error,
        stack: error instanceof Error ? error.stack : undefined,
      })
      throw error
    }
  }
  /**
   * Loads a message with all necessary relations for retry
   */
  private async loadFailedMessage(messageId: string) {
    const row = await db.query.Message.findFirst({
      where: (t, { eq }) => eq(t.id, messageId),
      with: {
        thread: true,
        participants: {
          with: { participant: true },
          orderBy: [asc(schema.MessageParticipant.role)],
        },
        from: true,
        signature: true,
      },
    })
    if (!row) {
      throw new Error(`Message ${messageId} not found`)
    }

    // Load canonical attachments separately
    const attachments = await db
      .select({
        id: schema.Attachment.id,
        assetId: schema.Attachment.assetId,
        assetVersionId: schema.Attachment.assetVersionId,
        title: schema.Attachment.title,
        role: schema.Attachment.role,
        sort: schema.Attachment.sort,
      })
      .from(schema.Attachment)
      .where(
        and(
          eq(schema.Attachment.entityType, 'MESSAGE'),
          eq(schema.Attachment.entityId, messageId),
          eq(schema.Attachment.organizationId, row.organizationId)
        )
      )
      .orderBy(asc(schema.Attachment.sort))

    // Load media assets for attachments that have assetIds
    const assetIds = attachments.map((a) => a.assetId).filter(Boolean) as string[]
    const assetMap = new Map<string, any>()
    if (assetIds.length > 0) {
      const assets = await db.query.MediaAsset.findMany({
        where: (t, { inArray }) => inArray(t.id, assetIds),
      })
      for (const asset of assets) {
        assetMap.set(asset.id, asset)
      }
    }

    const attachmentsWithAssets = attachments.map((a) => ({
      ...a,
      mediaAssetId: a.assetId,
      mediaAsset: a.assetId ? (assetMap.get(a.assetId) ?? null) : null,
    }))

    return { ...row, attachments: attachmentsWithAssets }
  }
  /**
   * Validates that a message is eligible for retry
   */
  private validateRetryEligibility(message: any, organizationId: string): void {
    // Check organization access
    if (message.thread.organizationId !== organizationId) {
      throw new Error('Unauthorized: Message belongs to different organization')
    }
    // Check status
    if (message.sendStatus !== ('FAILED' as any)) {
      throw new Error(
        `Cannot retry message in ${message.sendStatus} status. Only FAILED messages can be retried.`
      )
    }
    // Check retry limit
    const MAX_RETRY_ATTEMPTS = 5
    if (message.attempts >= MAX_RETRY_ATTEMPTS) {
      throw new Error(`Maximum retry attempts (${MAX_RETRY_ATTEMPTS}) exceeded`)
    }
  }
  /**
   * Resets message status for retry and returns the new attempt number
   */
  private async resetMessageForRetry(messageId: string): Promise<number> {
    const [updated] = await db
      .update(schema.Message)
      .set({
        sendStatus: 'PENDING' as any,
        attempts: sql`${schema.Message.attempts} + 1`,
        lastAttemptAt: new Date(),
        providerError: null,
      })
      .where(eq(schema.Message.id, messageId))
      .returning({ attempts: schema.Message.attempts })

    if (!updated) throw new Error('unable to update message')

    logger.info('Message reset for retry', {
      messageId,
      attemptNumber: updated.attempts,
    })
    return updated.attempts
  }
  /**
   * Extracts send parameters from an existing message for retry
   */
  private async extractRetryParameters(message: any) {
    // Extract participants grouped by role
    const participants = this.extractParticipantsFromMessage(message)
    // Extract attachments if any
    const attachments = await this.extractAttachmentsFromMessage(message)
    return {
      messageId: message.id,
      threadId: message.threadId,
      integrationId: message.thread.integrationId,
      internetMessageId: message.messageId, // Preserve original Message-ID
      subject: message.subject || '',
      textHtml: message.textHtml,
      textPlain: message.textPlain,
      participants,
      attachments,
      references: message.references,
      inReplyTo: message.inReplyTo,
      threadContext: {
        id: message.threadId,
        externalId: message.thread.externalId,
        isPending: false,
      },
    }
  }
  /**
   * Extracts participants from a message grouped by role
   */
  private extractParticipantsFromMessage(message: any): ProcessedParticipants {
    const from = message.from
    const to: ProcessedParticipant[] = []
    const cc: ProcessedParticipant[] = []
    const bcc: ProcessedParticipant[] = []
    for (const mp of message.participants) {
      const participant: ProcessedParticipant = {
        id: mp.participant.id,
        identifier: mp.participant.identifier,
        identifierType: mp.participant.identifierType,
        name: mp.participant.name,
        displayName: mp.participant.displayName,
        initials: mp.participant.initials,
        contactId: mp.participant.contactId,
        role: mp.role,
      }
      switch (mp.role) {
        case ParticipantRole.TO:
          to.push(participant)
          break
        case ParticipantRole.CC:
          cc.push(participant)
          break
        case ParticipantRole.BCC:
          bcc.push(participant)
          break
      }
    }
    return { from, to, cc, bcc }
  }
  /**
   * Extracts attachments from a message for retry
   */
  private async extractAttachmentsFromMessage(message: any): Promise<AttachmentFile[]> {
    const attachments: AttachmentFile[] = []
    for (const attachment of message.attachments) {
      if (!attachment.mediaAssetId || !attachment.mediaAsset) continue
      try {
        const asset = attachment.mediaAsset
        const content = await this.mediaAssetService.getContent(asset.id)
        if (!content) {
          logger.warn(`Attachment ${asset.id} has no content, skipping`)
          continue
        }
        attachments.push({
          filename: asset.fileName,
          content: content,
          contentType: asset.mimeType || 'application/octet-stream',
          size: Number(asset.size),
          id: asset.id,
        })
      } catch (error) {
        logger.error(`Failed to extract attachment ${attachment.mediaAssetId} for retry`, error)
        // Continue with other attachments
      }
    }
    return attachments
  }
  /**
   * Sends a retry message via provider with special handling
   */
  private async retrySendViaProvider(params: any): Promise<ProviderSendResponse> {
    if (!this.providerRegistry) {
      throw new Error('Provider registry not initialized')
    }
    const provider = await this.providerRegistry.getProvider(params.integrationId)
    if (!provider) {
      throw new Error(`Provider not found for integration ${params.integrationId}`)
    }
    logger.info('Retrying message send via provider', {
      messageId: params.messageId,
      integrationId: params.integrationId,
      attemptNumber: params.attemptNumber,
    })
    try {
      // Sanitize external thread ID
      const sanitizedExternalThreadId = this.isPlaceholderThreadId(params.threadContext.externalId)
        ? undefined
        : params.threadContext.externalId
      const result = await provider.sendMessage({
        messageId: params.internetMessageId, // Use original Message-ID
        from: params.participants.from.identifier,
        to: params.participants.to.map((p: any) => p.identifier),
        cc: params.participants.cc?.map((p: any) => p.identifier),
        bcc: params.participants.bcc?.map((p: any) => p.identifier),
        subject: params.subject,
        html: params.textHtml || undefined,
        text: params.textPlain || undefined,
        references: params.references || undefined,
        inReplyTo: params.inReplyTo || undefined,
        externalThreadId: sanitizedExternalThreadId,
        attachments: params.attachments,
      } as any)
      return {
        success: result.success,
        messageId: result.id,
        threadId: result.threadId,
        historyId: (result as any).historyId,
        labelIds: (result as any).labelIds,
        timestamp: new Date(),
        metadata: result,
      }
    } catch (error: any) {
      // Use existing error normalization
      const { ErrorNormalizer, NormalizedEmailError } = await import(
        '../providers/error-normalization'
      )
      const providerType = (provider as any).getProviderName?.() || 'unknown'
      let normalizedError: NormalizedEmailError
      if (error && typeof error === 'object' && error.name === 'NormalizedEmailError') {
        normalizedError = error
      } else if (providerType === 'google' || providerType === 'gmail') {
        normalizedError = ErrorNormalizer.normalizeGmailError(error)
      } else if (providerType === 'outlook' || providerType === 'microsoft') {
        normalizedError = ErrorNormalizer.normalizeOutlookError(error)
      } else {
        normalizedError = new NormalizedEmailError(
          'UNKNOWN' as any,
          error.message || 'Unknown provider error',
          error,
          { provider: providerType }
        )
      }
      logger.error('Provider retry failed', {
        code: normalizedError.code,
        message: normalizedError.message,
        provider: providerType,
        messageId: params.messageId,
      })
      // Update message with error - don't throw, let processRetryResult handle it
      await db
        .update(schema.Message)
        .set({
          sendStatus: 'FAILED' as any,
          providerError: normalizedError.message,
        })
        .where(eq(schema.Message.id, params.messageId))
      // Return failure response instead of throwing
      return {
        success: false,
        error: normalizedError.message,
        timestamp: new Date(),
        metadata: { error: normalizedError },
      }
    }
  }
  /**
   * Processes the result of a retry attempt
   */
  private async processRetryResult(
    messageId: string,
    result: ProviderSendResponse,
    attemptNumber: number
  ): Promise<RetryMessageResult> {
    if (result.success) {
      // Update message as sent
      await db
        .update(schema.Message)
        .set({
          sendStatus: 'SENT' as any,
          externalId: result.messageId ?? null,
          metadata: (result.metadata as any) ?? {},
          sentAt: result.timestamp ?? new Date(),
        })
        .where(eq(schema.Message.id, messageId))
      // Get updated message
      const message = await this.getUpdatedMessage(messageId)
      logger.info('Message retry successful', {
        messageId,
        attemptNumber,
        externalId: result.messageId,
      })
      return {
        success: true,
        message,
        attemptNumber,
      }
    } else {
      // Already updated as failed in retrySendViaProvider catch block
      const message = await this.getUpdatedMessage(messageId)
      return {
        success: false,
        message,
        attemptNumber,
        error: 'Failed to send message via provider',
      }
    }
  }
}
