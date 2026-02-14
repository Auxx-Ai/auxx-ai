// packages/lib/src/datasets/services/document-service.ts
import { type Database, schema } from '@auxx/database'
import { DocumentStatus, DocumentType as DocumentTypeEnum } from '@auxx/database/enums'
import type {
  ChunkSettings,
  DocumentStatus as DocumentStatusType,
  DocumentType,
} from '@auxx/database/types'
import { createScopedLogger } from '@auxx/logger'
import { and, asc, count, desc, eq, gte, ilike, inArray, lte, or } from 'drizzle-orm'
import { MediaAssetService } from '../../files/core/media-asset-service'
import type {
  BatchProcessingRequest,
  CreateDocumentFromFileInput,
  DocumentFilters,
  DocumentListResponse,
  DocumentMetadata,
  DocumentWithRelations,
  PaginationParams,
} from '../types'
import { DocumentProcessingError } from '../types'
import { DocumentProcessingQueue } from '../workers/document-processing-queue'

const logger = createScopedLogger('document-service')
/**
 * Service for managing documents within datasets
 */
export class DocumentService {
  constructor(private db: Database) {}
  /**
   * Create document from file upload
   */
  async createFromFileUpload(
    input: CreateDocumentFromFileInput,
    organizationId: string
  ): Promise<DocumentWithRelations> {
    try {
      // Check for existing document with same checksum in dataset
      const [existingDocument] = await this.db
        .select()
        .from(schema.Document)
        .where(
          and(
            eq(schema.Document.datasetId, input.datasetId),
            eq(schema.Document.checksum, input.checksum),
            eq(schema.Document.organizationId, organizationId)
          )
        )
        .limit(1)
      if (existingDocument) {
        throw new DocumentProcessingError('Document with same checksum already exists in dataset', {
          checksum: input.checksum,
          existingDocumentId: existingDocument.id,
        })
      }
      // Detect document type from MIME type
      const documentType = this.detectDocumentType(input.mimeType)
      // Create standardized metadata
      const metadata: DocumentMetadata = {
        processingOptions: input.processingOptions || {},
        uploadInfo: {
          originalFilename: input.filename,
          uploadedAt: new Date().toISOString(),
          fileSize: input.size,
          mimeType: input.mimeType,
          uploader: input.uploadedById
            ? {
                id: input.uploadedById,
              }
            : undefined,
        },
      }
      // Create document with Drizzle
      const [createdDocument] = await this.db
        .insert(schema.Document)
        .values({
          title: input.title,
          filename: input.filename,
          originalPath: input.originalPath,
          mimeType: input.mimeType,
          type: documentType,
          size: input.size,
          checksum: input.checksum,
          status: DocumentStatus.UPLOADED,
          enabled: true,
          metadata: metadata,
          chunkSettings: input.chunkSettings || null,
          datasetId: input.datasetId,
          organizationId,
          uploadedById: input.uploadedById || null,
          mediaAssetId: input.mediaAssetId,
          updatedAt: new Date(),
        })
        .returning({ id: schema.Document.id })

      // Fetch the created document with relations
      const document = await this.getById(createdDocument.id, organizationId)

      if (!document) {
        throw new DocumentProcessingError('Failed to retrieve created document', {
          documentId: createdDocument.id,
        })
      }

      logger.info('Document created from file upload', {
        documentId: document.id,
        organizationId,
        datasetId: input.datasetId,
        filename: input.filename,
      })
      return document
    } catch (error: any) {
      if (error instanceof DocumentProcessingError) {
        throw error
      }
      logger.error('Failed to create document from file upload', {
        error: error.message,
        stack: error.stack,
        input,
      })
      throw new DocumentProcessingError('Failed to create document from file upload', {
        error,
        input,
      })
    }
  }
  /**
   * Update document fields
   * @param documentId - Document ID
   * @param organizationId - Organization ID
   * @param data - Fields to update
   * @param options - Options (returning: true to return updated document)
   * @returns Updated document if returning: true, otherwise void
   */
  async update(
    documentId: string,
    organizationId: string,
    data: {
      title?: string
      status?: DocumentStatusType
      enabled?: boolean
      /** Pass partial settings to update, null to clear override, or undefined to leave unchanged */
      chunkSettings?: Partial<ChunkSettings> | null
      /** Document metadata (replaces existing metadata) */
      metadata?: Record<string, unknown>
      /** Total number of chunks/segments */
      totalChunks?: number
      /** Processing time in milliseconds */
      processingTime?: number
      /** When processing completed (overrides auto-set on INDEXED) */
      processedAt?: Date
    },
    options?: {
      /** If true, returns the updated document row */
      returning?: boolean
    }
  ): Promise<typeof schema.Document.$inferSelect | void> {
    try {
      // Build the update object with only provided fields
      const updateData: Record<string, unknown> = {
        updatedAt: new Date(),
      }
      if (data.title !== undefined) {
        updateData.title = data.title
      }
      if (data.status !== undefined) {
        updateData.status = data.status
        // Auto-set processedAt when marking as INDEXED (if not explicitly provided)
        if (data.status === DocumentStatus.INDEXED && data.processedAt === undefined) {
          updateData.processedAt = new Date()
        }
      }
      if (data.enabled !== undefined) {
        updateData.enabled = data.enabled
      }
      if (data.chunkSettings !== undefined) {
        updateData.chunkSettings = data.chunkSettings
      }
      if (data.metadata !== undefined) {
        updateData.metadata = data.metadata
      }
      if (data.totalChunks !== undefined) {
        updateData.totalChunks = data.totalChunks
      }
      if (data.processingTime !== undefined) {
        updateData.processingTime = data.processingTime
      }
      if (data.processedAt !== undefined) {
        updateData.processedAt = data.processedAt
      }

      if (options?.returning) {
        const [updated] = await this.db
          .update(schema.Document)
          .set(updateData)
          .where(
            and(
              eq(schema.Document.id, documentId),
              eq(schema.Document.organizationId, organizationId)
            )
          )
          .returning()

        logger.info('Document updated', { documentId, organizationId, updates: Object.keys(data) })
        return updated
      }

      await this.db
        .update(schema.Document)
        .set(updateData)
        .where(
          and(
            eq(schema.Document.id, documentId),
            eq(schema.Document.organizationId, organizationId)
          )
        )

      logger.info('Document updated', { documentId, organizationId, updates: Object.keys(data) })
    } catch (error) {
      throw new DocumentProcessingError('Failed to update document', { error, documentId })
    }
  }

