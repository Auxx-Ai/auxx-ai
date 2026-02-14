// packages/lib/src/messages/message-reconciler.service.ts

import { type Database, schema } from '@auxx/database'
import { SendStatus } from '@auxx/database/enums'
import { createScopedLogger } from '@auxx/logger'
import { eq, inArray } from 'drizzle-orm'
import type { MessageData } from '../email/email-storage'
import type { ThreadManagerService } from './thread-manager.service'
import type { ReconciliationInput } from './types/message-sending.types'

const logger = createScopedLogger('message-reconciler')

/**
 * Handles reconciliation of sent messages with provider responses
 * and prevents duplicate creation during sync
 */
export class MessageReconcilerService {
  constructor(
    private organizationId: string,
    private threadManager: ThreadManagerService,
    private db: Database
  ) {}

  /**
   * Reconciles a sent message with provider response
   */
  async reconcileSentMessage(input: ReconciliationInput): Promise<void> {
    const { messageId, sendToken, providerResponse, threadContext } = input

    logger.info('Reconciling sent message', {
      messageId,
      sendToken,
      success: providerResponse.success,
      providerMessageId: providerResponse.messageId,
      providerThreadId: providerResponse.threadId,
    })

    // Step 1: Update message with provider data
    const updateData: Record<string, any> = {
      sendStatus: providerResponse.success ? SendStatus.SENT : SendStatus.FAILED,
      sentAt: providerResponse.success ? providerResponse.timestamp || new Date() : null,
      // Don't set receivedAt for sent messages - this is only for incoming messages
      lastAttemptAt: new Date(),
    }

    if (providerResponse.success && providerResponse.messageId) {
      updateData.externalId = providerResponse.messageId
    }

    if (providerResponse.success && providerResponse.threadId) {
      updateData.externalThreadId = providerResponse.threadId
    }

    if (providerResponse.success && providerResponse.historyId) {
      updateData.historyId = BigInt(providerResponse.historyId)
    }

    if (!providerResponse.success && providerResponse.error) {
      updateData.providerError = providerResponse.error
    }

    // Add reconciliation metadata
    updateData.metadata = {
      reconciled: true,
      reconciledAt: new Date().toISOString(),
      providerResponse: {
        messageId: providerResponse.messageId,
        threadId: providerResponse.threadId,
        historyId: providerResponse.historyId,
        labelIds: providerResponse.labelIds,
        success: providerResponse.success,
        timestamp: providerResponse.timestamp?.toISOString(),
      },
    }

    // First get current attempts count
    const currentMessage = await this.db.query.Message.findFirst({
      where: (messages, { eq }) => eq(messages.id, messageId),
      columns: { attempts: true },
    })

    if (currentMessage) {
      updateData.attempts = (currentMessage.attempts || 0) + 1
    }

    await this.db.update(schema.Message).set(updateData).where(eq(schema.Message.id, messageId))

    // Step 2: Reconcile thread if needed (not just pending)
    if (providerResponse.threadId) {
      await this.threadManager.reconcileThread(threadContext.id, {
        externalThreadId: providerResponse.threadId,
        actualMessageId: providerResponse.messageId || messageId,
        sentAt: providerResponse.timestamp || new Date(),
      })
    }

    // Step 3: Mark duplicates for cleanup if we detect any
    if (providerResponse.success && providerResponse.threadId && providerResponse.messageId) {
      await this.markDuplicatesForCleanup({
        realThreadId: threadContext.id,
        realMessageId: messageId,
        externalThreadId: providerResponse.threadId,
        externalMessageId: providerResponse.messageId,
      })
    }

    logger.info('Message reconciliation complete', {
      messageId,
      success: providerResponse.success,
    })
  }

