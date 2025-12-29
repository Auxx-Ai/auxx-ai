// packages/lib/src/files/upload/processors/dataset.ts

import { BaseAssetProcessor } from './base-asset-processor'
import type { PresignedUploadSession } from '../session-types'
import type { DatasetAssetMetadata, ProcessorResult } from './types'
import type { UploadInitConfig, ProcessorConfigResult } from '../init-types'
import { DocumentService } from '../../../datasets/services/document-service'
import { DocumentProcessingQueue } from '../../../datasets/workers/document-processing-queue'
import { createScopedLogger } from '@auxx/logger'
import { database as db } from '@auxx/database'
import { DatasetModel } from '@auxx/database/models'
import type { DocumentEntity } from '@auxx/database/models'

const logger = createScopedLogger('dataset-asset-processor')

/**
 * Asset processor for dataset documents
 * Extends BaseAssetProcessor to create MediaAsset records and Document entities
 */
export class DatasetAssetProcessor extends BaseAssetProcessor {
  protected entityType = 'dataset'
  protected fileVisibility = 'private'
  protected preferredProvider = 'local' // or 's3' based on config
  protected maxFileSize = 50 * 1024 * 1024 // 50MB
  protected assetKind = 'DOCUMENT' as const
  
  /**
   * Override processConfig to ensure datasetId is set in metadata
   */
  async processConfig(init: UploadInitConfig): Promise<ProcessorConfigResult> {
    // Ensure datasetId is in metadata
    const enrichedInit = {
      ...init,
      metadata: {
        ...init.metadata,
        datasetId: init.entityId, // Use entityId as datasetId for DATASET uploads
      }
    }
    
    // Call parent processConfig with enriched metadata
    return super.processConfig(enrichedInit)
  }

  protected allowedMimeTypes = [
    // Text documents
    'text/plain',
    'text/markdown',
    'text/x-markdown',
    'application/x-markdown',
    'text/x-web-markdown',
    'text/csv',
    'text/tab-separated-values',
    'text/tsv',
    'application/json',
    'application/x-ndjson',
    'application/jsonl',
    'text/json',
    'application/xml',
    'text/xml',
    'application/x-yaml',
    'text/yaml',
    'text/x-yaml',
    'application/yaml',
    'text/css',
    'text/javascript',
    'application/javascript',
    'text/x-python',
    'text/x-sql',
    'text/x-log',
    'text/log',
    
    // Microsoft Office
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'application/vnd.ms-powerpoint',
    
    // PDF
    'application/pdf',
    
    // Web formats
    'text/html',
    'application/xhtml+xml',
    
    // Archives
    'application/zip',
    'application/x-zip-compressed',
    
    // Email formats
    'message/rfc822',
    'application/vnd.ms-outlook',
    
    // eBooks
    'application/epub+zip',
    
    // Rich text
    'application/rtf',
    
    // Support for files without extension detection
    '',
    'application/octet-stream',
  ]

  /**
   * Override the entire process to handle transaction properly
   */
  async process(
    session: PresignedUploadSession,
    storageLocationId: string,
    opts?: { tx?: any }
  ): Promise<ProcessorResult> {
    // Call parent process to create MediaAsset
    const result = await super.process(session, storageLocationId, opts)

    // Now create Document with the same transaction
    const document = await this.createDocumentRecord(session, storageLocationId, result.assetId!, opts?.tx)

    return {
      ...result,
      documentId: document.id,
    }
  }

  /**
   * Create Document record with proper transaction handling
   * Returns the created document for use in the response
   */
  private async createDocumentRecord(
    session: PresignedUploadSession,
    _storageLocationId: string,
    assetId: string,
    tx?: any
  ): Promise<DocumentEntity> {
    const metadata = session.metadata as DatasetAssetMetadata

    if (!metadata?.datasetId) {
      throw new Error('Dataset ID is required for document processing')
    }

    logger.info('Creating document record', {
      sessionId: session.id,
      assetId,
      datasetId: metadata.datasetId,
      fileName: session.fileName,
      usingTransaction: !!tx,
    })

    // Create Document record with mediaAssetId - use transaction if provided
    const documentService = tx ? new DocumentService(tx) : new DocumentService(db)

    try {
      const document = await documentService.createFromFileUpload({
        title: metadata.documentName || this.extractNameFromFilename(session.fileName),
        filename: session.fileName,
        mimeType: session.mimeType,
        size: session.expectedSize,
        datasetId: metadata.datasetId,
        uploadedById: session.userId,
        mediaAssetId: assetId,
        checksum: `${session.fileName}-${Date.now()}`,
        originalPath: session.fileName,
        processingOptions: metadata.processingOptions as any,
      }, session.organizationId)

      // Queue for background processing
      await this.queueDocumentProcessing(document, metadata, session)

      logger.info('Document created and queued for processing', {
        documentId: document.id,
        assetId,
        organizationId: session.organizationId,
        datasetId: metadata.datasetId,
      })

      return document as DocumentEntity
    } catch (error) {
      logger.error('Failed to create document record', {
        error: error instanceof Error ? error.message : String(error),
        sessionId: session.id,
        assetId,
        datasetId: metadata.datasetId,
      })
      throw error
    }
  }

  /**
   * Queue document for background processing
   */
  private async queueDocumentProcessing(document: any, metadata: DatasetAssetMetadata, session: PresignedUploadSession): Promise<void> {
    // Queue document for processing unless explicitly skipped
    if (!metadata.processingOptions?.skipParsing) {
      await DocumentProcessingQueue.queueDocumentProcessing(
        (document as any).id,
        metadata.datasetId,
        (document as any).organizationId,
        session.userId,
        {
          priority: 1,
          delay: 0,
          mediaAssetId: document.mediaAssetId, // NEW: Use mediaAssetId
          fileName: document.filename,
          fileSize: Number(document.size),
          mimeType: document.mimeType,
          documentType: document.type,
        }
      )
    }
  }

  /**
   * Extract document name from filename
   */
  private extractNameFromFilename(filename: string): string {
    const name = filename.split('.').slice(0, -1).join('.')
    return name || filename
  }

  /**
   * Validate entity access - ensure user can upload to this dataset
   */
  protected async validateEntityAccess(entityId: string, organizationId: string): Promise<void> {
    // Check if dataset exists and user has access
    const datasetModel = new DatasetModel(organizationId)
    const res = await datasetModel.findById(entityId)
    const dataset = res.ok ? res.value : null

    if (!dataset) {
      throw new Error('Dataset not found or access denied')
    }
  }
}
