// packages/lib/src/messages/message-attachment.service.ts

import { type Database, database as db, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { and, count, eq } from 'drizzle-orm'
import { AttachmentService } from '../files/core/attachment-service'
import { MediaAssetService } from '../files/core/media-asset-service'
import {
  type MessageAttachmentInfo,
  transformAttachmentsForMessages,
} from './attachment-transformers'

const logger = createScopedLogger('message-attachment-service')

/**
 * File attachment information for message operations
 */
export interface FileAttachment {
  id: string
  name: string
  type: 'asset' | 'file' // 'asset' = MediaAsset, 'file' = FolderFile
}

/**
 * Service for handling message attachments using the unified Attachment system
 * Replaces direct EmailAttachment usage with polymorphic Attachment model
 */
export class MessageAttachmentService {
  private attachmentService: AttachmentService
  private mediaAssetService: MediaAssetService
  private db: Database

  constructor(
    private organizationId: string,
    private userId: string,
    dbInstance: Database = db
  ) {
    // Prefer provided Drizzle instance; fall back to shared singleton if a non-Drizzle client was passed
    const resolvedDb = (dbInstance as any)?.select ? dbInstance : db
    this.db = resolvedDb
    this.attachmentService = new AttachmentService(organizationId, userId, resolvedDb)
    this.mediaAssetService = new MediaAssetService(organizationId, userId, resolvedDb)
  }

  /**
   * Link file attachments to a message using the unified Attachment system
   * @param messageId - ID of the message to attach files to
   * @param fileAttachments - Array of file attachments to link
   */
  async linkFilesToMessage(messageId: string, fileAttachments: FileAttachment[]): Promise<void> {
    logger.info('Linking files to message via Attachment system', {
      messageId,
      attachmentCount: fileAttachments.length,
    })

    for (let i = 0; i < fileAttachments.length; i++) {
      const attachment = fileAttachments[i]

      if (attachment!.type === 'asset') {
        // Convert temp MediaAsset to permanent if needed
        await this.mediaAssetService.convertTempToPermanent(
          attachment!.id,
          'EMAIL_ATTACHMENT',
          this.organizationId
        )

        // Create attachment via AttachmentService
        await this.attachmentService.create({
          entityType: 'MESSAGE',
          entityId: messageId,
          role: 'ATTACHMENT',
          assetId: attachment!.id,
          createdById: this.userId,
          title: attachment!.name,
          sort: i + 1,
          organizationId: this.organizationId,
        })
      } else if (attachment!.type === 'file') {
        // Handle FolderFile attachments
        await this.attachmentService.attachFileToEntity(
          attachment!.id,
          'MESSAGE',
          messageId,
          this.userId,
          'ATTACHMENT',
          { title: attachment!.name, sort: i + 1 }
        )
      }
    }

    // Update message hasAttachments flag using Drizzle
    const [{ cnt }] = await this.db
      .select({ cnt: count() })
      .from(schema.Attachment)
      .where(
        and(
          eq(schema.Attachment.entityType, 'MESSAGE'),
          eq(schema.Attachment.entityId, messageId),
          eq(schema.Attachment.organizationId, this.organizationId)
        )
      )

    const hasAny = Number((cnt as any) ?? 0) > 0

    await this.db
      .update(schema.Message)
      .set({ hasAttachments: hasAny })
      .where(eq(schema.Message.id, messageId))

    logger.info('Successfully linked files to message', {
      messageId,
      attachmentCount: fileAttachments.length,
    })
  }

  /**
   * Remove all attachments from a message
   * @param messageId - ID of the message to clear attachments from
   */
  async removeAllAttachmentsFromMessage(messageId: string): Promise<void> {
    logger.info('Removing all attachments from message', { messageId })

    await this.db
      .delete(schema.Attachment)
      .where(
        and(
          eq(schema.Attachment.entityType, 'MESSAGE'),
          eq(schema.Attachment.entityId, messageId),
          eq(schema.Attachment.organizationId, this.organizationId)
        )
      )

    // Update message hasAttachments flag
    await this.db
      .update(schema.Message)
      .set({ hasAttachments: false })
      .where(eq(schema.Message.id, messageId))

    logger.info('Successfully removed all attachments from message', { messageId })
  }

  /**
   * Get attachment count for a message
   * @param messageId - ID of the message
   * @returns Number of attachments
   */
  async getAttachmentCount(messageId: string): Promise<number> {
    const [{ cnt }] = await this.db
      .select({ cnt: count() })
      .from(schema.Attachment)
      .where(
        and(
          eq(schema.Attachment.entityType, 'MESSAGE'),
          eq(schema.Attachment.entityId, messageId),
          eq(schema.Attachment.organizationId, this.organizationId)
        )
      )
    return Number((cnt as any) ?? 0)
  }

  /**
   * Fetch attachments for multiple messages and transform them for backward compatibility
   * @param messageIds - Array of message IDs
   * @returns Map from message ID to transformed attachment info
   */
  async fetchAttachmentsForMessages(
    messageIds: string[]
  ): Promise<Map<string, MessageAttachmentInfo[]>> {
    logger.info('Fetching attachments for messages', {
      messageCount: messageIds.length,
    })

    // Use AttachmentService to fetch grouped attachments
    const attachmentMap = await this.attachmentService.fetchAttachmentsForEntities(
      'MESSAGE',
      messageIds
    )

    // Transform to backward-compatible format
    const transformedMap = transformAttachmentsForMessages(attachmentMap)

    logger.info('Successfully fetched and transformed attachments', {
      messageCount: messageIds.length,
      totalAttachments: Array.from(transformedMap.values()).reduce(
        (sum, attachments) => sum + attachments.length,
        0
      ),
    })

    return transformedMap
  }
}
