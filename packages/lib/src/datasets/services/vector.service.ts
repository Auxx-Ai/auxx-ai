// packages/lib/src/datasets/services/vector.service.ts

import { database as db, schema } from '@auxx/database'
import { eq, and } from 'drizzle-orm'
import { VectorDatabaseFactory } from '../vector/factory'
import { PostgreSQLVectorDB } from '../vector/postgresql'
import type {
  VectorDatabaseConfig,
  VectorDocument,
  VectorSearchResult,
  CollectionStats,
} from '../types/vector.types'
import { createScopedLogger } from '@auxx/logger'
import { EmbeddingService } from './embedding-service'
import { SystemUserService } from '../../users/system-user-service'

const logger = createScopedLogger('vector-service')

/** Dataset configuration cache entry */
interface DatasetConfigCacheEntry {
  config: {
    id: string
    vectorDbType: string
    vectorDbConfig: Record<string, any>
    vectorDimension: number | null
    embeddingModel: string | null
  }
  expiry: number
}

/** In-memory dataset config cache with 1 minute TTL */
const datasetConfigCache = new Map<string, DatasetConfigCacheEntry>()
const CACHE_TTL = 60_000 // 1 minute

/**
 * High-level service for vector database operations
 *
 * Provides dataset-scoped vector search functionality and manages
 * the integration between document processing and vector storage
 */
export class VectorService {
  private static embeddingInstances = new Map<string, EmbeddingService>()

  /**
   * Get cached dataset configuration or fetch from DB
   * Caches for 1 minute to reduce repeated queries
   */
  private static async getDatasetConfigCached(
    datasetId: string,
    organizationId?: string
  ): Promise<DatasetConfigCacheEntry['config'] | null> {
    const cacheKey = datasetId
    const cached = datasetConfigCache.get(cacheKey)

    if (cached && cached.expiry > Date.now()) {
      return cached.config
    }

    // Fetch from database
    const whereConditions = [eq(schema.Dataset.id, datasetId)]
    if (organizationId) {
      whereConditions.push(eq(schema.Dataset.organizationId, organizationId))
    }

    const [dataset] = await db
      .select({
        id: schema.Dataset.id,
        vectorDbType: schema.Dataset.vectorDbType,
        vectorDbConfig: schema.Dataset.vectorDbConfig,
        vectorDimension: schema.Dataset.vectorDimension,
        embeddingModel: schema.Dataset.embeddingModel,
      })
      .from(schema.Dataset)
      .where(and(...whereConditions))
      .limit(1)

    if (!dataset) {
      return null
    }

    const config = {
      id: dataset.id,
      vectorDbType: dataset.vectorDbType,
      vectorDbConfig: (dataset.vectorDbConfig as Record<string, any>) || {},
      vectorDimension: dataset.vectorDimension,
      embeddingModel: dataset.embeddingModel,
    }

    // Cache the result
    datasetConfigCache.set(cacheKey, {
      config,
      expiry: Date.now() + CACHE_TTL,
    })

    return config
  }

  /**
   * Invalidate cached dataset configuration
   * Call this when dataset config is updated
   */
  static invalidateDatasetConfigCache(datasetId: string): void {
    datasetConfigCache.delete(datasetId)
  }

  /**
   * Get or create embedding service instance for organization
   */
  private static getEmbeddingService(organizationId: string, userId?: string): EmbeddingService {
    const key = `${organizationId}:${userId || 'system'}`
    if (!this.embeddingInstances.has(key)) {
      this.embeddingInstances.set(key, new EmbeddingService(db, organizationId, userId))
    }
    return this.embeddingInstances.get(key)!
  }

