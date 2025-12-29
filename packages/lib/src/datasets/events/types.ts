// packages/lib/src/datasets/events/types.ts

/**
 * Document processing event types
 * Follows same pattern as WorkflowEventType
 */
export const DocumentEventType = {
  // Connection events
  CONNECTED: 'connected',

  // Processing lifecycle
  PROCESSING_STARTED: 'processing_started',
  PROCESSING_COMPLETED: 'processing_completed',
  PROCESSING_FAILED: 'processing_failed',

  // Step events
  EXTRACTION_STARTED: 'extraction_started',
  EXTRACTION_COMPLETED: 'extraction_completed',
  CHUNKING_STARTED: 'chunking_started',
  CHUNKING_COMPLETED: 'chunking_completed',
  EMBEDDING_STARTED: 'embedding_started',
  EMBEDDING_PROGRESS: 'embedding_progress',
  EMBEDDING_COMPLETED: 'embedding_completed',

  // Generic
  ERROR: 'error',
} as const

export type DocumentEventType = (typeof DocumentEventType)[keyof typeof DocumentEventType]

/**
 * Base document event structure
 * Mirrors WorkflowEventGeneric
 */
export interface DocumentEvent<T = any> {
  event: DocumentEventType
  documentId: string
  datasetId: string
  timestamp: string
  data: T
}

/**
 * Extraction completed data
 */
export interface ExtractionCompletedData {
  contentLength: number
  wordCount: number
  extractorUsed: string
  processingTimeMs: number
}

/**
 * Chunking completed data
 */
export interface ChunkingCompletedData {
  segmentCount: number
  averageSegmentSize: number
  processingTimeMs: number
}

/**
 * Embedding progress data
 */
export interface EmbeddingProgressData {
  currentSegment: number
  totalSegments: number
  progress: number // 0-100
}

/**
 * Processing completed data
 */
export interface ProcessingCompletedData {
  segmentCount: number
  contentLength: number
  wordCount: number
  totalProcessingTimeMs: number
}

/**
 * Processing failed data
 */
export interface ProcessingFailedData {
  error: string
  step?: 'extraction' | 'chunking' | 'embedding'
  failedAt: string
}