  /**
   * Handles incoming sync that might duplicate sent messages
   * Called during message storage to prevent duplicates
   */
  async reconcileIncomingSync(messageData: MessageData): Promise<{
    isReconciled: boolean
    existingMessageId?: string
  }> {
    // Check multiple strategies to find recently sent messages

    // Strategy 1: Check by internetMessageId (most reliable)
    const byMessageId = messageData.internetMessageId
      ? await this.db.query.Message.findFirst({
          where: (messages, { eq, and, inArray }) =>
            and(
              eq(messages.organizationId, messageData.organizationId),
              eq(messages.internetMessageId, messageData.internetMessageId!),
              inArray(messages.sendStatus, [SendStatus.PENDING, SendStatus.SENT])
            ),
          columns: {
            id: true,
            sendToken: true,
            threadId: true,
          },
        })
      : null

    if (byMessageId) {
      logger.info('Found pending message by internetMessageId, reconciling', {
        messageId: byMessageId.id,
        internetMessageId: messageData.internetMessageId,
      })

      await this.mergeIncomingProviderData(byMessageId.id, messageData)
      return {
        isReconciled: true,
        existingMessageId: byMessageId.id,
      }
    }

    // Strategy 2: Check by subject and time window
    const recentlySent = await this.db.query.Message.findFirst({
      where: (messages, { eq, and, inArray, gte }) =>
        and(
          eq(messages.organizationId, messageData.organizationId),
          eq(messages.subject, messageData.subject || ''),
          inArray(messages.sendStatus, [SendStatus.PENDING, SendStatus.SENT]),
          gte(messages.createdAt, new Date(Date.now() - 300000)) // Within last 5 minutes
        ),
      columns: {
        id: true,
        sendToken: true,
        internetMessageId: true,
        threadId: true,
      },
    })

    if (recentlySent) {
      // Verify it's likely the same message
      const timeDiff = Math.abs((messageData.sentAt?.getTime() || 0) - new Date().getTime())

      if (timeDiff < 60000) {
        // Within 1 minute
        logger.info('Found likely matching message by subject/sender, reconciling', {
          messageId: recentlySent.id,
          subject: messageData.subject,
        })

        await this.mergeIncomingProviderData(recentlySent.id, messageData)
        return {
          isReconciled: true,
          existingMessageId: recentlySent.id,
        }
      }
    }

    // No match found - this is a genuinely new message
    return {
      isReconciled: false,
    }
  }

  /**
   * Merges provider data into an existing sent message
   */
  private async mergeIncomingProviderData(
    existingMessageId: string,
    providerData: MessageData
  ): Promise<void> {
    logger.info('Merging provider data into existing message', {
      messageId: existingMessageId,
      externalId: providerData.externalId,
    })

    // Update the message with provider data
    await this.db
      .update(schema.Message)
      .set({
        // Update with real provider IDs
        externalId: providerData.externalId,
        externalThreadId: providerData.externalThreadId,

        // Update status
        sendStatus: SendStatus.SENT,

        // Fill in any missing content
        textPlain: providerData.textPlain || undefined,
        textHtml: providerData.textHtml || undefined,
        snippet: providerData.snippet || undefined,

        // Update timestamps
        sentAt: providerData.sentAt,
        receivedAt: providerData.receivedAt,

        // Provider-specific data
        historyId: providerData.historyId ? Number(providerData.historyId) : undefined,
        hasAttachments: providerData.hasAttachments,

        // Threading
        inReplyTo: providerData.inReplyTo || undefined,
        references: providerData.references || undefined,

        // Merge metadata
        metadata: {
          ...((providerData.metadata as any) || {}),
          reconciled: true,
          reconciledAt: new Date().toISOString(),
          reconciledFrom: 'incoming_sync',
        },
      })
      .where(eq(schema.Message.id, existingMessageId))

    // Update thread if needed
    const message = await this.db.query.Message.findFirst({
      where: (messages, { eq }) => eq(messages.id, existingMessageId),
      columns: { threadId: true },
    })

    if (message?.threadId) {
      await this.threadManager.updateThreadMetadata(message.threadId)
    }

    // Promote thread externalId if it's a placeholder
    if (message?.threadId && providerData.externalThreadId) {
      const thread = await this.db.query.Thread.findFirst({
        where: (threads, { eq }) => eq(threads.id, message.threadId),
        columns: { externalId: true },
      })

      const ext = thread?.externalId
      if (
        !ext ||
        ext.startsWith('new_') ||
        ext.startsWith('pending_') ||
        ext.startsWith('draft_') ||
        (ext.includes('-') && ext.length === 36) // UUID
      ) {
        await this.db
          .update(schema.Thread)
          .set({
            externalId: providerData.externalThreadId,
          })
          .where(eq(schema.Thread.id, message.threadId))

        logger.info('Promoted thread externalId from placeholder', {
          threadId: message.threadId,
          oldExternalId: ext,
          newExternalId: providerData.externalThreadId,
        })
      }
    }
  }