  /**
   * Initialize vector database for dataset
   */
  static async initializeDatasetVectorDB(
    datasetId: string,
    config?: Partial<VectorDatabaseConfig>,
    embeddingDimension: number = 1536
  ) {
    try {
      // Get dataset configuration
      const [dataset] = await db
        .select({
          id: schema.Dataset.id,
          name: schema.Dataset.name,
          vectorDbType: schema.Dataset.vectorDbType,
          vectorDbConfig: schema.Dataset.vectorDbConfig,
          vectorDimension: schema.Dataset.vectorDimension,
          organizationId: schema.Dataset.organizationId,
        })
        .from(schema.Dataset)
        .where(eq(schema.Dataset.id, datasetId))
        .limit(1)

      if (!dataset) {
        throw new Error(`Dataset ${datasetId} not found`)
      }

      // Use provided config or dataset defaults
      const existingConfig = (dataset.vectorDbConfig as Record<string, any>) || {}
      const vectorDbConfig: VectorDatabaseConfig = {
        type: dataset.vectorDbType,
        ...existingConfig,
        ...config,
      }

      const vectorDb = await VectorDatabaseFactory.create(datasetId, vectorDbConfig)
      const dimension = embeddingDimension || dataset.vectorDimension || 1536

      // Create collection if it doesn't exist
      if (!(await vectorDb.collectionExists())) {
        await vectorDb.createCollection(dimension)

        logger.info('Vector database collection created', {
          datasetId,
          collectionName: vectorDb.getCollectionName(),
          dimension,
        })
      }

      // Update dataset with collection info if needed
      if (!dataset.vectorDbConfig || Object.keys(dataset.vectorDbConfig).length === 0) {
        await db
          .update(schema.Dataset)
          .set({
            vectorDbType: vectorDbConfig.type,
            vectorDbConfig: vectorDbConfig,
            vectorDimension: dimension,
            updatedAt: new Date(),
          })
          .where(eq(schema.Dataset.id, datasetId))
      }

      logger.info('Vector database initialized for dataset', {
        datasetId,
        type: vectorDbConfig.type,
        dimension,
      })

      return vectorDb
    } catch (error) {
      logger.error('Failed to initialize vector database', {
        error: error instanceof Error ? error.message : error,
        datasetId,
      })
      throw error
    }
  }

  /**
   * Search across dataset using vector database
   * Uses cached dataset configuration for better performance
   */
  static async searchDataset(
    datasetId: string,
    query: string,
    organizationId: string,
    userId?: string,
    options: {
      searchType?: 'vector' | 'text' | 'hybrid'
      topK?: number
      scoreThreshold?: number
      includeMetadata?: boolean
    } = {}
  ): Promise<VectorSearchResult[]> {
    try {
      // Use cached dataset configuration
      const dataset = await this.getDatasetConfigCached(datasetId, organizationId)

      if (!dataset || !dataset.vectorDbType) {
        throw new Error('Dataset vector configuration not found or access denied')
      }

      const vectorDb = await VectorDatabaseFactory.create(datasetId, {
        type: dataset.vectorDbType as any,
        ...dataset.vectorDbConfig,
      })

      // Set dimension from dataset configuration
      if (vectorDb instanceof PostgreSQLVectorDB) {
        vectorDb.setDimension(dataset.vectorDimension || 1536)
      }

      const {
        searchType = 'vector',
        topK = 10,
        scoreThreshold = 0.0,
        includeMetadata = true,
      } = options

      let results: VectorSearchResult[] = []

      if (searchType === 'vector' || searchType === 'hybrid') {
        // Generate query embedding with matching dimensions
        const embeddingService = this.getEmbeddingService(organizationId, userId)
        const queryEmbedding = await embeddingService.generateSingle(query, {
          modelId: dataset.embeddingModel ?? undefined,
          dimensions: dataset.vectorDimension || undefined,
        })

        const vectorResults = await vectorDb.searchByVector(queryEmbedding, {
          topK,
          scoreThreshold,
          includeMetadata,
        })

        results = vectorResults
      }

      if (searchType === 'text') {
        results = await vectorDb.searchByText(query, { topK, includeMetadata })
      }

      if (searchType === 'hybrid') {
        // Combine vector and text search results
        const textResults = await vectorDb.searchByText(query, {
          topK: Math.ceil(topK / 2),
          includeMetadata,
        })

        results = this.combineSearchResults(results, textResults, {
          vectorWeight: 0.7,
          maxResults: topK,
        })
      }

      // Record search query for analytics (fire-and-forget, non-blocking)
      void this.recordSearchQuery(
        datasetId,
        organizationId,
        query,
        searchType,
        results.length,
        userId
      )

      logger.info('Dataset search completed', {
        datasetId,
        query: query.substring(0, 50),
        searchType,
        resultCount: results.length,
        dimension: dataset.vectorDimension,
        topK,
      })

      return results
    } catch (error) {
      logger.error('Dataset search failed', {
        error: error instanceof Error ? error.message : error,
        datasetId,
        query: query.substring(0, 50),
        organizationId,
      })
      throw error
    }
  }