  /**
   * Detect document type from MIME type
   */
  private detectDocumentType(mimeType: string): DocumentType {
    const mimeTypeLower = mimeType.toLowerCase()
    if (mimeTypeLower.includes('pdf')) {
      return DocumentTypeEnum.PDF
    }
    if (mimeTypeLower.includes('word') || mimeTypeLower.includes('docx')) {
      return DocumentTypeEnum.DOCX
    }
    if (mimeTypeLower.includes('text/plain')) {
      return DocumentTypeEnum.TXT
    }
    if (mimeTypeLower.includes('text/html')) {
      return DocumentTypeEnum.HTML
    }
    if (mimeTypeLower.includes('text/markdown')) {
      return DocumentTypeEnum.MARKDOWN
    }
    if (mimeTypeLower.includes('csv')) {
      return DocumentTypeEnum.CSV
    }
    if (mimeTypeLower.includes('json')) {
      return DocumentTypeEnum.JSON
    }
    if (mimeTypeLower.includes('xml')) {
      return DocumentTypeEnum.XML
    }
    // Default to TXT for unknown types
    return DocumentTypeEnum.TXT
  }
  /**
   * Get a document by ID
   */
  async getById(documentId: string, organizationId: string): Promise<DocumentWithRelations | null> {
    try {
      const document = await this.db.query.Document.findFirst({
        where: and(
          eq(schema.Document.id, documentId),
          eq(schema.Document.organizationId, organizationId)
        ),
        with: {
          dataset: {
            columns: { id: true, name: true },
          },
          uploadedBy: {
            columns: { id: true, name: true, email: true },
          },
          mediaAsset: {
            columns: { id: true, name: true, mimeType: true, size: true },
          },
        },
      })

      return document as DocumentWithRelations | null
    } catch (error) {
      throw new DocumentProcessingError('Failed to get document', { error })
    }
  }
  /**
   * List documents in a dataset
   */
  async list(
    organizationId: string,
    filters?: DocumentFilters,
    pagination?: PaginationParams
  ): Promise<DocumentListResponse> {
    try {
      const { page = 1, limit = 20, sortBy = 'createdAt', sortOrder = 'desc' } = pagination || {}
      const offset = (page - 1) * limit

      // Build where conditions array
      const whereConditions = [eq(schema.Document.organizationId, organizationId)]

      if (filters?.datasetId) {
        whereConditions.push(eq(schema.Document.datasetId, filters.datasetId))
      }
      if (filters?.status) {
        whereConditions.push(eq(schema.Document.status, filters.status))
      }
      if (filters?.type) {
        whereConditions.push(eq(schema.Document.type, filters.type))
      }
      if (filters?.uploadedById) {
        whereConditions.push(eq(schema.Document.uploadedById, filters.uploadedById))
      }
      if (filters?.search) {
        whereConditions.push(
          or(
            ilike(schema.Document.title, `%${filters.search}%`),
            ilike(schema.Document.filename, `%${filters.search}%`),
            ilike(schema.Document.content, `%${filters.search}%`)
          )!
        )
      }
      if (filters?.dateRange) {
        whereConditions.push(
          and(
            gte(schema.Document.createdAt, filters.dateRange.start),
            lte(schema.Document.createdAt, filters.dateRange.end)
          )!
        )
      }

      const whereClause = and(...whereConditions)

      // Get sort column properly
      const getSortColumn = (sortBy: string) => {
        switch (sortBy) {
          case 'title':
            return schema.Document.title
          case 'filename':
            return schema.Document.filename
          case 'status':
            return schema.Document.status
          case 'type':
            return schema.Document.type
          case 'size':
            return schema.Document.size
          case 'updatedAt':
            return schema.Document.updatedAt
          default:
            return schema.Document.createdAt
        }
      }

      const [documents, totalCountResult] = await Promise.all([
        this.db.query.Document.findMany({
          where: whereClause,
          with: {
            dataset: {
              columns: { id: true, name: true },
            },
            uploadedBy: {
              columns: { id: true, name: true, email: true },
            },
            mediaAsset: {
              columns: { id: true, name: true, mimeType: true, size: true },
            },
          },
          orderBy: sortOrder === 'desc' ? desc(getSortColumn(sortBy)) : asc(getSortColumn(sortBy)),
          offset: offset,
          limit: limit,
        }),
        this.db.select({ count: count() }).from(schema.Document).where(whereClause),
      ])

      const totalCount = totalCountResult[0]?.count || 0

      // Get segment counts for all documents
      const documentIds = documents.map((doc) => doc.id)
      const segmentCounts =
        documentIds.length > 0
          ? await this.db
              .select({
                documentId: schema.DocumentSegment.documentId,
                count: count(),
              })
              .from(schema.DocumentSegment)
              .where(inArray(schema.DocumentSegment.documentId, documentIds))
              .groupBy(schema.DocumentSegment.documentId)
          : []

      // Create a map for quick lookup
      // const segmentCountMap = new Map(segmentCounts.map((sc) => [sc.documentId, Number(sc.count)]))

      // Add segment counts to documents
      const documentsWithCounts = documents.map((document) => ({
        ...document,
      })) as DocumentWithRelations[]

      return {
        documents: documentsWithCounts,
        totalCount,
        hasMore: totalCount > offset + documents.length,
      }
    } catch (error) {
      throw new DocumentProcessingError('Failed to list documents', { error })
    }
  }

