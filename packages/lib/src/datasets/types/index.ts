import type {
  ChunkingStrategy,
  ChunkSettings,
  DatasetEntity as Dataset,
  DatasetSearchQueryEntity as DatasetSearchQuery,
  DatasetSearchResultEntity as DatasetSearchResult,
  DatasetStatus,
  DocumentEntity as Document,
  DocumentSegmentEntity as DocumentSegment,
  DocumentStatus,
  DocumentType,
  ExternalKnowledgeSourceEntity as ExternalKnowledgeSource,
  VectorDbType,
} from '@auxx/database/types'
// packages/lib/src/datasets/types/index.ts
/**
 * Core dataset management types
 */
export type {
  Dataset,
  Document,
  DocumentSegment,
  DatasetSearchQuery,
  DatasetSearchResult,
  ExternalKnowledgeSource,
  DatasetStatus,
  DocumentStatus,
  DocumentType,
  ChunkingStrategy,
  VectorDbType,
  ChunkSettings,
}
/**
 * Dataset creation input
 */
export interface CreateDatasetInput {
  name: string
  description?: string
  chunkSettings?: Partial<ChunkSettings>
  vectorDbType?: VectorDbType
  vectorDbConfig?: Record<string, any>
  embeddingModel?: string // "provider:model" format
  vectorDimension?: number
  /** Hidden from /app/datasets — managed by an internal pipeline (e.g. KB sync). */
  isManaged?: boolean
}
/**
 * Dataset update input
 */
export interface UpdateDatasetInput {
  name?: string
  description?: string
  status?: DatasetStatus
  chunkSettings?: Partial<ChunkSettings>
  vectorDbConfig?: Record<string, any>
  embeddingModel?: string // "provider:model" format (e.g., "openai:text-embedding-3-large")
  vectorDimension?: number
}
/**
 * Document upload input
 */
export interface UploadDocumentInput {
  datasetId: string
  title: string
  filename: string
  mimeType: string
  type: DocumentType
  size: number
  content?: string
  fileId?: string
  originalPath?: string
}
/**
 * Document creation from file upload input
 */
export interface CreateDocumentFromFileInput {
  title: string
  filename: string
  mimeType: string
  size: number
  datasetId: string
  uploadedById?: string
  mediaAssetId: string
  checksum: string // Required for deduplication
  originalPath?: string
  processingOptions?: DocumentProcessingOptions
  /** Optional document-specific chunk settings (overrides dataset defaults when set) */
  chunkSettings?: Partial<ChunkSettings>
}
/**
 * Document processing options
 */
export interface DocumentProcessingOptions {
  chunkSettings?: Partial<ChunkSettings>
  embeddingModel?: string // "provider:model" format (e.g., "openai:text-embedding-3-small")
  skipParsing?: boolean
  skipEmbedding?: boolean
}
/**
 * Standardized document metadata structure
 */
export interface DocumentMetadata {
  processingOptions: DocumentProcessingOptions
  uploadInfo: {
    originalFilename: string
    uploadedAt: string
    fileSize: number
    mimeType: string
    uploader?: {
      id: string
      name?: string
    }
  }
  extractionInfo?: {
    extractedAt?: string
    contentLength?: number
    pageCount?: number
    language?: string
  }
}
/**
 * Document processing result
 */
export interface DocumentProcessingResult {
  documentId: string
  success: boolean
  totalChunks: number
  processingTime: number
  errorMessage?: string
}
/**
 * Document chunk/segment
 */
export interface DocumentChunk {
  content: string
  position: number
  startOffset: number
  endOffset: number
  tokenCount: number
  metadata?: Record<string, any>
}
/**
 * Search query input
 */
export interface SearchQueryInput {
  query: string
  datasetIds?: string[]
  queryType?: 'vector' | 'text' | 'hybrid'
  vectorSimilarityThreshold?: number
  maxResults?: number
  filters?: Record<string, any>
}
/**
 * Search result item
 */
export interface SearchResultItem {
  segmentId: string
  documentId: string
  content: string
  score: number
  rank: number
  document: {
    id: string
    title: string
    filename: string
    type: DocumentType
    datasetId: string
  }
  metadata?: Record<string, any>
}
/**
 * Search response
 */
export interface SearchResponse {
  query: string
  results: SearchResultItem[]
  totalResults: number
  responseTime: number
  queryType: string
}
/**
 * Dataset statistics
 */
export interface DatasetStats {
  id: string
  name: string
  documentCount: number
  totalSize: number
  lastIndexedAt: Date | null
  status: DatasetStatus
  avgProcessingTime?: number
  totalSearches?: number
  avgSearchTime?: number
}
/**
 * Document processing status
 */
export interface DocumentProcessingStatus {
  documentId: string
  status: DocumentStatus
  progress: number // 0-100
  currentStep: string
  errorMessage?: string
  processingTime?: number
  totalChunks?: number
}
/**
 * Batch processing request
 */
export interface BatchProcessingRequest {
  documentIds: string[]
  operation: 'reprocess' | 'delete' | 'archive' | 'enable' | 'disable'
  options?: Record<string, any>
}
/**
 * External knowledge source configuration
 */
