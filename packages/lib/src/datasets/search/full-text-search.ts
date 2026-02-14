// packages/lib/src/datasets/search/full-text-search.ts

import { database as db } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { sql } from 'drizzle-orm'
import type {
  FullTextSearchOptions,
  SearchPerformanceMetrics,
  SearchQuery,
  SearchResult,
} from '../types/search.types'
import { FullTextSearchError } from '../types/search.types'

const logger = createScopedLogger('fulltext-search')

/**
 * Full-text search service using PostgreSQL full-text search capabilities
 */
export class FullTextSearchService {
  /**
   * Perform full-text search across document segments
   */
  static async search(
    query: SearchQuery,
    datasetIds: string[],
    organizationId: string,
    _userId?: string
  ): Promise<{ results: SearchResult[]; metrics: SearchPerformanceMetrics }> {
    const startTime = Date.now()

    try {
      logger.info('Starting full-text search', {
        organizationId,
        query: query.query,
        datasetIds: datasetIds.length,
      })

      // Prepare search query for PostgreSQL
      // Filters are now applied in SQL for better performance
      const searchStartTime = Date.now()
      const searchResults = await FullTextSearchService.performFullTextSearch(
        query.query,
        datasetIds,
        organizationId,
        {
          fuzzySearch: true,
          phraseSearch: false,
          booleanMode: false,
          rankingMode: 'bm25',
          minScore: 0.1,
          includeInactive: query.includeInactive,
          filters: query.filters, // Pass filters to SQL query
        }
      )
      const searchTime = Date.now() - searchStartTime

      // Filters are now applied in SQL, so no in-memory filtering needed
      const filteredResults = searchResults

      // Apply pagination limits
      const limit = query.limit || 20
      const offset = query.offset || 0
      const paginatedResults = filteredResults.slice(offset, offset + limit)

      const totalTime = Date.now() - startTime

      const metrics: SearchPerformanceMetrics = {
        queryTime: 0, // No embedding generation needed
        textSearchTime: searchTime,
        totalTime,
        resultsCount: filteredResults.length,
        cacheHit: false,
      }

      logger.info('Full-text search completed', {
        organizationId,
        resultsCount: filteredResults.length,
        paginatedCount: paginatedResults.length,
        totalTime,
        searchTime,
      })

      return {
        results: paginatedResults,
        metrics,
      }
    } catch (error) {
      const totalTime = Date.now() - startTime
      const errorMessage = error instanceof Error ? error.message : 'Full-text search failed'

      logger.error('Full-text search failed', {
        error: errorMessage,
        organizationId,
        query: query.query,
        totalTime,
      })

      throw new FullTextSearchError(`Full-text search failed: ${errorMessage}`, {
        organizationId,
        query: query.query,
        totalTime,
      })
    }
  }

  /**
   * Perform the actual full-text search using PostgreSQL
   * Optimized: Uses stored searchVector column, reduced column selection, SQL-side filtering
   */
  private static async performFullTextSearch(
    searchQuery: string,
    datasetIds: string[],
    organizationId: string,
    options: FullTextSearchOptions & { filters?: import('../types/search.types').SearchFilters }
  ): Promise<SearchResult[]> {
    try {
      logger.debug('Executing full-text search', {
        searchQuery,
        datasetIds: datasetIds.length,
        organizationId,
      })

      // Build SQL filter conditions
      const filterConditions = FullTextSearchService.buildSqlFilters(options.filters)

      // Execute optimized full-text search using stored searchVector generated column
      // searchVector is auto-computed from content by PostgreSQL
      // Reduced column selection for better performance
      const datasetIdsArray = `{${datasetIds.join(',')}}`
      const searchResults = (
        await db.execute(sql`
        SELECT
          ds.id,
          ds.content,
          ds.position,
          ds."tokenCount",
          ds."documentId",
          ds."organizationId",
          d.id as "docId",
          d.title as "documentTitle",
          d.filename as "documentFilename",
          d."mimeType" as "documentMimeType",
          d.type as "documentType",
          d.size as "documentSize",
          d.status as "documentStatus",
          d.enabled as "documentEnabled",
          d."createdAt" as "documentCreatedAt",
          dt.id as "datasetId",
          dt.name as "datasetName",
          ts_rank_cd(ds."searchVector", plainto_tsquery('english', ${searchQuery})) as rank_score
        FROM "DocumentSegment" ds
        JOIN "Document" d ON ds."documentId" = d.id
        JOIN "Dataset" dt ON d."datasetId" = dt.id
        WHERE dt.id = ANY(${datasetIdsArray}::text[])
          AND dt."organizationId" = ${organizationId}
          AND ds.enabled = true
          AND d.enabled = true
          ${options.includeInactive ? sql`` : sql`AND dt.status = 'ACTIVE'`}
          AND ds."searchVector" @@ plainto_tsquery('english', ${searchQuery})
          ${filterConditions}
        ORDER BY rank_score DESC, ds."createdAt" DESC
        LIMIT 100;
      `)
      ).rows as any[]

      // Convert raw results to SearchResult format
      return FullTextSearchService.convertRawToSearchResultsOptimized(searchResults)
    } catch (error) {
      logger.error('Full-text search execution failed', {
        error: error instanceof Error ? error.message : error,
        searchQuery,
        datasetIds: datasetIds.length,
        organizationId,
      })
      throw new Error('Full-text search failed')
    }
  }

