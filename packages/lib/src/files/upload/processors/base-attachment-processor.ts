// packages/lib/src/files/upload/processors/base-attachment-processor.ts

import type { CreateAttachmentRequest } from '../../core/types'
import type { ProcessorConfigResult, UploadInitConfig } from '../init-types'
import type { PresignedUploadSession } from '../session-types'
import { BaseAssetProcessor } from './base-asset-processor'
import type { ProcessorMetadata, ProcessorResult } from './types'

/**
 * Base attachment processor that creates both assets and attachments
 * Extends BaseAssetProcessor and adds attachment creation logic
 * Use this for entities that need attachments linking assets to entities
 */
export abstract class BaseAttachmentProcessor extends BaseAssetProcessor {
  getMetadata(): ProcessorMetadata {
    return {
      name: `${this.entityType.toLowerCase()}-attachment`,
      entityTypes: [this.entityType],
      supportsAssets: true,
      supportsFiles: true,
      supportsAttachments: true,
    }
  }

  /**
   * Process upload configuration for attachment processors
   */
  async processConfig(init: UploadInitConfig): Promise<ProcessorConfigResult> {
    // Call super first
    const baseResult = await super.processConfig(init)

    // Validate entity access - required for attachments
    if (!init.entityId) {
      throw new Error(`Entity ID is required for ${this.entityType} attachments`)
    }

    try {
      await this.validateEntityAccess(init.entityId, init.organizationId, init.userId)
    } catch (error) {
      throw new Error(
        `Entity validation failed: ${error instanceof Error ? error.message : 'Unknown error'}`
      )
    }

    return baseResult
  }

  protected async executeProcess(
    session: PresignedUploadSession,
    storageLocationId: string,
    tx?: any
  ): Promise<ProcessorResult> {
    // First create asset
    const assetId = await this.createAsset(session, storageLocationId, tx)
    await this.postCreateAsset(session, storageLocationId, assetId, tx)

    // Then create attachment linking asset to entity
    const attachmentId = await this.createAttachment(assetId, session, tx)

    return {
      assetId,
      attachmentId,
      storageLocationId,
    }
  }

  /**
   * Create an Attachment linking asset to entity
   */
  protected async createAttachment(
    assetId: string,
    session: PresignedUploadSession,
    tx?: any
  ): Promise<string> {
    if (!session.entityType || !session.entityId) {
      throw new Error('Entity information required for attachment')
    }

    try {
      const attachmentData: CreateAttachmentRequest = {
        entityType: session.entityType as any,
        entityId: session.entityId,
        role: (session.metadata?.role as any) || 'ATTACHMENT',
        title: session.metadata?.title || session.fileName,
        caption: session.metadata?.caption,
        organizationId: session.organizationId,
        createdById: session.userId,
        assetId,
      }

      const attachmentService = tx ? this.attachmentService.withTx(tx) : this.attachmentService
      const attachment = await attachmentService.create(attachmentData)

      this.logger.info('Created Attachment record', {
        attachmentId: attachment.id,
        entityType: attachmentData.entityType,
        entityId: attachmentData.entityId,
        assetId,
        sessionId: session.id,
      })

      return attachment.id
    } catch (error) {
      this.logger.error('Failed to create Attachment record', {
        error: error instanceof Error ? error.message : String(error),
        entityType: session.entityType,
        entityId: session.entityId,
        sessionId: session.id,
      })
      throw new Error(
        `Failed to create attachment record: ${error instanceof Error ? error.message : 'Unknown error'}`
      )
    }
  }

  /**
   * Validate that the entity exists and user has access
   * Must be implemented by subclasses for attachment processors
   */
  protected abstract validateEntityAccess(
    entityId: string,
    organizationId: string,
    userId: string
  ): Promise<void>
}