  /**
   * Update document processing metrics
   */
  async updateProcessingMetrics(
    documentId: string,
    organizationId: string,
    metrics: {
      totalChunks: number
      processingTime: number
    }
  ): Promise<void> {
    try {
      await this.db
        .update(schema.Document)
        .set({
          totalChunks: metrics.totalChunks,
          processingTime: metrics.processingTime,
          processedAt: new Date(),
          status: DocumentStatus.INDEXED,
        })
        .where(
          and(
            eq(schema.Document.id, documentId),
            eq(schema.Document.organizationId, organizationId)
          )
        )
    } catch (error) {
      throw new DocumentProcessingError('Failed to update processing metrics', { error })
    }
  }
  /**
   * Delete a document
   */
  async delete(documentId: string, organizationId: string): Promise<void> {
    try {
      await this.db
        .delete(schema.Document)
        .where(
          and(
            eq(schema.Document.id, documentId),
            eq(schema.Document.organizationId, organizationId)
          )
        )
    } catch (error) {
      throw new DocumentProcessingError('Failed to delete document', { error })
    }
  }

  /**
   * Batch process documents
   */
  async batchProcess(
    organizationId: string,
    request: BatchProcessingRequest
  ): Promise<{
    success: number
    failed: number
    results: Array<{
      id: string
      success: boolean
      error?: string
    }>
  }> {
    const results: Array<{
      id: string
      success: boolean
      error?: string
    }> = []
    let success = 0
    let failed = 0
    for (const documentId of request.documentIds) {
      try {
        switch (request.operation) {
          case 'reprocess':
            await this.update(documentId, organizationId, { status: DocumentStatus.PROCESSING })
            break
          case 'delete':
            await this.delete(documentId, organizationId)
            break
          case 'archive':
            await this.update(documentId, organizationId, { status: DocumentStatus.ARCHIVED })
            break
          case 'enable':
            await this.update(documentId, organizationId, { enabled: true })
            break
          case 'disable':
            await this.update(documentId, organizationId, { enabled: false })
            break
        }
        results.push({ id: documentId, success: true })
        success++
      } catch (error) {
        results.push({
          id: documentId,
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        })
        failed++
      }
    }
    return { success, failed, results }
  }
  /**
   * Reprocess document with new options
   */
  async reprocess(
    documentId: string,
    organizationId: string,
    options?: {
      updateChunking?: boolean
      chunkingConfig?: any
      priority?: number
    }
  ): Promise<void> {
    try {
      const document = await this.db.query.Document.findFirst({
        where: and(
          eq(schema.Document.id, documentId),
          eq(schema.Document.organizationId, organizationId)
        ),
        with: {
          mediaAsset: true,
        },
      })
      if (!document) {
        throw new DocumentProcessingError('Document not found', { documentId })
      }

      // If updating chunking, clear existing segments
      if (options?.updateChunking) {
        await this.db
          .delete(schema.DocumentSegment)
          .where(eq(schema.DocumentSegment.documentId, documentId))
      }

      // Queue the document processing job
      await DocumentProcessingQueue.queueDocumentProcessing(
        documentId,
        document.datasetId,
        organizationId,
        undefined,
        {
          priority: options?.priority || 1,
          mediaAssetId: document.mediaAssetId || undefined,
          fileName: document.filename || '',
          fileSize: Number(document.size),
          mimeType: document.mimeType || 'application/octet-stream',
          documentType: document.type,
          chunkingOptions: options?.chunkingConfig,
        }
      )

      // Update document status to processing
      await this.update(documentId, organizationId, { status: DocumentStatus.PROCESSING })
      logger.info('Document reprocessing queued', { documentId, organizationId, options })
    } catch (error) {
      throw new DocumentProcessingError('Failed to reprocess document', { error, documentId })
    }
  }
  /**
   * Get processing queue status for documents
   */
  // async getQueueStatus(datasetId: string): Promise<any> {
  //   try {
  //     return await DocumentProcessingQueue.getProcessingStatus(datasetId)
  //   } catch (error) {
  //     throw new DocumentProcessingError('Failed to get queue status', { error, datasetId })
  //   }
  // }