export interface ExternalSourceConfig {
  sourceType: 'web_scraper' | 'api' | 'rss' | 'database'
  endpoint?: string
  configuration: Record<string, any>
  syncEnabled: boolean
  syncInterval?: number
}
/**
 * Vector database configuration
 */
export interface VectorDbConfig {
  type: 'POSTGRESQL' | 'CHROMA' | 'QDRANT' | 'WEAVIATE' | 'PINECONE' | 'MILVUS'
  connectionString?: string
  apiKey?: string
  endpoint?: string
  collectionName?: string
  dimensions?: number
  similarityMetric?: 'cosine' | 'euclidean' | 'dot_product'
  indexConfig?: Record<string, any>
}
/**
 * Document extractor configuration
 */
export interface DocumentExtractorConfig {
  type: DocumentType
  options: Record<string, any>
}
/**
 * Text chunking options for processing
 */
export interface ChunkingOptions {
  chunkSize: number
  chunkOverlap: number
  delimiter?: string
  preserveParagraphs?: boolean
  maxTokens?: number
}
/**
 * Text chunking configuration
 */
export interface ChunkingConfig {
  strategy: ChunkingStrategy
  chunkSize: number
  chunkOverlap: number
  preserveFormatting?: boolean
  respectSentences?: boolean
  minChunkSize?: number
  maxChunkSize?: number
}
/**
 * Embedding generation configuration
 */
export interface EmbeddingConfig {
  model: string
  dimensions: number
  batchSize?: number
  maxTokensPerChunk?: number
  normalize?: boolean
}
/**
 * Dataset with relations
 */
export interface DatasetWithRelations extends Dataset {
  organization: {
    id: string
    name: string | null
  }
  createdBy: {
    id: string
    name: string | null
    email: string | null
  }
  documents: Document[]
  _count?: {
    documents: number
    searchQueries: number
  }
}
/**
 * Document with relations
 */
export interface DocumentWithRelations extends Document {
  dataset: {
    id: string
    name: string
  }
  uploadedBy: {
    id: string
    name: string | null
    email: string | null
  }
  mediaAsset: {
    id: string
    name: string | null
    mimeType: string | null
    size: bigint | null
  } | null
  segments: DocumentSegment[]
  _count?: {
    segments: number
  }
}
/**
 * API response types
 */
export interface DatasetListResponse {
  datasets: DatasetWithRelations[]
  totalCount: number
  hasMore: boolean
}
export interface DocumentListResponse {
  documents: DocumentWithRelations[]
  totalCount: number
  hasMore: boolean
}
/**
 * Pagination parameters
 */
export interface PaginationParams {
  page?: number
  limit?: number
  sortBy?: string
  sortOrder?: 'asc' | 'desc'
}
/**
 * Filter parameters for listing datasets
 */
export interface DatasetFilters {
  status?: DatasetStatus
  search?: string
  createdById?: string
  dateRange?: {
    start: Date
    end: Date
  }
  /** When true (default in UI), excludes managed datasets (e.g. KB-backed). */
  hideManaged?: boolean
}
/**
 * Filter parameters for listing documents
 */
export interface DocumentFilters {
  datasetId?: string
  status?: DocumentStatus
  type?: DocumentType
  search?: string
  uploadedById?: string
  dateRange?: {
    start: Date
    end: Date
  }
}
/**
 * Worker job types for dataset processing
 */
export interface ProcessDocumentJob {
  documentId: string
  organizationId: string
}
export interface GenerateEmbeddingsJob {
  documentId: string
  organizationId: string
  segments: {
    segmentId: string
    content: string
  }[]
}
export interface IndexDocumentJob {
  documentId: string
  organizationId: string
  vectorDbConfig: VectorDbConfig
}
export interface SyncExternalSourceJob {
  sourceId: string
  organizationId: string
}
/**
 * Error types
 */
export class DatasetError extends Error {
  constructor(
    message: string,
    public code: string,
    public details?: Record<string, any>
  ) {
    super(message)
    this.name = 'DatasetError'
  }
}
export type * from './embedding.types'
// Re-export extractor types
export type * from './extractor.types'
export type * from './search.types'
// Export search error classes separately since they're not types
export {
  FullTextSearchError,
  InvalidQueryError,
  SearchError,
  SearchTimeoutError,
} from './search.types'
export type * from './vector.types'
// Export vector classes separately since they're not types
export { VectorDatabase } from './vector.types'
export class DocumentProcessingError extends DatasetError {
  constructor(message: string, details?: Record<string, any>) {
    super(message, 'DOCUMENT_PROCESSING_ERROR', details)
  }
}
export class EmbeddingGenerationError extends DatasetError {
  constructor(message: string, details?: Record<string, any>) {
    super(message, 'EMBEDDING_GENERATION_ERROR', details)
  }
}

// Export embedding column utilities
export {
  EMBEDDING_DIMENSIONS,
  type EmbeddingDimension,
  getEmbeddingColumnName,
  getModelDefaultDimensionFromDefinition,
  getModelDimensionHelp,
  getModelDimensionOptions,
  isSupportedDimension,
  normalizeToSupportedDimension,
} from '../utils/embedding-columns'

// Export worker types
export type {
  BatchOperationJobData,
  DocumentProcessingJobData,
  EmbeddingGenerationJobData,
  WorkerJobResult,
} from './worker.types'
