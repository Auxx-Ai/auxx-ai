// packages/lib/src/datasets/search/vector-search.ts

import { database as db, schema } from '@auxx/database'
import { eq, inArray } from 'drizzle-orm'
import { createScopedLogger } from '@auxx/logger'
import { VectorService } from '../services/vector.service'
import { PostgreSQLVectorDB } from '../vector/postgresql'
import { EmbeddingService } from '../services/embedding-service'
import type {
  SearchQuery,
  SearchResult,
  VectorSearchOptions,
  SearchPerformanceMetrics,
  DatasetConfig,
} from '../types/search.types'
import { VectorSearchError } from '../types/search.types'

const logger = createScopedLogger('vector-search')

/**
 * Vector search service for semantic similarity search
 */
export class VectorSearchService {
  /**
   * Perform vector similarity search
   * @param query - The search query
   * @param datasetConfigs - Dataset configs with embedding info (pre-fetched to avoid redundant queries)
   * @param organizationId - Organization ID
   * @param userId - Optional user ID
   */
  static async search(
    query: SearchQuery,
    datasetConfigs: DatasetConfig[],
    organizationId: string,
    userId?: string
  ): Promise<{ results: SearchResult[]; metrics: SearchPerformanceMetrics }> {
    const startTime = Date.now()

    try {
      logger.info('Starting vector search', {
        organizationId,
        query: query.query,
        datasetCount: datasetConfigs.length,
        similarityThreshold: query.similarityThreshold,
      })

      if (datasetConfigs.length === 0) {
        return {
          results: [],
          metrics: {
            queryTime: 0,
            vectorSearchTime: 0,
            totalTime: Date.now() - startTime,
            resultsCount: 0,
            cacheHit: false,
          },
        }
      }

      // Perform vector search using pre-fetched dataset configs (no redundant query)
      const vectorSearchStartTime = Date.now()
      const vectorResults = await this.searchMultipleDatasets(
        query.query,
        datasetConfigs,
        organizationId,
        userId,
        {
          similarityThreshold: query.similarityThreshold || 0.7,
          maxResults: query.maxResults || query.limit || 20,
          includeMetadata: query.includeMetadata !== false,
          rerank: query.rerank,
        }
      )
      const vectorSearchTime = Date.now() - vectorSearchStartTime

      // Apply filters if provided
      const filteredResults = query.filters
        ? this.applyFilters(vectorResults, query.filters)
        : vectorResults

      // Sort by relevance score
      const sortedResults = filteredResults.sort((a, b) => b.score - a.score)

      const totalTime = Date.now() - startTime

      const metrics: SearchPerformanceMetrics = {
        queryTime: 0, // Embedding time is included in vectorSearchTime
        vectorSearchTime,
        totalTime,
        resultsCount: sortedResults.length,
        cacheHit: false,
      }

      logger.info('Vector search completed', {
        organizationId,
        resultsCount: sortedResults.length,
        totalTime,
        vectorSearchTime,
      })

      return {
        results: sortedResults,
        metrics,
      }
    } catch (error) {
      const totalTime = Date.now() - startTime
      const errorMessage = error instanceof Error ? error.message : 'Vector search failed'

      logger.error('Vector search failed', {
        error: errorMessage,
        organizationId,
        query: query.query,
        totalTime,
      })

      throw new VectorSearchError(`Vector search failed: ${errorMessage}`, {
        organizationId,
        query: query.query,
        totalTime,
      })
    }
  }

  /**
   * Search multiple datasets, handling mixed embedding dimensions
   * Groups datasets by dimension and runs parallel queries per dimension group
   * Dataset configs are passed in to avoid redundant queries
   */
  static async searchMultipleDatasets(
    query: string,
    datasetConfigs: DatasetConfig[],
    organizationId: string,
    userId?: string,
    options: VectorSearchOptions = {}
  ): Promise<SearchResult[]> {
    if (datasetConfigs.length === 0) {
      return []
    }

    // 1. Group datasets by dimension
    const byDimension = new Map<number, DatasetConfig[]>()
    for (const dataset of datasetConfigs) {
      const dim = dataset.vectorDimension || 1536
      if (!byDimension.has(dim)) {
        byDimension.set(dim, [])
      }
      byDimension.get(dim)!.push(dataset)
    }

    // 2. Generate query embeddings for each unique dimension (parallel)
    const dimensions = Array.from(byDimension.keys())
    const embeddingService = new EmbeddingService(db, organizationId, userId)

    const embeddings = await Promise.all(
      dimensions.map((dim) => embeddingService.generateSingle(query, { dimensions: dim }))
    )
    const embeddingByDim = new Map(dimensions.map((dim, i) => [dim, embeddings[i]]))

    // 3. Search each dimension group in parallel
    const searchPromises = Array.from(byDimension.entries()).map(async ([dimension, datasets]) => {
      const datasetIds = datasets.map((d) => d.id)
      const queryVector = embeddingByDim.get(dimension)!

      return PostgreSQLVectorDB.searchByVectorMultiDataset(queryVector, datasetIds, dimension, {
        topK: options.maxResults || 20,
        scoreThreshold: options.similarityThreshold || 0.0,
        includeMetadata: options.includeMetadata !== false,
      })
    })

    const resultGroups = await Promise.all(searchPromises)

    // 4. Convert to SearchResult format and merge results
    const allResults = resultGroups.flat().map((result, index) => {
      const meta = result.metadata || {}
      return {
        segment: {
          id: result.id,
          content: result.content,
          position: meta.position,
          tokenCount: meta.tokenCount,
          documentId: meta.documentId,
          organizationId: meta.organizationId,
          document: {
            id: meta.documentId,
            title: meta.documentTitle,
            filename: meta.documentFilename,
            mimeType: meta.documentMimeType,
            type: meta.documentType,
            size: meta.documentSize,
            status: meta.documentStatus,
            enabled: meta.documentEnabled,
            createdAt: meta.documentCreatedAt,
            dataset: {
              id: meta.datasetId,
              name: meta.datasetName,
            },
          },
        },
        score: result.score,
        rank: index + 1,
        relevanceScore: result.score,
        searchType: 'vector' as const,
      } as SearchResult
    })

    // 5. Re-sort by score and limit results
    allResults.sort((a, b) => b.score - a.score)

    return allResults.slice(0, options.maxResults || 20)
  }

