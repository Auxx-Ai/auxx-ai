// packages/lib/src/datasets/services/search.service.ts

import { database as db, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { and, avg, count, desc, eq, gte, ilike, inArray, sql } from 'drizzle-orm'
import { SystemUserService } from '../../users/system-user-service'
import { FullTextSearchService } from '../search/full-text-search'
import { HybridSearchService } from '../search/hybrid-search'
import { VectorSearchService } from '../search/vector-search'
import type {
  DatasetConfig,
  SearchAnalytics,
  SearchHistoryEntry,
  SearchPerformanceMetrics,
  SearchQuery,
  SearchResponse,
  SearchResult,
  SearchSuggestion,
  SearchSuggestionOptions,
  SearchType,
} from '../types/search.types'
import { InvalidQueryError, SearchError } from '../types/search.types'

const logger = createScopedLogger('search-service')

/**
 * Main search service that coordinates different search strategies
 */
export class SearchService {
  /**
   * Execute search query across datasets
   */
  static async search(
    query: SearchQuery,
    organizationId: string,
    userId?: string
  ): Promise<SearchResponse> {
    const startTime = Date.now()

    // Get system user if no userId provided
    const finalUserId = userId || (await SystemUserService.getSystemUserForActions(organizationId))

    try {
      // Validate query
      SearchService.validateQuery(query)

      logger.info('Starting search', {
        organizationId,
        userId: finalUserId,
        query: query.query,
        searchType: query.searchType,
        datasetIds: query.datasetIds?.length || 0,
      })

      // Get accessible datasets with embedding config (avoids redundant queries in search services)
      const accessibleDatasetConfigs = await SearchService.getAccessibleDatasets(
        organizationId,
        finalUserId,
        query.datasetIds,
        query.includeInactive
      )

      if (accessibleDatasetConfigs.length === 0) {
        logger.warn('No accessible datasets found for search', {
          organizationId,
          userId: finalUserId,
          requestedDatasets: query.datasetIds?.length || 0,
        })

        return {
          results: [],
          total: 0,
          query: query.query,
          searchType: query.searchType || 'hybrid',
          responseTime: Date.now() - startTime,
          hasMore: false,
        }
      }

      // Extract dataset IDs for services that only need IDs
      const accessibleDatasetIds = accessibleDatasetConfigs.map((d) => d.id)

      let results: SearchResult[]
      let performanceMetrics: SearchPerformanceMetrics

      // Execute search based on type
      switch (query.searchType) {
        case 'vector': {
          const vectorResults = await VectorSearchService.search(
            query,
            accessibleDatasetConfigs,
            organizationId,
            finalUserId
          )
          results = vectorResults.results
          performanceMetrics = vectorResults.metrics
          break
        }

        case 'text': {
          const textResults = await FullTextSearchService.search(
            query,
            accessibleDatasetIds,
            organizationId,
            finalUserId
          )
          results = textResults.results
          performanceMetrics = textResults.metrics
          break
        }

        case 'hybrid':
        default: {
          const hybridResults = await HybridSearchService.search(
            query,
            accessibleDatasetConfigs,
            organizationId,
            finalUserId
          )
          results = hybridResults.results
          performanceMetrics = hybridResults.metrics
          break
        }
      }

      // Apply pagination
      const offset = query.offset || 0
      const limit = query.limit || 20
      const paginatedResults = results.slice(offset, offset + limit)

      // Calculate response metrics
      const responseTime = Date.now() - startTime

      // Record search query for analytics (fire-and-forget, non-blocking)
      // Safe to use [0].id since we already checked accessibleDatasetConfigs.length > 0 above
      void SearchService.recordSearchQuery(
        organizationId,
        finalUserId,
        query,
        results.length,
        responseTime,
        performanceMetrics,
        accessibleDatasetConfigs[0]!.id
      )

      const response: SearchResponse = {
        results: paginatedResults,
        total: results.length,
        query: query.query,
        searchType: query.searchType || 'hybrid',
        responseTime,
        hasMore: offset + limit < results.length,
        nextOffset: offset + limit < results.length ? offset + limit : undefined,
      }

      logger.info('Search completed', {
        organizationId,
        userId: finalUserId,
        query: query.query,
        resultsCount: results.length,
        responseTime,
        searchType: query.searchType || 'HYBRID',
      })

      return response
    } catch (error) {
      const responseTime = Date.now() - startTime
      const errorMessage = error instanceof Error ? error.message : 'Unknown search error'

      logger.error('Search failed', {
        error: errorMessage,
        organizationId,
        userId: finalUserId,
        query: query.query,
        responseTime,
      })

      // Record failed search for analytics
      try {
        const fallbackDatasetConfigs = await SearchService.getAccessibleDatasets(
          organizationId,
          finalUserId,
          query.datasetIds
        )
        if (fallbackDatasetConfigs.length > 0) {
          await SearchService.recordSearchQuery(
            organizationId,
            finalUserId,
            query,
            0,
            responseTime,
            { queryTime: responseTime, totalTime: responseTime, resultsCount: 0, cacheHit: false },
            fallbackDatasetConfigs[0]!.id,
            errorMessage
          )
        }
      } catch {
        // Ignore analytics errors
      }

      if (error instanceof InvalidQueryError) {
        throw error
      }

      throw new SearchError(`Search failed: ${errorMessage}`, 'SEARCH_EXECUTION_FAILED')
    }
  }

  /**
   * Get search suggestions based on query
   */
  static async getSuggestions(
    organizationId: string,
    userId: string,
    options: SearchSuggestionOptions
  ): Promise<SearchSuggestion[]> {
    try {
      const suggestions: SearchSuggestion[] = []

      // Get query completions from search history
      if (options.includeHistory !== false) {
        const historySuggestions = await SearchService.getHistorySuggestions(
          organizationId,
          userId,
          options.query,
          options.datasetIds,
          3
        )
        suggestions.push(...historySuggestions)
      }

      // Get popular queries
      if (options.includePopular !== false) {
        const popularSuggestions = await SearchService.getPopularSuggestions(
          organizationId,
          options.query,
          options.datasetIds,
          2
        )
        suggestions.push(...popularSuggestions)
      }

      // Limit results
      const limit = options.limit || 5
      return suggestions.slice(0, limit)
    } catch (error) {
      logger.error('Failed to get search suggestions', {
        error: error instanceof Error ? error.message : error,
        organizationId,
        userId,
        query: options.query,
      })

      // Return empty array on error to not break UX
      return []
    }
  }

  /**
   * Get search history for user
   */
  static async getSearchHistory(
    organizationId: string,
    userId: string,
    limit: number = 20,
    datasetIds?: string[]
  ): Promise<SearchHistoryEntry[]> {
    try {
      const whereConds = [
        eq(schema.DatasetSearchQuery.organizationId, organizationId),
        eq(schema.DatasetSearchQuery.userId, userId),
      ] as any[]

      if (datasetIds && datasetIds.length > 0) {
        whereConds.push(inArray(schema.DatasetSearchQuery.datasetId, datasetIds))
      }

      const rows = await db
        .select({
          id: schema.DatasetSearchQuery.id,
          query: schema.DatasetSearchQuery.query,
          queryType: schema.DatasetSearchQuery.queryType,
          resultsCount: schema.DatasetSearchQuery.resultsCount,
          responseTime: schema.DatasetSearchQuery.responseTime,
          filters: schema.DatasetSearchQuery.filters,
          createdAt: schema.DatasetSearchQuery.createdAt,
          userId: schema.DatasetSearchQuery.userId,
          organizationId: schema.DatasetSearchQuery.organizationId,
        })
        .from(schema.DatasetSearchQuery)
        .where(and(...whereConds))
        .orderBy(desc(schema.DatasetSearchQuery.createdAt))
        .limit(limit)

      return rows.map((entry) => ({
        id: entry.id,
        query: entry.query,
        searchType: entry.queryType as SearchType,
        resultCount: entry.resultsCount,
        responseTime: entry.responseTime,
        filters: (entry.filters as any) ?? undefined,
        createdAt: new Date(entry.createdAt),
        userId: entry.userId,
        organizationId: entry.organizationId,
      }))
    } catch (error) {
      logger.error('Failed to get search history', {
        error: error instanceof Error ? error.message : error,
        organizationId,
        userId,
      })
      throw new SearchError('Failed to retrieve search history')
    }
  }

  /**
   * Clear search history for user
   */
  static async clearSearchHistory(
    organizationId: string,
    userId: string,
    datasetIds?: string[]
  ): Promise<void> {
    try {
      const conds = [
        eq(schema.DatasetSearchQuery.organizationId, organizationId),
        eq(schema.DatasetSearchQuery.userId, userId),
      ] as any[]
      if (datasetIds && datasetIds.length > 0) {
        conds.push(inArray(schema.DatasetSearchQuery.datasetId, datasetIds))
      }
      await db.delete(schema.DatasetSearchQuery).where(and(...conds))

      logger.info('Search history cleared', {
        organizationId,
        userId,
        datasetIds: datasetIds?.length || 0,
      })
    } catch (error) {
      logger.error('Failed to clear search history', {
        error: error instanceof Error ? error.message : error,
        organizationId,
        userId,
      })
      throw new SearchError('Failed to clear search history')
    }
  }

  /**
   * Get search analytics for organization
   */
  static async getSearchAnalytics(
    organizationId: string,
    timeRange: '7d' | '30d' | '90d' | '1y' = '30d',
    datasetIds?: string[]
  ): Promise<SearchAnalytics> {
    try {
      const daysAgo = SearchService.getTimeRangeDays(timeRange)
      const fromDate = new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000)

      // Build base where conditions
      const baseConds = [
        eq(schema.DatasetSearchQuery.organizationId, organizationId),
        gte(schema.DatasetSearchQuery.createdAt, fromDate.toISOString()),
      ] as any[]
      if (datasetIds && datasetIds.length > 0) {
        baseConds.push(inArray(schema.DatasetSearchQuery.datasetId, datasetIds))
      }

      // Query statistics (count and avg responseTime)
      const [qs] = await db
        .select({
          total: count(),
          avgResponseTime: avg(schema.DatasetSearchQuery.responseTime),
        })
        .from(schema.DatasetSearchQuery)
        .where(and(...baseConds))

      // Popular queries (top 10)
      const popularQueries = await db
        .select({
          query: schema.DatasetSearchQuery.query,
          cnt: count(),
          avgResults: avg(schema.DatasetSearchQuery.resultsCount),
        })
        .from(schema.DatasetSearchQuery)
        .where(and(...baseConds))
        .groupBy(schema.DatasetSearchQuery.query)
        .orderBy(desc(sql`count(*)`))
        .limit(10)

      // Search type distribution
      const typeDistribution = await db
        .select({ queryType: schema.DatasetSearchQuery.queryType, cnt: count() })
        .from(schema.DatasetSearchQuery)
        .where(and(...baseConds))
        .groupBy(schema.DatasetSearchQuery.queryType)

      return {
        totalQueries: Number(qs?.total || 0),
        averageResponseTime: Number(qs?.avgResponseTime || 0),
        popularQueries: popularQueries.map((pq) => ({
          query: pq.query,
          count: Number(pq.cnt || 0),
          averageResults: Math.round(Number(pq.avgResults || 0)),
        })),
        searchTypeDistribution: typeDistribution.map((td) => ({
          type: td.queryType as SearchType,
          count: Number(td.cnt || 0),
          percentage:
            Number(qs?.total || 0) > 0 ? (Number(td.cnt || 0) / Number(qs?.total || 0)) * 100 : 0,
        })),
        datasetUsage: [], // Will be implemented based on actual usage
        timeRangeAnalytics: [], // Will be implemented for time-based analytics
      }
    } catch (error) {
      logger.error('Failed to get search analytics', {
        error: error instanceof Error ? error.message : error,
        organizationId,
        timeRange,
      })
      throw new SearchError('Failed to retrieve search analytics')
    }
  }

  // Private helper methods

  private static validateQuery(query: SearchQuery): void {
    if (!query.query || query.query.trim().length === 0) {
      throw new InvalidQueryError('Search query cannot be empty')
    }

    if (query.query.length > 1000) {
      throw new InvalidQueryError('Search query too long (max 1000 characters)')
    }

    if (query.limit && (query.limit < 1 || query.limit > 100)) {
      throw new InvalidQueryError('Limit must be between 1 and 100')
    }

    if (query.offset && query.offset < 0) {
      throw new InvalidQueryError('Offset must be non-negative')
    }
  }

  /**
   * Get accessible datasets with their embedding configuration
   * Returns dataset configs to avoid redundant queries in search services
   */
  private static async getAccessibleDatasets(
    organizationId: string,
    userId: string,
    requestedDatasetIds?: string[],
    includeInactive?: boolean
  ): Promise<DatasetConfig[]> {
    try {
      const conds = [eq(schema.Dataset.organizationId, organizationId)] as any[]
      if (includeInactive !== true) {
        conds.push(eq(schema.Dataset.status, 'ACTIVE' as any))
      }
      if (requestedDatasetIds && requestedDatasetIds.length > 0) {
        conds.push(inArray(schema.Dataset.id, requestedDatasetIds))
      }
      const rows = await db
        .select({
          id: schema.Dataset.id,
          vectorDimension: schema.Dataset.vectorDimension,
          embeddingModel: schema.Dataset.embeddingModel,
        })
        .from(schema.Dataset)
        .where(and(...conds))

      return rows.map((r) => ({
        id: r.id,
        vectorDimension: r.vectorDimension || 1536,
        embeddingModel: r.embeddingModel,
      }))
    } catch (error) {
      logger.error('Failed to get accessible datasets', {
        error: error instanceof Error ? error.message : error,
        organizationId,
        userId,
      })
      return []
    }
  }

  private static async recordSearchQuery(
    organizationId: string,
    userId: string,
    query: SearchQuery,
    resultCount: number,
    responseTime: number,
    _metrics: SearchPerformanceMetrics,
    datasetId: string,
    _error?: string
  ): Promise<void> {
    try {
      await db.insert(schema.DatasetSearchQuery).values({
        query: query.query,
        queryType: (query.searchType || 'hybrid') as any,
        resultsCount: resultCount,
        responseTime,
        datasetId,
        organizationId,
        userId,
        vectorSimilarityThreshold: query.similarityThreshold as any,
        maxResults: (query.maxResults || query.limit || 0) as any,
        filters: (query.filters as any) || undefined,
      })
    } catch (error) {
      // Log but don't fail the search
      logger.warn('Failed to record search query', {
        error: error instanceof Error ? error.message : error,
      })
    }
  }

  private static async getHistorySuggestions(
    organizationId: string,
    userId: string,
    query: string,
    datasetIds?: string[],
    limit: number = 3
  ): Promise<SearchSuggestion[]> {
    const conds = [
      eq(schema.DatasetSearchQuery.organizationId, organizationId),
      eq(schema.DatasetSearchQuery.userId, userId),
      ilike(schema.DatasetSearchQuery.query, `%${query}%`),
    ] as any[]
    if (datasetIds && datasetIds.length > 0) {
      conds.push(inArray(schema.DatasetSearchQuery.datasetId, datasetIds))
    }

    // Fetch extra then de-dup by query
    const rows = await db
      .select({
        query: schema.DatasetSearchQuery.query,
        resultsCount: schema.DatasetSearchQuery.resultsCount,
        createdAt: schema.DatasetSearchQuery.createdAt,
      })
      .from(schema.DatasetSearchQuery)
      .where(and(...conds))
      .orderBy(desc(schema.DatasetSearchQuery.createdAt))
      .limit(limit * 5)

    const seen = new Set<string>()
    const history = [] as Array<{ query: string; resultsCount: number }>
    for (const row of rows) {
      if (!seen.has(row.query)) {
        seen.add(row.query)
        history.push({ query: row.query, resultsCount: row.resultsCount })
        if (history.length >= limit) break
      }
    }

    return history.map((h) => ({
      suggestion: h.query,
      type: 'history' as const,
      score: h.resultsCount,
      metadata: { resultsCount: h.resultsCount },
    }))
  }

  private static async getPopularSuggestions(
    organizationId: string,
    query: string,
    datasetIds?: string[],
    limit: number = 2
  ): Promise<SearchSuggestion[]> {
    const conds = [
      eq(schema.DatasetSearchQuery.organizationId, organizationId),
      ilike(schema.DatasetSearchQuery.query, `%${query}%`),
      gte(
        schema.DatasetSearchQuery.createdAt,
        new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
      ),
    ] as any[]
    if (datasetIds && datasetIds.length > 0) {
      conds.push(inArray(schema.DatasetSearchQuery.datasetId, datasetIds))
    }

    const popular = await db
      .select({ query: schema.DatasetSearchQuery.query, cnt: count() })
      .from(schema.DatasetSearchQuery)
      .where(and(...conds))
      .groupBy(schema.DatasetSearchQuery.query)
      .orderBy(desc(sql`count(*)`))
      .limit(limit)

    return popular.map((p) => ({
      suggestion: p.query,
      type: 'popular' as const,
      score: Number(p.cnt || 0),
      metadata: { popularity: Number(p.cnt || 0) },
    }))
  }

  private static getTimeRangeDays(timeRange: string): number {
    switch (timeRange) {
      case '7d':
        return 7
      case '30d':
        return 30
      case '90d':
        return 90
      case '1y':
        return 365
      default:
        return 30
    }
  }
}