  /**
   * Marks duplicate threads and messages for cleanup
   */
  private async markDuplicatesForCleanup(input: {
    realThreadId: string
    realMessageId: string
    externalThreadId: string
    externalMessageId: string
  }): Promise<void> {
    // Find any duplicate threads with same external ID
    const duplicateThreads = await this.db.query.Thread.findMany({
      where: (threads, { eq, and, not }) =>
        and(
          eq(threads.organizationId, this.organizationId),
          eq(threads.externalId, input.externalThreadId),
          not(eq(threads.id, input.realThreadId))
        ),
      columns: { id: true },
    })

    if (duplicateThreads.length > 0) {
      logger.warn('Found duplicate threads to clean up', {
        realThreadId: input.realThreadId,
        duplicates: duplicateThreads.map((t) => t.id),
      })

      // Mark threads for cleanup (add to metadata)
      for (const thread of duplicateThreads) {
        await this.db
          .update(schema.Thread)
          .set({
            metadata: {
              markedForCleanup: true,
              cleanupReason: 'duplicate_after_send',
              realThreadId: input.realThreadId,
              markedAt: new Date().toISOString(),
            },
          })
          .where(eq(schema.Thread.id, thread.id))
      }
    }

    // Find any duplicate messages
    const duplicateMessages = await this.db.query.Message.findMany({
      where: (messages, { eq, and, not }) =>
        and(
          eq(messages.organizationId, this.organizationId),
          eq(messages.externalId, input.externalMessageId),
          not(eq(messages.id, input.realMessageId))
        ),
      columns: { id: true },
    })

    if (duplicateMessages.length > 0) {
      logger.warn('Found duplicate messages to clean up', {
        realMessageId: input.realMessageId,
        duplicates: duplicateMessages.map((m) => m.id),
      })

      // Delete duplicate messages
      await this.db.delete(schema.Message).where(
        inArray(
          schema.Message.id,
          duplicateMessages.map((m) => m.id)
        )
      )

      // Recalculate thread metadata after deleting duplicates
      await this.threadManager.updateThreadMetadata(input.realThreadId)
    }
  }

  /**
   * Checks if a message is pending send (for idempotency)
   */
  async isPendingSend(sendToken: string): Promise<boolean> {
    const existing = await this.db.query.Message.findFirst({
      where: (messages, { eq }) => eq(messages.sendToken, sendToken),
      columns: {
        id: true,
        sendStatus: true,
      },
    })

    return existing?.sendStatus === SendStatus.PENDING
  }

  /**
   * Gets the status of a sent message
   */
  async getSendStatus(messageId: string): Promise<{
    status: string
    error?: string | null
    sentAt?: Date | null
  }> {
    const message = await this.db.query.Message.findFirst({
      where: (messages, { eq }) => eq(messages.id, messageId),
      columns: {
        sendStatus: true,
        providerError: true,
        sentAt: true,
      },
    })

    if (!message) {
      throw new Error(`Message ${messageId} not found`)
    }

    return {
      status: message.sendStatus || SendStatus.PENDING,
      error: message.providerError,
      sentAt: message.sentAt,
    }
  }
}