  /**
   * Convert VectorService results to SearchResult format (kept for backward compatibility)
   */
  private static async convertToSearchResults(
    vectorResults: Array<{ id: string; similarity?: number; score?: number; distance?: number }>,
    searchType: 'vector'
  ): Promise<SearchResult[]> {
    if (!vectorResults || vectorResults.length === 0) {
      return []
    }

    // Get segment IDs from vector results
    const segmentIds = vectorResults.map((result) => result.id)

    // Fetch segment details with document and dataset information
    const segments = await db
      .select({
        id: schema.DocumentSegment.id,
        content: schema.DocumentSegment.content,
        position: schema.DocumentSegment.position,
        documentId: schema.DocumentSegment.documentId,
        documentTitle: schema.Document.title,
        datasetId: schema.Dataset.id,
        datasetName: schema.Dataset.name,
      })
      .from(schema.DocumentSegment)
      .leftJoin(schema.Document, eq(schema.DocumentSegment.documentId, schema.Document.id))
      .leftJoin(schema.Dataset, eq(schema.Document.datasetId, schema.Dataset.id))
      .where(inArray(schema.DocumentSegment.id, segmentIds))

    // Create a map for fast lookup
    const segmentMap = new Map(
      segments.map((row) => [
        row.id,
        {
          id: row.id,
          content: row.content,
          position: row.position as any,
          documentId: row.documentId,
          document: {
            id: row.documentId,
            title: row.documentTitle,
            dataset: { id: row.datasetId, name: row.datasetName },
          },
        } as any,
      ])
    )

    // Convert to SearchResult format
    return vectorResults
      .map((result, index) => {
        const segment = segmentMap.get(result.id)
        if (!segment) return null

        return {
          segment: segment as any,
          score: result.similarity || result.score || 0,
          rank: index + 1,
          distance: result.distance,
          relevanceScore: result.similarity || result.score || 0,
          searchType,
        } as SearchResult
      })
      .filter(Boolean) as SearchResult[]
  }

  /**
   * Apply search filters to vector results
   */
  private static applyFilters(
    results: SearchResult[],
    filters: SearchQuery['filters']
  ): SearchResult[] {
    if (!filters) return results

    return results.filter((result) => {
      const { segment } = result
      const document = segment.document

      // Filter by document types
      if (filters.documentTypes && filters.documentTypes.length > 0) {
        if (!filters.documentTypes.includes(document.type)) {
          return false
        }
      }

      // Filter by MIME types
      if (filters.mimeTypes && filters.mimeTypes.length > 0) {
        if (!document.mimeType || !filters.mimeTypes.includes(document.mimeType)) {
          return false
        }
      }

      // Filter by date range
      if (filters.dateRange) {
        const docDate = new Date(document.createdAt)
        if (docDate < filters.dateRange.from || docDate > filters.dateRange.to) {
          return false
        }
      }

      // Filter by file size
      if (filters.fileSize) {
        const fileSize = Number(document.size)
        if (filters.fileSize.min && fileSize < filters.fileSize.min) {
          return false
        }
        if (filters.fileSize.max && fileSize > filters.fileSize.max) {
          return false
        }
      }

      // Filter by enabled status
      if (filters.enabled !== undefined) {
        if (document.enabled !== filters.enabled) {
          return false
        }
      }

      // Filter by document status
      if (filters.documentStatus && filters.documentStatus.length > 0) {
        if (!filters.documentStatus.includes(document.status)) {
          return false
        }
      }

      return true
    })
  }

  /**
   * Get vector search suggestions based on similar content
   */
  static async getSimilarContent(
    segmentId: string,
    organizationId: string,
    limit: number = 5
  ): Promise<SearchResult[]> {
    try {
      // Get the segment with document and dataset info
      const segmentResults = await db.query.DocumentSegment.findFirst({
        where: eq(schema.DocumentSegment.id, segmentId),
        with: {
          document: {
            with: {
              dataset: true,
            },
          },
        },
      })

      const segment = segmentResults

      if (!segment) {
        return []
      }

      // Use the segment content to find similar content via vector search
      const results = await VectorService.searchDataset(
        segment.document.datasetId,
        segment.content,
        organizationId,
        undefined, // userId not available in this context
        {
          searchType: 'vector',
          topK: limit + 1, // +1 to exclude the original segment
          scoreThreshold: 0.8,
          includeMetadata: true,
        }
      )

      // Filter out the original segment and convert to SearchResult format
      const filteredResults = results.filter((result) => result.id !== segmentId)
      return await this.convertToSearchResults(filteredResults.slice(0, limit), 'vector')
    } catch (error) {
      logger.error('Failed to get similar content', {
        error: error instanceof Error ? error.message : error,
        segmentId,
        organizationId,
      })
      return []
    }
  }
}
