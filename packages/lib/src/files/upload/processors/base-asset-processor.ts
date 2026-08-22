// packages/lib/src/files/upload/processors/base-asset-processor.ts

import type { AssetKind, CreateAssetRequest } from '../../core/types'
import { bucketForVisibility, type StorageVisibility } from '../../storage/buckets'
import type { ProcessorConfigResult, UploadInitConfig } from '../init-types'
import type { PresignedUploadSession } from '../session-types'
import { BaseProcessor } from './base-processor'
import type { ProcessorMetadata, ProcessorResult } from './types'

/**
 * Base asset processor with entity-specific configuration
 * Subclasses define entity-specific rules and behavior
 * Creates assets only - no attachments
 */
export abstract class BaseAssetProcessor extends BaseProcessor {
  // Entity-specific configuration (override in subclasses)
  protected abstract entityType: string
  /**
   * Which bucket this entity's uploads belong in.
   *
   * A **strict union**, not `string`. It was `string`, and `processConfig` cast
   * it (`this.fileVisibility as 'PUBLIC' | 'PRIVATE'`) at the one place it
   * mattered — so `DatasetAssetProcessor` compiled with lowercase `'private'`,
   * which matched neither branch of `bucketForVisibility` and made
   * `isAssetPrivate()` (a `=== 'PRIVATE'` comparison) answer `false`. Dataset
   * documents were routed to the public bucket and recorded as non-private.
   * The union turns that into a compile error.
   */
  protected abstract fileVisibility: StorageVisibility
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

  protected async executeProcess(
    session: PresignedUploadSession,
    storageLocationId: string,
    tx?: any
  ): Promise<ProcessorResult> {
    // Only create asset - no attachments
    const { assetId } = await this.createAsset(session, storageLocationId, tx)

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
    const visibility = this.fileVisibility
    const bucket = bucketForVisibility(visibility)

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

  // `validateCompletedUpload` is deliberately NOT overridden. It used to
  // re-check `head.size` against `this.maxFileSize` and `head.mimeType` against
  // `this.allowedMimeTypes` — a second, hand-written copy of the rules the
  // session's own `policy` already encodes, and one that judged the processor's
  // fields rather than the policy that was actually signed. `BaseProcessor` now
  // delegates to the shared `validateCompletedUpload` in `upload/config.ts`,
  // which reads `session.policy`, so a `CUSTOM_FIELD` upload's per-field MIME
  // narrowing survives to the end of the upload instead of applying only to the
  // presign.

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
  protected async createAsset(
    session: PresignedUploadSession,
    storageLocationId: string,
    tx?: any
  ): Promise<{ assetId: string; externalUrl: string | null }> {
    try {
      const assetData: CreateAssetRequest = {
        kind: this.getAssetKind(session),
        purpose: 'ORIGINAL',
        name: session.fileName,
        mimeType: session.mimeType,
        size: session.expectedSize,
        isPrivate: this.isAssetPrivate(session),
        organizationId: session.organizationId,
        createdById: session.userId,
      }

      const assetService = tx ? this.mediaAssetService.withTx(tx) : this.mediaAssetService
      const { asset, version } = await assetService.createWithVersion(assetData, storageLocationId)

      this.logger.info('Created MediaAsset record', {
        assetId: asset.id,
        assetKind: assetData.kind,
        fileName: session.fileName,
        sessionId: session.id,
      })

      return { assetId: asset.id, externalUrl: version.storageLocation?.externalUrl ?? null }
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
