// packages/lib/src/files/upload/processors/base-asset-processor.ts

import { BaseProcessor } from './base-processor'
import type {
  ProcessorMetadata,
  CreateSessionRequest,
  ProcessorResult,
  SessionMetadata,
} from './types'
import type { PresignedUploadSession } from '../session-types'
import type { UploadInitConfig, ProcessorConfigResult } from '../init-types'
import type {
  CreateFileRequest,
  CreateAssetRequest,
  AssetKind,
} from '../../core/types'

/**
 * Base asset processor with entity-specific configuration
 * Subclasses define entity-specific rules and behavior
 * Creates assets only - no attachments
 */
export abstract class BaseAssetProcessor extends BaseProcessor {
  // Entity-specific configuration (override in subclasses)
  protected abstract entityType: string
  protected abstract fileVisibility: string
  protected abstract preferredProvider: string
  protected abstract maxFileSize: number
  protected abstract allowedMimeTypes: string[]
  protected abstract assetKind: AssetKind

  getMetadata(): ProcessorMetadata {
    return {
      name: `${this.entityType.toLowerCase()}-asset`,
      entityTypes: [this.entityType],
      supportsAssets: true,
      supportsFiles: true,
      supportsAttachments: false,
    }
  }

  protected async executeProcess(session: PresignedUploadSession, storageLocationId: string, tx?: any): Promise<ProcessorResult> {
    // Only create asset - no attachments
    const assetId = await this.createAsset(session, storageLocationId, tx)

    // Post-asset creation hook (can be overridden by subclasses)
    await this.postCreateAsset(session, storageLocationId, assetId, tx)

    return {
      assetId,
      storageLocationId,
    }
  }

  // ============= Unified Processor API =============

  /**
   * Process upload configuration for asset processors
   */
  async processConfig(init: UploadInitConfig): Promise<ProcessorConfigResult> {
    // Import the utility function
    const { getBucketForVisibility } = await import('../util')

    // Call super first
    const baseResult = await super.processConfig(init)

    // Validate entity access if entityId is provided
    if (init.entityId) {
      try {
        await this.validateEntityAccess(init.entityId, init.organizationId, init.userId)
      } catch (error) {
        throw new Error(
          `Entity validation failed: ${error instanceof Error ? error.message : 'Unknown error'}`
        )
      }
    }

    // Clamp and specialize policy
    const policy = {
      ...baseResult.config.policy,
      allowedMimeTypes: this.allowedMimeTypes, // explicit list per entity
      contentLengthRange: [0, this.maxFileSize] as [number, number], // hard upper bound
      maxTtl: 10 * 60,
    }

    // Validate before returning
    if (init.expectedSize > this.maxFileSize) {
      throw new Error(
        `File exceeds allowed size of ${Math.round(this.maxFileSize / 1024 / 1024)}MB`
      )
    }

    if (!this.isAllowedMimeType(init.mimeType)) {
      throw new Error(`File type '${init.mimeType}' not allowed`)
    }

    // Determine visibility and bucket
    const visibility = this.fileVisibility as 'PUBLIC' | 'PRIVATE'
    const bucket = getBucketForVisibility(visibility)

    return {
      config: Object.freeze({
        ...baseResult.config,
        policy,
        visibility,
        bucket,
      }),
      warnings: baseResult.warnings,
    }
  }

  /**
   * Override validation hook for attachment-specific checks
   */
  async validateCompletedUpload(session: PresignedUploadSession, head: { size: number; mimeType?: string }) {
    await super.validateCompletedUpload(session, head)

    if (head.size > this.maxFileSize) {
      throw new Error(
        `File exceeds allowed size of ${Math.round(this.maxFileSize / 1024 / 1024)}MB`
      )
    }

    if (head.mimeType && !this.isAllowedMimeType(head.mimeType)) {
      throw new Error(`Uploaded type '${head.mimeType}' not allowed`)
    }
  }

  // ============= Presigned Upload Implementation (Legacy) =============

  /**
   * Get storage configuration for this processor
   */
  protected getStorageConfig(): Record<string, any> {
    return {
      visibility: this.fileVisibility,
      entityType: this.entityType,
    }
  }

  // ============= Asset and Attachment Creation =============

  /**
   * Create a MediaAsset record using MediaAssetService
   */
  protected async createAsset(session: PresignedUploadSession, storageLocationId: string, tx?: any): Promise<string> {
    try {
      const assetData: CreateAssetRequest = {
        kind: this.getAssetKind(session),
        name: session.fileName,
        mimeType: session.mimeType,
        size: BigInt(session.expectedSize),
        isPrivate: this.isAssetPrivate(session),
        organizationId: session.organizationId,
        createdById: session.userId,
      }

      const assetService = tx ? this.mediaAssetService.withTx(tx) : this.mediaAssetService
      const { asset } = await assetService.createWithVersion(assetData, storageLocationId)

      this.logger.info('Created MediaAsset record', {
        assetId: asset.id,
        assetKind: assetData.kind,
        fileName: session.fileName,
        sessionId: session.id,
      })

      return asset.id
    } catch (error) {
      this.logger.error('Failed to create MediaAsset record', {
        error: error instanceof Error ? error.message : String(error),
        sessionId: session.id,
      })
      throw new Error(
        `Failed to create asset record: ${error instanceof Error ? error.message : 'Unknown error'}`
      )
    }
  }


  // ============= Hooks for Subclasses =============

  /**
   * Called after asset creation for entity-specific logic
   */
  protected async postCreateAsset(
    session: PresignedUploadSession,
    storageLocationId: string,
    assetId: string,
    tx?: any
  ): Promise<void> {
    // Override in subclasses for entity-specific logic
    this.logger.debug('Asset created', { assetId, sessionId: session.id })
  }

  // ============= Abstract Methods =============

  /**
   * Validate that the entity exists and user has access
   * Override in subclasses that require entity validation
   */
  protected async validateEntityAccess(
    entityId: string,
    organizationId: string,
    userId: string
  ): Promise<void> {
    // Default implementation - override in subclasses if needed
  }

  /**
   * Get the asset kind for this processor
   */
  protected getAssetKind(session: PresignedUploadSession): AssetKind {
    // Allow subclasses to override based on session data
    return this.assetKind
  }

  /**
   * Determine if the asset should be private
   */
  protected isAssetPrivate(session: PresignedUploadSession): boolean {
    return this.fileVisibility === 'PRIVATE'
  }

  // ============= Private Helper Methods =============

  /**
   * Check if mime type is allowed
   */
  protected isAllowedMimeType(mimeType: string): boolean {
    return this.allowedMimeTypes.some((allowed) => {
      if (allowed === '*/*') return true
      if (allowed.endsWith('/*')) {
        return mimeType.startsWith(allowed.slice(0, -2))
      }
      return mimeType === allowed
    })
  }
}
