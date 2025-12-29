// packages/lib/src/datasets/types/worker.types.ts

import type { ChunkingStrategy } from './index'

/**
 * Base job data interface for all dataset processing jobs
 */
interface BaseJobData {
  organizationId: string
  datasetId: string
  userId?: string
  metadata?: Record<string, any>
}

/**
 * Document processing job data
 * Handles extraction of text from various document formats
 */
export interface DocumentProcessingJobData extends BaseJobData {
  documentId: string
  mediaAssetId: string
  fileName: string
  fileSize: number
  mimeType: string
  documentType: string
  extractorConfig?: {
    preserveFormatting?: boolean
    extractImages?: boolean
    extractTables?: boolean
    language?: string
    encoding?: string
  }
  chunkingConfig?: {
    strategy?: ChunkingStrategy
    chunkSize?: number
    chunkOverlap?: number
    delimiter?: string
    preserveStructure?: boolean
    minChunkSize?: number
    maxChunkSize?: number
    preprocessing?: {
      normalizeWhitespace?: boolean
      removeUrlsAndEmails?: boolean
    }
  }
}

/**
 * Embedding generation job data
 * Handles generating vector embeddings for document segments
 */
export interface EmbeddingGenerationJobData extends BaseJobData {
  segmentIds: string[]
  batchSize?: number
  embeddingConfig?: {
    modelId?: string // "provider:model" format (e.g., "openai:text-embedding-3-small")
    dimensions?: number
    normalize?: boolean
  }
  retryConfig?: { maxRetries: number; retryDelay: number; exponentialBackoff?: boolean }

  /** Document ID (for flow-based progress tracking) */
  documentId?: string

  /** Batch index in the flow (0-based) */
  batchIndex?: number

  /** Total number of batches in the flow */
  totalBatches?: number

  /** Total segments across all batches */
  totalSegments?: number
}

/**
 * Batch operation job data
 * Handles bulk operations on datasets
 */
export interface BatchOperationJobData extends BaseJobData {
  operation: 'delete' | 'reindex' | 'update' | 'export'
  targetIds: string[]
  targetType: 'documents' | 'segments' | 'dataset'
  operationConfig?: Record<string, any>
  progressTracking?: {
    totalItems: number
    processedItems: number
    failedItems: number
    startedAt: Date
  }
}

/**
 * Worker job result interface
 */
export interface WorkerJobResult {
  success: boolean
  data?: Record<string, any>
  error?: { message: string; code?: string; details?: Record<string, any>; stack?: string }
  metrics?: { duration: number; memoryUsage?: number; itemsProcessed?: number; retryCount?: number }
  artifacts?: { type: string; path: string; size?: number; metadata?: Record<string, any> }[]
}
