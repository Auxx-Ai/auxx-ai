import type { VectorDbType } from '@auxx/database/enums'
// packages/lib/src/datasets/types/vector.types.ts
/**
 * Vector search result with similarity score
 */
export interface VectorSearchResult {
  id: string
  content: string
  metadata: Record<string, any>
  score: number
}
/**
 * Options for vector database operations (low-level)
 */
export interface VectorDbSearchOptions {
  topK?: number
  scoreThreshold?: number
  filter?: Record<string, any>
  includeMetadata?: boolean
}
/**
 * Document to be stored in vector database
 */
export interface VectorDocument {
  id: string
  content: string
  embedding: number[]
  metadata?: Record<string, any>
}
/**
 * Configuration for vector database connection
 */
export interface VectorDatabaseConfig {
  type: VectorDbType
  connectionString?: string
  apiKey?: string
  endpoint?: string
  options?: Record<string, any>
}
/**
 * Collection statistics from vector database
 */
export interface CollectionStats {
  documentCount: number
  vectorCount: number
  indexType?: string
  lastUpdated?: Date
}
/**
 * Abstract base class for vector database implementations
 *
 * Provides a consistent interface across different vector databases
 * while allowing for database-specific optimizations
 */
export abstract class VectorDatabase {
  protected config: VectorDatabaseConfig
  protected collectionName: string
  constructor(config: VectorDatabaseConfig, collectionName: string) {
    this.config = config
    this.collectionName = collectionName
  }
  // Collection management operations
  /**
   * Create a new collection with specified vector dimensions
   */
  abstract createCollection(dimension?: number, options?: any): Promise<void>
  /**
   * Delete the collection and all its data
   */
  abstract deleteCollection(): Promise<void>
  /**
   * Check if the collection exists
   */
  abstract collectionExists(): Promise<boolean>
  // Document operations
  /**
   * Insert multiple documents into the collection
   */
  abstract insertDocuments(documents: VectorDocument[]): Promise<void>
  /**
   * Update an existing document in the collection
   */
  abstract updateDocument(id: string, document: Partial<VectorDocument>): Promise<void>
  /**
   * Delete documents by their IDs
   */
  abstract deleteDocuments(ids: string[]): Promise<void>
  // Search operations
  /**
   * Search for similar documents using a query vector
   */
  abstract searchByVector(
    queryVector: number[],
    options?: VectorDbSearchOptions
  ): Promise<VectorSearchResult[]>
  /**
   * Search for documents using text query (full-text search)
   */
  abstract searchByText(
    query: string,
    options?: VectorDbSearchOptions
  ): Promise<VectorSearchResult[]>
  // Utility methods
  /**
   * Get statistics about the collection
   */
  abstract getCollectionStats(): Promise<CollectionStats>
  /**
   * Perform a health check on the vector database
   */
  abstract healthCheck(): Promise<boolean>
  /**
   * Get the collection name being used
   */
  getCollectionName(): string {
    return this.collectionName
  }
  /**
   * Get the database configuration
   */
  getConfig(): VectorDatabaseConfig {
    return this.config
  }
}
/**
 * Error types for vector database operations
 */
export class VectorDatabaseError extends Error {
  constructor(
    message: string,
    public code: string = 'VECTOR_DB_ERROR'
  ) {
    super(message)
    this.name = 'VectorDatabaseError'
  }
}
export class VectorCollectionNotFoundError extends VectorDatabaseError {
  constructor(collectionName: string) {
    super(`Vector collection '${collectionName}' not found`, 'COLLECTION_NOT_FOUND')
    this.name = 'VectorCollectionNotFoundError'
  }
}
export class VectorDimensionMismatchError extends VectorDatabaseError {
  constructor(expected: number, received: number) {
    super(
      `Vector dimension mismatch: expected ${expected}, received ${received}`,
      'DIMENSION_MISMATCH'
    )
    this.name = 'VectorDimensionMismatchError'
  }
}