  /**
   * Build SQL filter conditions from SearchFilters
   */
  private static buildSqlFilters(filters?: import('../types/search.types').SearchFilters) {
    if (!filters) return sql``

    const conditions: ReturnType<typeof sql>[] = []

    // Filter by document types
    if (filters.documentTypes && filters.documentTypes.length > 0) {
      conditions.push(sql`AND d.type = ANY(${filters.documentTypes}::text[])`)
    }

    // Filter by MIME types
    if (filters.mimeTypes && filters.mimeTypes.length > 0) {
      conditions.push(sql`AND d."mimeType" = ANY(${filters.mimeTypes}::text[])`)
    }

    // Filter by date range
    if (filters.dateRange) {
      if (filters.dateRange.from) {
        conditions.push(
          sql`AND d."createdAt" >= ${filters.dateRange.from.toISOString()}::timestamp`
        )
      }
      if (filters.dateRange.to) {
        conditions.push(sql`AND d."createdAt" <= ${filters.dateRange.to.toISOString()}::timestamp`)
      }
    }

    // Filter by document status
    if (filters.documentStatus && filters.documentStatus.length > 0) {
      conditions.push(sql`AND d.status = ANY(${filters.documentStatus}::text[])`)
    }

    // Filter by enabled status
    if (filters.enabled !== undefined) {
      conditions.push(sql`AND d.enabled = ${filters.enabled}`)
    }

    // Filter by file size
    if (filters.fileSize) {
      if (filters.fileSize.min !== undefined) {
        conditions.push(sql`AND d.size >= ${filters.fileSize.min}`)
      }
      if (filters.fileSize.max !== undefined) {
        conditions.push(sql`AND d.size <= ${filters.fileSize.max}`)
      }
    }

    return conditions.length > 0 ? sql.join(conditions, sql` `) : sql``
  }

  /**
   * Convert raw database results to SearchResult format (optimized version with reduced columns)
   */
  private static convertRawToSearchResultsOptimized(rawResults: any[]): SearchResult[] {
    return rawResults.map(
      (row, index) =>
        ({
          segment: {
            id: row.id,
            documentId: row.documentId,
            content: row.content,
            position: row.position,
            tokenCount: row.tokenCount,
            organizationId: row.organizationId,
            document: {
              id: row.docId,
              title: row.documentTitle,
              filename: row.documentFilename,
              mimeType: row.documentMimeType,
              type: row.documentType,
              size: row.documentSize,
              status: row.documentStatus,
              enabled: row.documentEnabled,
              createdAt: row.documentCreatedAt,
              datasetId: row.datasetId,
              organizationId: row.organizationId,
              dataset: {
                id: row.datasetId,
                name: row.datasetName,
              },
            },
          },
          score: parseFloat(row.rank_score) || 0,
          rank: index,
          relevanceScore: parseFloat(row.rank_score) || 0,
          searchType: 'text',
        }) as SearchResult
    )
  }

  /**
   * Get search suggestions based on frequent terms
   */
  static async getSearchSuggestions(
    partialQuery: string,
    datasetIds: string[],
    organizationId: string,
    limit: number = 5
  ): Promise<string[]> {
    try {
      if (partialQuery.length < 2) {
        return []
      }

      // Get frequent terms that start with the partial query
      const suggestions = (
        await db.execute(sql`
        SELECT word, nentry as frequency
        FROM ts_stat('
          SELECT to_tsvector(''english'', content) 
          FROM "DocumentSegment" ds
          JOIN "Document" d ON ds."documentId" = d.id
          JOIN "Dataset" dt ON d."datasetId" = dt.id
          WHERE dt.id = ANY(' || ${datasetIds}::text || ')
            AND dt."organizationId" = ''' || ${organizationId} || '''
            AND ds.enabled = true
        ')
        WHERE word ILIKE ${partialQuery + '%'}
          AND LENGTH(word) > 2
        ORDER BY frequency DESC, word ASC
        LIMIT ${limit};
      `)
      ).rows as { word: string; frequency: number }[]

      return suggestions.map((s) => s.word)
    } catch (error) {
      logger.error('Failed to get search suggestions', {
        error: error instanceof Error ? error.message : error,
        partialQuery,
        organizationId,
      })
      return []
    }
  }

  /**
   * Perform search within specific document
   * Optimized: Uses stored searchVector column, reduced columns
   */
  static async searchWithinDocument(
    searchQuery: string,
    documentId: string,
    organizationId: string,
    limit: number = 10
  ): Promise<SearchResult[]> {
    try {
      const searchResults = (
        await db.execute(sql`
        SELECT
          ds.id,
          ds.content,
          ds.position,
          ds."tokenCount",
          ds."documentId",
          ds."organizationId",
          d.id as "docId",
          d.title as "documentTitle",
          d.filename as "documentFilename",
          d."mimeType" as "documentMimeType",
          d.type as "documentType",
          d.size as "documentSize",
          d.status as "documentStatus",
          d.enabled as "documentEnabled",
          d."createdAt" as "documentCreatedAt",
          dt.id as "datasetId",
          dt.name as "datasetName",
          ts_rank_cd(ds."searchVector", plainto_tsquery('english', ${searchQuery})) as rank_score
        FROM "DocumentSegment" ds
        JOIN "Document" d ON ds."documentId" = d.id
        JOIN "Dataset" dt ON d."datasetId" = dt.id
        WHERE d.id = ${documentId}
          AND dt."organizationId" = ${organizationId}
          AND ds.enabled = true
          AND ds."searchVector" @@ plainto_tsquery('english', ${searchQuery})
        ORDER BY ds.position ASC, rank_score DESC
        LIMIT ${limit};
      `)
      ).rows as any[]

      return FullTextSearchService.convertRawToSearchResultsOptimized(searchResults)
    } catch (error) {
      logger.error('Failed to search within document', {
        error: error instanceof Error ? error.message : error,
        searchQuery,
        documentId,
        organizationId,
      })
      return []
    }
  }
}