  /**
   * Add documents to vector database
   */
  static async addDocumentsToVector(
    datasetId: string,
    segments: Array<{ id: string; content: string; metadata?: Record<string, any> }>,
    organizationId: string,
    userId?: string
  ): Promise<void> {
    if (segments.length === 0) return

    try {
      const [dataset] = await db
        .select({
          id: schema.Dataset.id,
          vectorDbType: schema.Dataset.vectorDbType,
          vectorDbConfig: schema.Dataset.vectorDbConfig,
          embeddingModel: schema.Dataset.embeddingModel,
          vectorDimension: schema.Dataset.vectorDimension,
        })
        .from(schema.Dataset)
        .where(
          and(eq(schema.Dataset.id, datasetId), eq(schema.Dataset.organizationId, organizationId))
        )
        .limit(1)

      if (!dataset || !dataset.vectorDbType) {
        throw new Error('Dataset vector configuration not found or access denied')
      }

      const vectorDbConfig = (dataset.vectorDbConfig as Record<string, any>) || {}
      const vectorDb = await VectorDatabaseFactory.create(datasetId, {
        type: dataset.vectorDbType,
        ...vectorDbConfig,
      })

      // Set dimension from dataset or detect from embeddings after generation
      const dimension = dataset.vectorDimension || 1536
      if (vectorDb instanceof PostgreSQLVectorDB) {
        vectorDb.setDimension(dimension)
      }

      logger.info('Starting batch embedding generation', {
        datasetId,
        segmentCount: segments.length,
        model: dataset.embeddingModel,
        dimension,
      })

      // Generate embeddings for all segments in batch with specified dimensions
      const embeddingService = this.getEmbeddingService(organizationId, userId)
      const embeddings = await embeddingService.generateBatch(
        segments.map((s) => s.content),
        {
          modelId: dataset.embeddingModel ?? undefined,
          dimensions: dimension,
        }
      )

      // Prepare vector documents
      const vectorDocuments: VectorDocument[] = segments.map((segment, index) => ({
        id: segment.id,
        content: segment.content,
        embedding: embeddings[index] || [],
        metadata: { ...segment.metadata, datasetId, addedAt: new Date().toISOString() },
      }))

      // Insert into vector database
      await vectorDb.insertDocuments(vectorDocuments)

      logger.info('Documents added to vector database', {
        datasetId,
        documentCount: segments.length,
        vectorDimensions: embeddings[0]?.length || 0,
      })
    } catch (error) {
      logger.error('Failed to add documents to vector database', {
        error: error instanceof Error ? error.message : error,
        datasetId,
        segmentCount: segments.length,
      })
      throw error
    }
  }

