// packages/lib/src/datasets/index.ts

// Export document event types and reporters
export {
  type ChunkingCompletedData,
  type DocumentEvent,
  DocumentEventType,
  type DocumentExecutionReporter,
  type EmbeddingProgressData,
  type ExtractionCompletedData,
  NullDocumentExecutionReporter,
  type ProcessingCompletedData,
  type ProcessingFailedData,
  RedisDocumentExecutionReporter,
} from './events'
// Export extractors
export { BaseExtractor } from './extractors/base-extractor'
export { DocxExtractor } from './extractors/docx-extractor'
export { ExtractorFactory } from './extractors/extractor-factory'
export { ExtractorRegistry } from './extractors/extractor-registry'
export { HtmlExtractor } from './extractors/html-extractor'
export { PdfExtractor } from './extractors/pdf-extractor'
export { TextExtractor } from './extractors/text-extractor'
// Export processors
export { TextChunker } from './processors/text-chunker'
export { FullTextSearchService } from './search/full-text-search'
export { HybridSearchService } from './search/hybrid-search'
// Export search services
export { VectorSearchService } from './search/vector-search'
// Export services
export { DatasetService } from './services/dataset-service'
export { DocumentService } from './services/document-service'
export { EmbeddingService } from './services/embedding-service'
export { SearchService } from './services/search.service'
export { SegmentService } from './services/segment-service'
export { VectorService } from './services/vector.service'
// Export all types explicitly
export type {
  BatchEmbeddingResult,
  BatchProcessingRequest,
  CachedEmbedding,
  ChunkingConfig,
  ChunkingOptions,
  ChunkingStrategy,
  CollectionStats,
  // Input/Output types
  CreateDatasetInput,
  // Core drizzle types
  Dataset,
  DatasetFilters,
  DatasetListResponse,
  DatasetSearchQuery,
  DatasetSearchResult,
  DatasetStats,
  DatasetStatus,
  // Relations types
  DatasetWithRelations,
  Document,
  DocumentChunk,
  DocumentExtractorConfig,
  DocumentFilters,
  DocumentListResponse,
  DocumentProcessingResult,
  DocumentProcessingStatus,
  DocumentSegment,
  DocumentStatus,
  DocumentType,
  DocumentWithRelations,
  EmbeddingConfig,
  EmbeddingError,
  // Embedding types
  EmbeddingOptions,
  EmbeddingProviderConfig,
  EmbeddingResult,
  EmbeddingUsageMetrics,
  ExternalKnowledgeSource,
  // Configuration types
  ExternalSourceConfig,
  ExtractionOptions,
  ExtractionResult,
  ExtractorCapabilities,
  ExtractorInfo,
  // Worker job types - these are re-exported from worker.types
  // DocumentProcessingJobData,
  // EmbeddingGenerationJobData,
  // BatchOperationJobData,
  // WorkerJobResult,

  // Extractor types
  ExtractorMetadata,
  FullTextSearchOptions,
  HybridSearchOptions,
  // Utility types
  PaginationParams,
  SearchFilters,
  SearchPerformanceMetrics,
  // Search types
  SearchQuery,
  SearchQueryInput,
  SearchResponse,
  SearchResponse as SearchServiceResponse,
  SearchResult,
  SearchResultItem,
  UpdateDatasetInput,
  UploadDocumentInput,
  VectorDatabaseConfig,
  VectorDbConfig,
  VectorDbSearchOptions,
  VectorDocument,
  VectorSearchError,
  VectorSearchOptions as VectorSearchServiceOptions,
  // Vector database types
  VectorSearchResult,
} from './types'
// Export error classes
// Export vector database classes
export {
  DatasetError,
  DocumentProcessingError,
  EmbeddingGenerationError,
  VectorDatabase,
} from './types'
export { EmbeddingServiceError } from './types/embedding.types'
// Export worker types and constants
export type {
  BatchOperationJobData,
  DocumentProcessingJobData,
  EmbeddingGenerationJobData,
  WorkerJobResult,
} from './types/worker.types'
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
} from './utils'
export { PostgreSQLVectorDB, VectorDatabaseFactory } from './vector'
// Export worker services
export { DocumentProcessingQueue } from './workers/document-processing-queue'
export { DocumentProcessor } from './workers/document-processor'
export { EmbeddingProcessor } from './workers/embedding-processor'
