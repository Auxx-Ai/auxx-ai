// packages/lib/src/datasets/index.ts

// Export all types explicitly
export type {
  // Core drizzle types
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

  // Input/Output types
  CreateDatasetInput,
  UpdateDatasetInput,
  UploadDocumentInput,
  DocumentProcessingResult,
  DocumentChunk,
  SearchQueryInput,
  SearchResultItem,
  SearchResponse,
  DatasetStats,
  DocumentProcessingStatus,
  BatchProcessingRequest,

  // Configuration types
  ExternalSourceConfig,
  VectorDbConfig,
  DocumentExtractorConfig,
  ChunkingOptions,
  ChunkingConfig,
  EmbeddingConfig,

  // Relations types
  DatasetWithRelations,
  DocumentWithRelations,
  DatasetListResponse,
  DocumentListResponse,

  // Utility types
  PaginationParams,
  DatasetFilters,
  DocumentFilters,

  // Worker job types - these are re-exported from worker.types
  // DocumentProcessingJobData,
  // EmbeddingGenerationJobData,
  // BatchOperationJobData,
  // WorkerJobResult,

  // Extractor types
  ExtractorMetadata,
  ExtractionResult,
  ExtractionOptions,
  ExtractorCapabilities,
  ExtractorInfo,

  // Vector database types
  VectorSearchResult,
  VectorDbSearchOptions,
  VectorDocument,
  VectorDatabaseConfig,
  CollectionStats,

  // Embedding types
  EmbeddingOptions,
  EmbeddingResult,
  BatchEmbeddingResult,
  EmbeddingError,
  EmbeddingUsageMetrics,
  EmbeddingProviderConfig,
  CachedEmbedding,

  // Search types
  SearchQuery,
  SearchResult,
  SearchResponse as SearchServiceResponse,
  SearchFilters,
  SearchPerformanceMetrics,
  VectorSearchOptions as VectorSearchServiceOptions,
  FullTextSearchOptions,
  HybridSearchOptions,
} from './types'

// Export services
export { DatasetService } from './services/dataset-service'
export { DocumentService } from './services/document-service'
export { SegmentService } from './services/segment-service'
export { VectorService } from './services/vector.service'
export { EmbeddingService } from './services/embedding-service'
export { SearchService } from './services/search.service'

// Export search services
export { VectorSearchService } from './search/vector-search'
export { FullTextSearchService } from './search/full-text-search'
export { HybridSearchService } from './search/hybrid-search'

// Export extractors
export { BaseExtractor } from './extractors/base-extractor'
export { ExtractorRegistry } from './extractors/extractor-registry'
export { ExtractorFactory } from './extractors/extractor-factory'
export { TextExtractor } from './extractors/text-extractor'
export { PdfExtractor } from './extractors/pdf-extractor'
export { DocxExtractor } from './extractors/docx-extractor'
export { HtmlExtractor } from './extractors/html-extractor'

// Export processors
export { TextChunker } from './processors/text-chunker'

// Export error classes
export { DatasetError, DocumentProcessingError, EmbeddingGenerationError } from './types'
export type { VectorSearchError } from './types'
export { EmbeddingServiceError } from './types/embedding.types'

// Export vector database classes
export { VectorDatabase } from './types'
export { VectorDatabaseFactory, PostgreSQLVectorDB } from './vector'

// Export worker services
export { DocumentProcessingQueue } from './workers/document-processing-queue'
export { DocumentProcessor } from './workers/document-processor'
export { EmbeddingProcessor } from './workers/embedding-processor'

// Export worker types and constants
export type {
  DocumentProcessingJobData,
  EmbeddingGenerationJobData,
  BatchOperationJobData,
  WorkerJobResult,
} from './types/worker.types'

// Export embedding column utilities
export {
  EMBEDDING_DIMENSIONS,
  type EmbeddingDimension,
  getEmbeddingColumnName,
  normalizeToSupportedDimension,
  isSupportedDimension,
  getModelDefaultDimensionFromDefinition,
  getModelDimensionOptions,
  getModelDimensionHelp,
} from './utils'

// Export document event types and reporters
export {
  DocumentEventType,
  RedisDocumentExecutionReporter,
  NullDocumentExecutionReporter,
  type DocumentExecutionReporter,
  type DocumentEvent,
  type ExtractionCompletedData,
  type ChunkingCompletedData,
  type EmbeddingProgressData,
  type ProcessingCompletedData,
  type ProcessingFailedData,
} from './events'