  /**
   * Update document in vector database
   */
  static async updateDocumentInVector(
    datasetId: string,
    segmentId: string,
    content: string,
    organizationId: string,
    metadata?: Record<string, any>,
    userId?: string
  ): Promise<void> {
    try {
      const [dataset] = await db
        .select({
          vectorDbType: schema.Dataset.vectorDbType,
          vectorDbConfig: schema.Dataset.vectorDbConfig,
          vectorDimension: schema.Dataset.vectorDimension,
          embeddingModel: schema.Dataset.embeddingModel,
        })
        .from(schema.Dataset)
        .where(
          and(eq(schema.Dataset.id, datasetId), eq(schema.Dataset.organizationId, organizationId))
        )
        .limit(1)

      if (!dataset || !dataset.vectorDbType) {
        throw new Error('Dataset vector configuration not found')
      }

      const vectorDbConfig = (dataset.vectorDbConfig as Record<string, any>) || {}
      const vectorDb = await VectorDatabaseFactory.create(datasetId, {
        type: dataset.vectorDbType,
        ...vectorDbConfig,
      })

      // Set dimension from dataset configuration
      const dimension = dataset.vectorDimension || 1536
      if (vectorDb instanceof PostgreSQLVectorDB) {
        vectorDb.setDimension(dimension)
      }

      // Generate new embedding with matching dimensions
      const embeddingService = this.getEmbeddingService(organizationId, userId)
      const embedding = await embeddingService.generateSingle(content, {
        modelId: dataset.embeddingModel ?? undefined,
        dimensions: dimension,
      })

      // Update in vector database
      await vectorDb.updateDocument(segmentId, {
        content,
        embedding,
        metadata: { ...metadata, updatedAt: new Date().toISOString() },
      })

      logger.info('Document updated in vector database', { datasetId, segmentId, dimension })
    } catch (error) {
      logger.error('Failed to update document in vector database', {
        error: error instanceof Error ? error.message : error,
        datasetId,
        segmentId,
      })
      throw error
    }
  }

  /**
   * Remove documents from vector database
   */
  static async removeDocumentsFromVector(
    datasetId: string,
    segmentIds: string[],
    organizationId: string
  ): Promise<void> {
    if (segmentIds.length === 0) return

    try {
      const [dataset] = await db
        .select({
          vectorDbType: schema.Dataset.vectorDbType,
          vectorDbConfig: schema.Dataset.vectorDbConfig,
        })
        .from(schema.Dataset)
        .where(
          and(eq(schema.Dataset.id, datasetId), eq(schema.Dataset.organizationId, organizationId))
        )
        .limit(1)

      if (!dataset || !dataset.vectorDbType) {
        throw new Error('Dataset vector configuration not found')
      }

      const vectorDbConfig = (dataset.vectorDbConfig as Record<string, any>) || {}
      const vectorDb = await VectorDatabaseFactory.create(datasetId, {
        type: dataset.vectorDbType,
        ...vectorDbConfig,
      })

      await vectorDb.deleteDocuments(segmentIds)

      logger.info('Documents removed from vector database', {
        datasetId,
        documentCount: segmentIds.length,
      })
    } catch (error) {
      logger.error('Failed to remove documents from vector database', {
        error: error instanceof Error ? error.message : error,
        datasetId,
        documentCount: segmentIds.length,
      })
      throw error
    }
  }

  /**
   * Get vector database health status for dataset
   */
  static async getVectorDBHealth(datasetId: string, organizationId?: string) {
    try {
      const whereConditions = [eq(schema.Dataset.id, datasetId)]
      if (organizationId) {
        whereConditions.push(eq(schema.Dataset.organizationId, organizationId))
      }

      const [dataset] = await db
        .select({
          vectorDbType: schema.Dataset.vectorDbType,
          vectorDbConfig: schema.Dataset.vectorDbConfig,
          name: schema.Dataset.name,
        })
        .from(schema.Dataset)
        .where(and(...whereConditions))
        .limit(1)

      if (!dataset || !dataset.vectorDbType) {
        return {
          healthy: false,
          error: 'No vector database configured',
          datasetName: dataset?.name,
        }
      }

      const vectorDbConfig = (dataset.vectorDbConfig as Record<string, any>) || {}
      const vectorDb = await VectorDatabaseFactory.create(datasetId, {
        type: dataset.vectorDbType,
        ...vectorDbConfig,
      })

      const [healthy, stats] = await Promise.all([
        vectorDb.healthCheck(),
        vectorDb.getCollectionStats(),
      ])

      return { healthy, type: dataset.vectorDbType, stats, datasetName: dataset.name }
    } catch (error) {
      logger.error('Vector database health check failed', {
        error: error instanceof Error ? error.message : error,
        datasetId,
      })
      return { healthy: false, error: error instanceof Error ? error.message : 'Unknown error' }
    }
  }