  /**
   * Retry failed processing jobs
   */
  // async retryFailedJobs(datasetId: string): Promise<void> {
  //   try {
  //     await DocumentProcessingQueue.retryFailedJobs(datasetId)
  //     // Update failed documents back to processing status
  //     await this.db
  //       .update(schema.Document)
  //       .set({
  //         status: DocumentStatus.PROCESSING,
  //         errorMessage: null,
  //         updatedAt: new Date(),
  //       })
  //       .where(
  //         and(
  //           eq(schema.Document.datasetId, datasetId),
  //           eq(schema.Document.status, DocumentStatus.FAILED)
  //         )
  //       )
  //     logger.info('Failed processing jobs retried for dataset', { datasetId })
  //   } catch (error) {
  //     throw new DocumentProcessingError('Failed to retry failed jobs', { error, datasetId })
  //   }
  // }
  /**
   * Get document file download URL
   */
  async getDownloadUrl(documentId: string, organizationId: string): Promise<string | null> {
    const document = await this.getById(documentId, organizationId)
    if (!document?.mediaAssetId) return null
    const mediaAssetService = new MediaAssetService(organizationId)
    return await mediaAssetService.getDownloadUrl(document.mediaAssetId)
  }
  /**
   * Get document file content for processing
   */
  async getContent(documentId: string, organizationId: string): Promise<Buffer | null> {
    const document = await this.getById(documentId, organizationId)
    if (!document?.mediaAssetId) return null
    const mediaAssetService = new MediaAssetService(organizationId)
    return await mediaAssetService.getContent(document.mediaAssetId)
  }
  /**
   * Check for duplicate documents in dataset
   */
  async checkDuplicates(
    fileIds: string[],
    datasetId: string,
    organizationId: string
  ): Promise<
    Map<
      string,
      {
        documentId: string
        title: string
      }
    >
  > {
    const duplicates = new Map()
    // Get files with their current versions to check checksums
    const files = await this.db.query.FolderFile.findMany({
      where: and(
        inArray(schema.FolderFile.id, fileIds),
        eq(schema.FolderFile.organizationId, organizationId)
      ),
      with: {
        currentVersion: true,
      },
    })
    // Check each file for duplicates
    for (const file of files) {
      // Use file checksum, or version checksum/storageLocationId as content identifier
      const checksum =
        file.checksum ||
        file.currentVersion?.checksum ||
        file.currentVersion?.storageLocationId ||
        `file-${file.id}`
      const existing = await this.db.query.Document.findFirst({
        where: and(
          eq(schema.Document.datasetId, datasetId),
          eq(schema.Document.checksum, checksum),
          eq(schema.Document.organizationId, organizationId)
        ),
        columns: { id: true, title: true },
      })
      if (existing) {
        duplicates.set(file.id, {
          documentId: existing.id,
          title: existing.title,
        })
      }
    }
    return duplicates
  }
  /**
   * Create documents from existing files - Simplified
   */
  async createFromExistingFiles(
    input: {
      fileSelections: Array<{
        fileId: string
        fileVersionId?: string
        title?: string
      }>
      datasetId: string
      skipDuplicates?: boolean
      processImmediately?: boolean
      uploadedById?: string
    },
    organizationId: string
  ): Promise<{
    created: DocumentWithRelations[]
    skipped: Array<{
      fileId: string
      reason: string
    }>
    failed: Array<{
      fileId: string
      error: string
    }>
  }> {
    const results = {
      created: [] as DocumentWithRelations[],
      skipped: [] as Array<{
        fileId: string
        reason: string
      }>,
      failed: [] as Array<{
        fileId: string
        error: string
      }>,
    }
    // Check duplicates upfront if needed
    const duplicateMap = input.skipDuplicates
      ? await this.checkDuplicates(
          input.fileSelections.map((s) => s.fileId),
          input.datasetId,
          organizationId
        )
      : new Map()
    // Process each file selection
    for (const selection of input.fileSelections) {
      try {
        // Skip if duplicate
        if (duplicateMap.has(selection.fileId)) {
          const dup = duplicateMap.get(selection.fileId)!
          results.skipped.push({
            fileId: selection.fileId,
            reason: `Document already exists: ${dup.title}`,
          })
          continue
        }
        // Get file details with currentVersion for better checksum fallback
        const file = await this.db.query.FolderFile.findFirst({
          where: and(
            eq(schema.FolderFile.id, selection.fileId),
            eq(schema.FolderFile.organizationId, organizationId)
          ),
          with: {
            currentVersion: true,
          },
        })
        if (!file) {
          results.failed.push({
            fileId: selection.fileId,
            error: 'File not found',
          })
          continue
        }
        // Create MediaAsset from FolderFile
        const mediaAssetService = new MediaAssetService(organizationId)
        const mediaAsset = await mediaAssetService.createFromFolderFile(
          selection.fileId,
          selection.fileVersionId,
          { kind: 'DOCUMENT', skipIfExists: true }
        )
        // Create Document
        // Use file checksum, or version checksum/storageLocationId as content identifier
        const checksum =
          file.checksum ||
          file.currentVersion?.checksum ||
          file.currentVersion?.storageLocationId ||
          `file-${file.id}`
        const document = await this.createFromFileUpload(
          {
            title: selection.title || file.name,
            filename: file.name,
            mimeType: file.mimeType || 'application/octet-stream',
            size: Number(file.size || 0),
            datasetId: input.datasetId,
            uploadedById: input.uploadedById || undefined,
            mediaAssetId: mediaAsset.id,
            checksum,
            originalPath: file.path || undefined,
            processingOptions: {
              skipParsing: !input.processImmediately,
            },
          },
          organizationId
        )
        results.created.push(document)
        // Queue for processing if requested
        if (input.processImmediately) {
          await DocumentProcessingQueue.queueDocumentProcessing(
            document.id,
            input.datasetId,
            organizationId,
            input.uploadedById,
            {
              priority: 1,
              mediaAssetId: mediaAsset.id,
              fileName: file.name,
              fileSize: Number(file.size || 0),
              mimeType: file.mimeType || 'application/octet-stream',
            }
          )
        }
      } catch (error: any) {
        logger.error('Failed to create document from existing file', {
          fileId: selection.fileId,
          datasetId: input.datasetId,
          organizationId,
          error: error.message,
          stack: error.stack,
        })
        results.failed.push({
          fileId: selection.fileId,
          error: error.message || 'Unknown error',
        })
      }
    }
    return results
  }
}
