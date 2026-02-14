// packages/lib/src/datasets/types/search.types.ts

import type {
  DocumentEntity as Document,
  DocumentSegmentEntity as DocumentSegment,
} from '@auxx/database/types'

/**
 * Search query input with filtering and options
 */
export interface SearchQuery {
  query: string
  datasetIds?: string[]
  limit?: number
  offset?: number
  filters?: SearchFilters
  searchType?: SearchType
  rerank?: boolean
  similarityThreshold?: number
  maxResults?: number
  includeMetadata?: boolean
  includeInactive?: boolean
  /** Whether to include highlighted snippets in results (default false for performance) */
  includeHighlights?: boolean
}

/**
 * Search filters for refining results
 */
export interface SearchFilters {
  documentTypes?: string[]
  mimeTypes?: string[]
  dateRange?: {
    from: Date
    to: Date
  }
  authors?: string[]
  fileSize?: {
    min?: number
    max?: number
  }
  metadata?: Record<string, any>
  documentStatus?: string[]
  enabled?: boolean
}

/**
 * Search type options
 */
export type SearchType = 'vector' | 'text' | 'hybrid'

/**
 * Individual search result item
 */
export interface SearchResult {
  segment: DocumentSegment & {
    document: Document & {
      dataset: {
        id: string
        name: string
      }
    }
  }
  score: number
  rank: number
  highlights?: string[]
  distance?: number
  relevanceScore?: number
  searchType: SearchType
}

/**
 * Complete search response
 */
export interface SearchResponse {
  results: SearchResult[]
  total: number
  query: string
  searchType: SearchType
  responseTime: number
  aggregations?: SearchAggregations
  suggestions?: string[]
  hasMore?: boolean
  nextOffset?: number
}

/**
 * Search aggregations for analytics
 */
export interface SearchAggregations {
  documentTypes: Array<{
    type: string
    count: number
  }>
  datasets: Array<{
    id: string
    name: string
    count: number
  }>
  dateRanges: Array<{
    range: string
    count: number
  }>
}

/**
 * Vector search specific options
 */
export interface VectorSearchOptions {
  similarityThreshold?: number
  maxResults?: number
  includeMetadata?: boolean
  rerank?: boolean
  embeddingModel?: string
  searchMode?: 'similarity' | 'mmr' | 'similarity_score_threshold'
  scoreCutoff?: number
}

/**
 * Full-text search specific options
 */
export interface FullTextSearchOptions {
  fuzzySearch?: boolean
  phraseSearch?: boolean
  booleanMode?: boolean
  rankingMode?: 'bm25' | 'tfidf'
  minScore?: number
  includeInactive?: boolean
}

/**
 * Hybrid search configuration
 */
export interface HybridSearchOptions {
  vectorWeight?: number // 0.0 - 1.0
  textWeight?: number // 0.0 - 1.0
  rerankingModel?: string
  combineMethod?: 'rrf' | 'weighted_sum' | 'linear_combination'
  vectorOptions?: VectorSearchOptions
  textOptions?: FullTextSearchOptions
}

/**
 * Search suggestion options
 */
export interface SearchSuggestionOptions {
  query: string
  datasetIds?: string[]
  limit?: number
  includeHistory?: boolean
  includePopular?: boolean
}

/**
 * Search suggestion response
 */
export interface SearchSuggestion {
  suggestion: string
  type: 'completion' | 'history' | 'popular'
  score?: number
  metadata?: Record<string, any>
}

/**
 * Search history entry
 */
export interface SearchHistoryEntry {
  id: string
  query: string
  searchType: SearchType
  resultCount: number
  responseTime: number
  filters?: SearchFilters
  createdAt: Date
  userId: string
  organizationId: string
}

/**
 * Search analytics data
 */
export interface SearchAnalytics {
  totalQueries: number
  averageResponseTime: number
  popularQueries: Array<{
    query: string
    count: number
    averageResults: number
  }>
  searchTypeDistribution: Array<{
    type: SearchType
    count: number
    percentage: number
  }>
  datasetUsage: Array<{
    datasetId: string
    datasetName: string
    queryCount: number
  }>
  timeRangeAnalytics: Array<{
    date: string
    queryCount: number
    averageResponseTime: number
  }>
}

/**
 * Dataset configuration for multi-dataset search operations
 * Fetched once and passed down to avoid redundant queries
 */
export interface DatasetConfig {
  id: string
  vectorDimension: number
  embeddingModel: string | null
}

/**
 * Search configuration for datasets
 */
export interface DatasetSearchConfig {
  enabled: boolean
  searchType: SearchType
  vectorSearchOptions?: VectorSearchOptions
  textSearchOptions?: FullTextSearchOptions
  hybridSearchOptions?: HybridSearchOptions
  customRankingRules?: SearchRankingRule[]
}

/**
 * Custom ranking rule for search results
 */
export interface SearchRankingRule {
  field: string
  weight: number
  direction: 'asc' | 'desc'
  type: 'boost' | 'filter' | 'sort'
}

/**
 * Search result export options
 */
export interface SearchExportOptions {
  format: 'json' | 'csv' | 'xlsx'
  includeContent?: boolean
  includeMetadata?: boolean
  maxResults?: number
}

/**
 * Search performance metrics
 */
export interface SearchPerformanceMetrics {
  queryTime: number
  vectorSearchTime?: number
  textSearchTime?: number
  rerankTime?: number
  totalTime: number
  resultsCount: number
  cacheHit: boolean
}

/**
 * Error types for search operations
 */
export class SearchError extends Error {
  constructor(
    message: string,
    public code: string = 'SEARCH_ERROR',
    public details?: Record<string, any>
  ) {
    super(message)
    this.name = 'SearchError'
  }
}

export class VectorSearchError extends SearchError {
  constructor(message: string, details?: Record<string, any>) {
    super(message, 'VECTOR_SEARCH_ERROR', details)
  }
}

export class FullTextSearchError extends SearchError {
  constructor(message: string, details?: Record<string, any>) {
    super(message, 'FULLTEXT_SEARCH_ERROR', details)
  }
}

export class SearchTimeoutError extends SearchError {
  constructor(message: string, details?: Record<string, any>) {
    super(message, 'SEARCH_TIMEOUT', details)
  }
}

export class InvalidQueryError extends SearchError {
  constructor(message: string, details?: Record<string, any>) {
    super(message, 'INVALID_QUERY', details)
  }
}