  /**
   * Get collection statistics
   */
  static async getCollectionStats(
    datasetId: string,
    organizationId: string
  ): Promise<CollectionStats> {
    try {
      const [dataset] = await db
        .select({
          vectorDbType: schema.Dataset.vectorDbType,
          vectorDbConfig: schema.Dataset.vectorDbConfig,
          vectorDimension: schema.Dataset.vectorDimension,
        })
        .from(schema.Dataset)
        .where(
          and(eq(schema.Dataset.id, datasetId), eq(schema.Dataset.organizationId, organizationId))
        )
        .limit(1)

      if (!dataset || !dataset.vectorDbType) {
        throw new Error('Dataset vector configuration not found')
      }

      const vectorDbConfig = (dataset.vectorDbConfig as Record<string, any>) || {}
      const vectorDb = await VectorDatabaseFactory.create(datasetId, {
        type: dataset.vectorDbType,
        ...vectorDbConfig,
      })

      // Set dimension from dataset configuration
      if (vectorDb instanceof PostgreSQLVectorDB) {
        vectorDb.setDimension(dataset.vectorDimension || 1536)
      }

      return await vectorDb.getCollectionStats()
    } catch (error) {
      logger.error('Failed to get collection stats', {
        error: error instanceof Error ? error.message : error,
        datasetId,
      })
      throw error
    }
  }

  // Private helper methods

  /**
   * Combine vector and text search results using weighted scoring
   */
  private static combineSearchResults(
    vectorResults: VectorSearchResult[],
    textResults: VectorSearchResult[],
    options: { vectorWeight: number; maxResults: number }
  ): VectorSearchResult[] {
    const { vectorWeight, maxResults } = options
    const textWeight = 1 - vectorWeight
    const resultMap = new Map<string, VectorSearchResult>()

    // Add vector results with weighted scores
    vectorResults.forEach((result, index) => {
      const normalizedScore = (vectorResults.length - index) / vectorResults.length
      resultMap.set(result.id, {
        ...result,
        score: normalizedScore * vectorWeight,
        metadata: { ...result.metadata, searchMethod: 'vector' },
      })
    })

    // Merge text results with weighted scores
    textResults.forEach((result, index) => {
      const normalizedScore = (textResults.length - index) / textResults.length
      const existing = resultMap.get(result.id)

      if (existing) {
        // Combine scores for documents found in both searches
        resultMap.set(result.id, {
          ...existing,
          score: existing.score + normalizedScore * textWeight,
          metadata: { ...existing.metadata, searchMethod: 'hybrid' },
        })
      } else {
        // Add text-only result
        resultMap.set(result.id, {
          ...result,
          score: normalizedScore * textWeight,
          metadata: { ...result.metadata, searchMethod: 'text' },
        })
      }
    })

    // Sort by combined score and limit results
    return Array.from(resultMap.values())
      .sort((a, b) => b.score - a.score)
      .slice(0, maxResults)
  }

  /**
   * Record search query for analytics
   */
  private static async recordSearchQuery(
    datasetId: string,
    organizationId: string,
    query: string,
    searchType: string,
    resultsCount: number,
    userId?: string
  ): Promise<void> {
    try {
      // Get system user if no userId provided
      const finalUserId =
        userId || (await SystemUserService.getSystemUserForActions(organizationId))

      await db.insert(schema.DatasetSearchQuery).values({
        query,
        queryType: searchType,
        resultsCount,
        responseTime: 0, // Will be calculated by caller if needed
        datasetId,
        organizationId,
        userId: finalUserId,
      })
    } catch (error) {
      // Log but don't fail the search for analytics issues
      logger.warn('Failed to record search query', {
        error: error instanceof Error ? error.message : error,
        datasetId,
        query: query.substring(0, 50),
      })
    }
  }
}
