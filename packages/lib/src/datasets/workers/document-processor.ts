// packages/lib/src/datasets/workers/document-processor.ts
import { database as db, schema } from '@auxx/database'
import { DocumentStatus, IndexStatus } from '@auxx/database/enums'
import type { ChunkPreprocessingOptions, ChunkSettings } from '@auxx/database/types'
import { MediaAssetService } from '@auxx/lib/files'
import { createDocumentProcessingFlow } from '@auxx/lib/jobs/flows'
import { createScopedLogger } from '@auxx/logger'
import { interpretEscapeSequences } from '@auxx/utils'
import { eq } from 'drizzle-orm'
import { DocumentEventType, type DocumentExecutionReporter } from '../events'
import { ExtractorFactory } from '../extractors/extractor-factory'
import { TextChunker } from '../processors/text-chunker'
import { DocumentService } from '../services/document-service'
import type { DocumentProcessingJobData, WorkerJobResult } from '../types/worker.types'

const logger = createScopedLogger('document-processor')
/**
 * Document processor service
 *
 * Handles the complete document processing pipeline:
 * 1. Extract content from files
 * 2. Clean and preprocess content
 * 3. Split into chunks/segments
 * 4. Queue for embedding generation
 * 5. Update processing status
 */
export class DocumentProcessor {
  /**
   * Process document through extraction and chunking, then create flow for embeddings
   * Uses BullMQ FlowProducer for parent-child job dependencies
   *
   * IMPORTANT: This implementation preserves the whitespace fix from fix-whitespace-stripping-and-search-threshold.md.
   * Key requirements:
   * 1. Fetch chunkSettings from the dataset BEFORE cleaning content
   * 2. Pass settings.preprocessing to cleanContent() to respect normalizeWhitespace setting
   * 3. Pass settings to createSegments() to avoid duplicate DB query
   *
   * @param jobData - Document processing job data
   * @param reporter - Reporter for SSE events
   * @param signal - Optional AbortSignal for cancellation support
   */
  static async processDocumentWithFlow(
    jobData: DocumentProcessingJobData,
    reporter: DocumentExecutionReporter,
    signal?: AbortSignal
  ): Promise<WorkerJobResult> {
    const { documentId, datasetId, organizationId, userId } = jobData
    const startTime = Date.now()
    const documentService = new DocumentService(db)

    try {
      // Check for cancellation
      if (signal?.aborted) {
        throw new Error('Job cancelled')
      }

      await reporter.emit(DocumentEventType.PROCESSING_STARTED, {
        fileName: jobData.fileName,
        mimeType: jobData.mimeType,
      })

      // Update document status to processing and get document's chunkSettings
      const document = await documentService.update(
        documentId,
        organizationId,
        { status: DocumentStatus.PROCESSING },
        { returning: true }
      )

      // 1. Extract content
      await reporter.emit(DocumentEventType.EXTRACTION_STARTED, { step: 'extraction' })
      const extractionResult = await DocumentProcessor.extractContent(jobData)

      if (!extractionResult.success) {
        throw new Error(`Extraction failed: ${extractionResult.error}`)
      }

      await reporter.emit(DocumentEventType.EXTRACTION_COMPLETED, {
        contentLength: extractionResult.content!.length,
        wordCount: extractionResult.wordCount,
      })

      // Check cancellation between steps
      if (signal?.aborted) throw new Error('Job cancelled')

      // 2. Fetch dataset settings for preprocessing (IMPORTANT: must fetch BEFORE cleaning)
      // This ensures whitespace normalization respects user settings
      const [dataset] = await db
        .select({ chunkSettings: schema.Dataset.chunkSettings })
        .from(schema.Dataset)
        .where(eq(schema.Dataset.id, datasetId))
        .limit(1)

      // Resolve settings: document > dataset > defaults
      const documentChunkSettings = document?.chunkSettings as ChunkSettings | undefined
      const datasetChunkSettings = dataset?.chunkSettings as ChunkSettings | undefined
      const settings = documentChunkSettings ?? datasetChunkSettings

      // 3. Clean content WITH preprocessing settings (preserves whitespace fix)
      const cleanedContent = DocumentProcessor.preprocessContent(
        extractionResult.content!,
        settings?.preprocessing
      )

      // 4. Delete existing segments before creating new ones (for reprocessing)
      await db
        .delete(schema.DocumentSegment)
        .where(eq(schema.DocumentSegment.documentId, documentId))

      // 5. Create segments (pass settings to avoid duplicate DB query)
      await reporter.emit(DocumentEventType.CHUNKING_STARTED, {
        contentLength: cleanedContent.length,
      })

      const segments = await DocumentProcessor.createSegments(
        documentId,
        datasetId,
        cleanedContent,
        extractionResult.metadata,
        jobData.chunkingConfig,
        organizationId,
        settings // Pass pre-fetched settings to avoid duplicate DB query
      )

      await reporter.emit(DocumentEventType.CHUNKING_COMPLETED, {
        segmentCount: segments.length,
      })

      // Update document totalChunks immediately after chunking
      await documentService.update(documentId, organizationId, {
        totalChunks: segments.length,
      })

      // 6. Create embedding flow (instead of direct queueing)
      if (segments.length > 0) {
        await reporter.emit(DocumentEventType.EMBEDDING_STARTED, {
          totalSegments: segments.length,
        })

        await createDocumentProcessingFlow({
          documentId,
          datasetId,
          organizationId,
          userId,
          segments: segments.map((s) => ({
            segmentId: s!.id,
            content: s!.content,
          })),
        })

        // Note: Document status will be updated by the finalize job
        // Don't mark as INDEXED here - the flow will handle it!
      } else {
        // No segments - mark as indexed immediately
        const processingTime = Date.now() - startTime
        await documentService.update(documentId, organizationId, {
          status: DocumentStatus.INDEXED,
          totalChunks: 0,
          processingTime,
          processedAt: new Date(),
          metadata: {
            processingCompletedAt: new Date().toISOString(),
            segmentCount: 0,
            processingTime,
          },
        })

        await reporter.emit(DocumentEventType.PROCESSING_COMPLETED, {
          segmentCount: 0,
          totalProcessingTimeMs: processingTime,
        })
      }

      return {
        success: true,
        data: {
          documentId,
          segmentCount: segments.length,
          flowCreated: segments.length > 0,
        },
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Processing failed'

      await reporter.emit(DocumentEventType.PROCESSING_FAILED, {
        error: errorMessage,
      })

      // Mark document as failed
      await documentService
        .update(documentId, organizationId, {
          status: DocumentStatus.FAILED,
          metadata: {
            error: errorMessage,
            failedAt: new Date().toISOString(),
            processingTime: Date.now() - startTime,
          },
        })
        .catch((updateError) => {
          logger.error('Failed to update document error status', {
            documentId,
            updateError: updateError instanceof Error ? updateError.message : updateError,
          })
        })

      return {
        success: false,
        error: { message: errorMessage, code: 'PROCESSING_FAILED' },
      }
    }
  }

  /**
   * Extract content from document file
   */
  private static async extractContent(jobData: DocumentProcessingJobData) {
    const { documentId, fileName, mimeType, extractorConfig } = jobData
    try {
      // Get file content from MediaAsset
      if (!jobData.mediaAssetId) {
        throw new Error('MediaAsset ID not provided')
      }
      const mediaAssetService = new MediaAssetService(jobData.organizationId)
      const contentBuffer = await mediaAssetService.getContent(jobData.mediaAssetId)
      if (!contentBuffer) {
        throw new Error('Failed to retrieve file content from MediaAsset')
      }
      // Direct extraction - no temp files!
      // Extract extension with leading dot for extractor matching (e.g., ".md" not "md")
      const extension = fileName.split('.').pop()
      const normalizedExtension = extension ? `.${extension}` : ''

      const result = await ExtractorFactory.extractWithFallback(
        contentBuffer,
        mimeType,
        normalizedExtension,
        {
          fileName,
          documentId,
          organizationId: jobData.organizationId,
        },
        {
          preserveFormatting: extractorConfig?.preserveFormatting,
          extractImages: extractorConfig?.extractImages,
          fallbackEnabled: true,
        }
      )
      return {
        success: true,
        content: result.content,
        metadata: {
          ...result.metadata,
          extractorUsed: result.extractorUsed,
          fallbacksAttempted: result.fallbacksAttempted,
        },
        wordCount: result.wordCount,
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Content extraction failed'
      logger.error('Content extraction failed', {
        error: errorMessage,
        documentId,
        fileName,
        mimeType,
      })
      return {
        success: false,
        error: errorMessage,
      }
    }
  }
  /**
   * Preprocess/clean text content before chunking.
   * Whitespace normalization is controlled by preprocessing.normalizeWhitespace.
   * When false, preserves all whitespace including newlines and indentation.
   *
   * Used by: Chunker workflow node, processDocumentWithFlow
   *
   * @param content - Raw text content to preprocess
   * @param preprocessing - Preprocessing options (normalizeWhitespace, removeUrlsAndEmails)
   * @returns Cleaned content
   */
  public static preprocessContent(
    content: string,
    preprocessing?: ChunkPreprocessingOptions
  ): string {
    let cleaned = content
    const options = preprocessing ?? { normalizeWhitespace: true, removeUrlsAndEmails: false }

    // Remove URLs and email addresses if enabled
    if (options.removeUrlsAndEmails) {
      // Remove URLs (http, https, ftp, www)
      cleaned = cleaned.replace(/(?:https?:\/\/|ftp:\/\/|www\.)[^\s<>"']+/gi, '')
      // Remove email addresses
      cleaned = cleaned.replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, '')
    }

    // Normalize whitespace only if enabled
    if (options.normalizeWhitespace) {
      // Replace consecutive horizontal whitespace only (preserve newlines!)
      // [^\S\n]+ matches whitespace that is NOT a newline
      cleaned = cleaned.replace(/[^\S\n]+/g, ' ')
      // Replace excessive empty lines (more than 2 consecutive)
      cleaned = cleaned.replace(/\n{3,}/g, '\n\n')
      // Remove trailing whitespace from each line
      cleaned = cleaned
        .split('\n')
        .map((line) => line.trimEnd())
        .join('\n')
    }

    // Always trim the final content
    return cleaned.trim()
  }
  /**
   * Create document segments from content
   * @param chunkSettings - Pre-fetched chunk settings to avoid duplicate DB query
   */
  private static async createSegments(
    documentId: string,
    datasetId: string,
    content: string,
    _metadata: Record<string, any> = {},
    chunkingConfig?: DocumentProcessingJobData['chunkingConfig'],
    organizationId?: string,
    chunkSettings?: ChunkSettings
  ) {
    try {
      // Use provided settings or fetch from database (for backward compatibility)
      let settings = chunkSettings
      let actualOrganizationId = organizationId

      if (!settings || !actualOrganizationId) {
        const [dataset] = await db
          .select({
            chunkSettings: schema.Dataset.chunkSettings,
            organizationId: schema.Dataset.organizationId,
          })
          .from(schema.Dataset)
          .where(eq(schema.Dataset.id, datasetId))
          .limit(1)

        settings = settings || (dataset?.chunkSettings as ChunkSettings | undefined)
        actualOrganizationId = actualOrganizationId || dataset?.organizationId
      }

      if (!actualOrganizationId) {
        throw new Error('Organization ID not found for dataset')
      }
      // Default chunk settings
      const DEFAULT_CHUNK_SIZE = 1024
      const DEFAULT_OVERLAP = 80
      // Interpret escape sequences in delimiter (e.g., "\n\n" becomes actual newlines)
      const rawDelimiter = chunkingConfig?.delimiter || settings?.delimiter
      const delimiter = rawDelimiter ? interpretEscapeSequences(rawDelimiter) : undefined

      const chunks = await TextChunker.chunkText(content, {
        chunkSize: chunkingConfig?.chunkSize || settings?.size || DEFAULT_CHUNK_SIZE,
        chunkOverlap: chunkingConfig?.chunkOverlap || settings?.overlap || DEFAULT_OVERLAP,
        delimiter,
        preserveParagraphs: chunkingConfig?.preserveStructure ?? true,
        maxTokens: chunkingConfig?.maxChunkSize || 8000,
      })

      // Create document segments in database (batch insert)
      if (chunks.length === 0) {
        return []
      }

      const now = new Date()
      const segmentValues = chunks
        .filter((chunk): chunk is NonNullable<typeof chunk> => chunk != null)
        .map((chunk, i) => ({
          documentId,
          content: chunk.content,
          position: i,
          startOffset: chunk.startOffset,
          endOffset: chunk.endOffset,
          tokenCount: chunk.tokenCount,
          metadata: chunk.metadata || {},
          enabled: true,
          indexStatus: IndexStatus.PENDING,
          organizationId: actualOrganizationId,
          updatedAt: now,
        }))

      // Batch insert in chunks of 100 to avoid parameter limits and memory issues
      const BATCH_SIZE = 100
      const segments = []
      for (let i = 0; i < segmentValues.length; i += BATCH_SIZE) {
        const batch = segmentValues.slice(i, i + BATCH_SIZE)
        const inserted = await db.insert(schema.DocumentSegment).values(batch).returning()
        segments.push(...inserted)
      }

      logger.info('Document segments created', {
        documentId,
        segmentCount: segments.length,
        averageChunkSize: Math.round(
          chunks.reduce((sum: number, chunk: any) => sum + chunk.content.length, 0) / chunks.length
        ),
      })
      return segments
    } catch (error) {
      logger.error('Failed to create document segments', {
        error: error instanceof Error ? error.message : error,
        documentId,
        datasetId,
      })
      throw error
    }
  }
}
