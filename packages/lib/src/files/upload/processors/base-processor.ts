// packages/lib/src/files/upload/processors/base-processor.ts

import { createScopedLogger } from '@auxx/logger'
import { MediaAssetService } from '../../core/media-asset-service'
import { FileService } from '../../core/file-service'
import { AttachmentService } from '../../core/attachment-service'
import type { FileProcessor, ProcessorMetadata, ProcessorResult } from './types'
import type { PresignedUploadSession } from '../session-types'
import type {
  UploadInitConfig,
  UploadPreparedConfig,
  UploadPolicy,
  UploadPlan,
  ProcessorConfigResult,
} from '../init-types'
import {
  clamp,
  deriveStorageKey,
  normalizeMimeType,
  shouldUseMultipart,
  getDefaultKeyPrefix,
  getBucketForVisibility,
} from '../util'

const logger = createScopedLogger('base-processor')

/**
 * Base abstract class for all processors
 * Provides common functionality and services initialization
 */
export abstract class BaseProcessor implements FileProcessor {
  protected readonly organizationId: string
  protected mediaAssetService: MediaAssetService
  protected fileService: FileService
  protected attachmentService: AttachmentService
  protected readonly logger: typeof logger

  constructor(organizationId: string) {
    this.organizationId = organizationId
    this.initializeServices()
    this.logger = createScopedLogger(`base-processor`)
  }

  /**
   * Initialize services with current database instance
   */
  private initializeServices() {
    this.mediaAssetService = new MediaAssetService(this.organizationId)
    this.fileService = new FileService(this.organizationId)
    this.attachmentService = new AttachmentService(this.organizationId)
  }

  // ============= Abstract Methods =============

  abstract getMetadata(): ProcessorMetadata

  /**
   * Process uploaded file and create records
   * If opts.tx is provided, all services will use the transaction
   */
  async process(
    session: PresignedUploadSession,
    storageLocationId: string,
    opts?: { tx?: any }
  ): Promise<ProcessorResult> {
    // If transaction provided, create new services with tx
    if (opts?.tx) {
      this.mediaAssetService = this.mediaAssetService.withTx(opts.tx)
      this.fileService = this.fileService.withTx(opts.tx)
      this.attachmentService = this.attachmentService.withTx(opts.tx)
    }

    return this.executeProcess(session, storageLocationId, opts?.tx)
  }

  /**
   * Actual processing logic - subclasses implement this
   */
  protected abstract executeProcess(
    session: PresignedUploadSession,
    storageLocationId: string,
    tx?: any
  ): Promise<ProcessorResult>

  // ============= New Unified Processor API =============

  /**
   * Process upload configuration with processor-specific rules
   * This is the new unified API that replaces getUploadPreferences()
   */
  async processConfig(init: UploadInitConfig): Promise<ProcessorConfigResult> {
    const warnings: string[] = []

    // Normalize inputs
    const mimeType = normalizeMimeType(init.mimeType)
    const provider = init.provider ?? 'S3'
    const ttlSec = clamp(init.ttlSec ?? 10 * 60, 60, 60 * 60)

    // Generate storage key with new format: {orgId}/{entity-type}/{entityId}/{timestamp}_{filename}
    const storageKey = deriveStorageKey(init.organizationId, init.fileName, {
      entityType: init.entityType,
      entityId: init.entityId || 'temp',
      keySeed: init.keySeed,
    })

    // Base policy - permissive (entity processors will clamp it)
    const policy: UploadPolicy = {
      keyPrefix: getDefaultKeyPrefix(init.organizationId),
      contentLengthRange: [0, Number.MAX_SAFE_INTEGER], // base: permissive
      maxTtl: 10 * 60,
      allowedMimeTypes: [mimeType], // base: the normalized incoming type
    }

    // Default upload plan - can be overridden by subclasses
    const uploadPlan: UploadPlan = shouldUseMultipart(init.expectedSize)
      ? { strategy: 'multipart' }
      : { strategy: 'single' }

    // Default visibility and bucket (will be overridden by entity processors)
    const visibility: 'PUBLIC' | 'PRIVATE' = 'PRIVATE'
    const bucket = getBucketForVisibility(visibility)

    // Create immutable config
    const config: UploadPreparedConfig = Object.freeze({
      ...init,
      mimeType,
      provider,
      storageKey,
      ttlSec,
      policy,
      uploadPlan,
      visibility,
      bucket,
    })

    return { config, warnings }
  }

  /**
   * NEW: Post-upload validation hook
   * Validates the completed upload against session expectations
   */
  async validateCompletedUpload(
    session: PresignedUploadSession,
    head: { size: number; mimeType?: string }
  ): Promise<void> {
    // Exact size check if we have a client-declared expectation
    if (typeof session.expectedSize === 'number' && head.size !== session.expectedSize) {
      throw new Error(`Size mismatch: expected ${session.expectedSize}, got ${head.size}`)
    }

    // Lenient MIME check if provider returns Content-Type
    if (session.mimeType && head.mimeType) {
      const a = head.mimeType.split(';')[0].toLowerCase()
      const b = session.mimeType.split(';')[0].toLowerCase()
      if (a !== b) throw new Error(`MIME mismatch: expected ${b}, got ${a}`)
    }
  }

  // ============= Protected Helper Methods =============

  // ============= Utility Methods =============

  /**
   * Extract file extension from filename
   */
  protected extractFileExtension(fileName: string): string | undefined {
    const lastDot = fileName.lastIndexOf('.')
    if (lastDot === -1 || lastDot === fileName.length - 1) {
      return undefined
    }
    return fileName.substring(lastDot + 1).toLowerCase()
  }
}
