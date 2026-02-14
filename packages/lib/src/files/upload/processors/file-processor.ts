// packages/lib/src/files/upload/processors/file-processor.ts

import type { CreateFileRequest } from '../../core/types'
import type { ProcessorConfigResult, UploadInitConfig } from '../init-types'
import type { PresignedUploadSession } from '../session-types'
import { BaseProcessor } from './base-processor'
import type { ProcessorMetadata, ProcessorResult } from './types'

/**
 * Generic file processor for user files (no attachment needed)
 * Creates FolderFile records for user file management
 */
export class FileProcessor extends BaseProcessor {
  getMetadata(): ProcessorMetadata {
    return {
      name: 'file',
      entityTypes: [], // No specific entity types
      supportsAssets: false,
      supportsFiles: true,
      supportsAttachments: false,
    }
  }

  protected async executeProcess(
    session: PresignedUploadSession,
    storageLocationId: string
  ): Promise<ProcessorResult> {
    // User files are always FolderFiles (no attachment needed)
    const fileId = await this.createFile(session, storageLocationId)

    return {
      fileId,
      storageLocationId,
    }
  }

  /**
   * Create a FolderFile record using FileService
   */
  protected async createFile(
    session: PresignedUploadSession,
    storageLocationId: string
  ): Promise<string> {
    try {
      const fileData: CreateFileRequest = {
        name: session.fileName,
        // omit path; let FileService generate a collision-safe one
        ext: this.extractFileExtension(session.fileName),
        mimeType: session.mimeType,
        size: BigInt(session.expectedSize),
        organizationId: session.organizationId,
        createdById: session.userId,
        folderId: session.metadata?.folderId,
      }

      const { file } = await this.fileService.createWithVersion(fileData, storageLocationId)

      this.logger.info('Created FolderFile record', {
        fileId: file.id,
        fileName: session.fileName,
        sessionId: session.id,
      })

      return file.id
    } catch (error) {
      this.logger.error('Failed to create FolderFile record', {
        error: error instanceof Error ? error.message : String(error),
        sessionId: session.id,
      })
      throw new Error(
        `Failed to create file record: ${error instanceof Error ? error.message : 'Unknown error'}`
      )
    }
  }

  // ============= Unified Processor API =============

  /**
   * Process upload configuration for generic files
   */
  async processConfig(init: UploadInitConfig): Promise<ProcessorConfigResult> {
    const base = await super.processConfig({ ...init, provider: init.provider ?? 'S3' })
    const { config } = base
    const warnings = [...base.warnings]

    // File processor specific policy - allow all MIME types, large files
    const policy = {
      ...config.policy,
      allowedMimeTypes: ['*/*'], // Allow all file types for generic files
      maxTtl: 60 * 60, // 1 hour for user files
    }

    // Use larger threshold for multipart uploads for user files
    const uploadPlan =
      config.expectedSize >= 100 * 1024 * 1024 // 100MB
        ? { strategy: 'multipart' as const }
        : { strategy: 'single' as const }

    // Add warning if entity information is provided
    if (init.entityType && init.entityType !== 'FILE') {
      warnings.push('EntityType suggests attachment processor, but file processor is being used')
    }

    return {
      config: Object.freeze({
        ...config,
        policy,
        uploadPlan,
      }),
      warnings,
    }
  }
}
