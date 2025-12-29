// packages/lib/src/datasets/search/hybrid-search.ts

import { createScopedLogger } from '@auxx/logger'
import { VectorSearchService } from './vector-search'
import { FullTextSearchService } from './full-text-search'
import type {
  SearchQuery,
  SearchResult,
  HybridSearchOptions,
  SearchPerformanceMetrics,
  DatasetConfig,
} from '../types/search.types'
import { SearchError } from '../types/search.types'

const logger = createScopedLogger('hybrid-search')

/**
 * Hybrid search service that combines vector and full-text search results
 */
export class HybridSearchService {
  /**
   * Perform hybrid search combining vector and text search
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
      logger.info('Starting hybrid search', {
        organizationId,
        query: query.query,
        datasetCount: datasetConfigs.length,
      })

      // Extract dataset IDs for full-text search (doesn't need embedding config)
      const datasetIds = datasetConfigs.map((d) => d.id)

      // Read weights from query or use defaults
      const queryWithWeights = query as any
      const hybridOptions: HybridSearchOptions = {
        vectorWeight: queryWithWeights.vectorWeight ?? 0.6, // Configurable or default to 0.6
        textWeight: queryWithWeights.textWeight ?? 0.4, // Configurable or default to 0.4
        combineMethod: queryWithWeights.combineMethod || 'weighted_sum',
        rerankingModel: queryWithWeights.rerankingModel || undefined,
      }

      // Execute both searches in parallel
      // Vector search uses datasetConfigs, full-text search uses datasetIds
      const [vectorResult, textResult] = await Promise.allSettled([
        VectorSearchService.search(query, datasetConfigs, organizationId, userId),
        FullTextSearchService.search(query, datasetIds, organizationId, userId),
      ])

      // Handle search results and errors
      const vectorResults = vectorResult.status === 'fulfilled' ? vectorResult.value.results : []
      const textResults = textResult.status === 'fulfilled' ? textResult.value.results : []

      const vectorMetrics = vectorResult.status === 'fulfilled' ? vectorResult.value.metrics : null
      const textMetrics = textResult.status === 'fulfilled' ? textResult.value.metrics : null

      // Log any search failures
      if (vectorResult.status === 'rejected') {
        logger.warn('Vector search failed in hybrid search', {
          error: vectorResult.reason?.message || vectorResult.reason,
          query: query.query,
        })
      }

      if (textResult.status === 'rejected') {
        logger.warn('Text search failed in hybrid search', {
          error: textResult.reason?.message || textResult.reason,
          query: query.query,
        })
      }

      // If both searches failed, throw error
      if (
        vectorResults.length === 0 &&
        textResults.length === 0 &&
        vectorResult.status === 'rejected' &&
        textResult.status === 'rejected'
      ) {
        throw new SearchError('Both vector and text searches failed')
      }

      // Combine and rank results
      const combinedResults = this.combineSearchResults(vectorResults, textResults, hybridOptions)

      // Apply filters if provided
      const filteredResults = query.filters
        ? this.applyFilters(combinedResults, query.filters)
        : combinedResults

      // Apply pagination limits
      const limit = query.limit || 20
      const offset = query.offset || 0
      const paginatedResults = filteredResults.slice(offset, offset + limit)

      const totalTime = Date.now() - startTime

      // Combine metrics from both searches
      const metrics: SearchPerformanceMetrics = {
        queryTime: vectorMetrics?.queryTime || 0,
        vectorSearchTime: vectorMetrics?.vectorSearchTime || 0,
        textSearchTime: textMetrics?.textSearchTime || 0,
        totalTime,
        resultsCount: filteredResults.length,
        cacheHit: vectorMetrics?.cacheHit || textMetrics?.cacheHit || false,
      }

      logger.info('Hybrid search completed', {
        organizationId,
        vectorResults: vectorResults.length,
        textResults: textResults.length,
        combinedResults: combinedResults.length,
        filteredResults: filteredResults.length,
        paginatedResults: paginatedResults.length,
        totalTime,
      })

      return {
        results: paginatedResults,
        metrics,
      }
    } catch (error) {
      const totalTime = Date.now() - startTime
      const errorMessage = error instanceof Error ? error.message : 'Hybrid search failed'

      logger.error('Hybrid search failed', {
        error: errorMessage,
        organizationId,
        query: query.query,
        totalTime,
      })

      throw new SearchError(`Hybrid search failed: ${errorMessage}`, 'HYBRID_SEARCH_FAILED')
    }
  }

  /**
   * Combine vector and text search results using specified method
   */
  private static combineSearchResults(
    vectorResults: SearchResult[],
    textResults: SearchResult[],
    options: HybridSearchOptions
  ): SearchResult[] {
    const { vectorWeight = 0.6, textWeight = 0.4, combineMethod = 'weighted_sum' } = options

    // Create maps for efficient lookup
    const vectorMap = new Map<string, SearchResult>()
    const textMap = new Map<string, SearchResult>()
    const allSegmentIds = new Set<string>()

    // Index vector results
    vectorResults.forEach((result) => {
      const segmentId = result.segment.id
      vectorMap.set(segmentId, result)
      allSegmentIds.add(segmentId)
    })

    // Index text results
    textResults.forEach((result) => {
      const segmentId = result.segment.id
      textMap.set(segmentId, result)
      allSegmentIds.add(segmentId)
    })

    // Combine results based on method
    const combinedResults: SearchResult[] = []

    allSegmentIds.forEach((segmentId) => {
      const vectorResult = vectorMap.get(segmentId)
      const textResult = textMap.get(segmentId)

      if (combineMethod === 'weighted_sum') {
        const combinedResult = this.combineByWeightedSum(
          vectorResult,
          textResult,
          vectorWeight,
          textWeight
        )
        if (combinedResult) {
          combinedResults.push(combinedResult)
        }
      } else if (combineMethod === 'rrf') {
        // Reciprocal Rank Fusion
        const combinedResult = this.combineByRRF(vectorResult, textResult)
        if (combinedResult) {
          combinedResults.push(combinedResult)
        }
      } else {
        // Linear combination (default fallback)
        const combinedResult = this.combineByLinearCombination(
          vectorResult,
          textResult,
          vectorWeight,
          textWeight
        )
        if (combinedResult) {
          combinedResults.push(combinedResult)
        }
      }
    })

    // Sort by combined score
    return combinedResults.sort((a, b) => b.score - a.score)
  }

  /**
   * Combine results using weighted sum
   */
  private static combineByWeightedSum(
    vectorResult: SearchResult | undefined,
    textResult: SearchResult | undefined,
    vectorWeight: number,
    textWeight: number
  ): SearchResult | null {
    if (!vectorResult && !textResult) return null

    // Use the result that exists, prefer vector result for metadata
    const baseResult = vectorResult || textResult!

    // Calculate combined score
    let combinedScore = 0
    let highlights: string[] = []

    if (vectorResult) {
      combinedScore += (vectorResult.score || 0) * vectorWeight
    }

    if (textResult) {
      combinedScore += (textResult.score || 0) * textWeight
      highlights = textResult.highlights || []
    }

    return {
      ...baseResult,
      score: combinedScore,
      highlights,
      searchType: 'hybrid',
      relevanceScore: combinedScore,
    }
  }

  /**
   * Combine results using Reciprocal Rank Fusion (RRF)
   */
  private static combineByRRF(
    vectorResult: SearchResult | undefined,
    textResult: SearchResult | undefined,
    k: number = 60 // RRF parameter
  ): SearchResult | null {
    if (!vectorResult && !textResult) return null

    const baseResult = vectorResult || textResult!

    let rrfScore = 0
    let highlights: string[] = []

    // RRF formula: 1 / (k + rank)
    if (vectorResult) {
      rrfScore += 1 / (k + (vectorResult.rank || 1))
    }

    if (textResult) {
      rrfScore += 1 / (k + (textResult.rank || 1))
      highlights = textResult.highlights || []
    }

    return {
      ...baseResult,
      score: rrfScore,
      highlights,
      searchType: 'hybrid',
      relevanceScore: rrfScore,
    }
  }

  /**
   * Combine results using linear combination
   */
  private static combineByLinearCombination(
    vectorResult: SearchResult | undefined,
    textResult: SearchResult | undefined,
    vectorWeight: number,
    textWeight: number
  ): SearchResult | null {
    if (!vectorResult && !textResult) return null

    const baseResult = vectorResult || textResult!

    // Normalize scores to 0-1 range before combining
    const vectorScore = vectorResult ? this.normalizeScore(vectorResult.score || 0, 'vector') : 0
    const textScore = textResult ? this.normalizeScore(textResult.score || 0, 'text') : 0

    const combinedScore = vectorScore * vectorWeight + textScore * textWeight
    const highlights = textResult?.highlights || []

    return {
      ...baseResult,
      score: combinedScore,
      highlights,
      searchType: 'hybrid',
      relevanceScore: combinedScore,
    }
  }

  /**
   * Normalize scores to 0-1 range based on search type
   */
  private static normalizeScore(score: number, searchType: 'vector' | 'text'): number {
    if (searchType === 'vector') {
      // Vector similarity scores are typically between 0 and 1 already
      return Math.max(0, Math.min(1, score))
    } else {
      // Text search scores (ts_rank) can vary more, normalize using a reasonable upper bound
      return Math.max(0, Math.min(1, score / 1.0)) // Assuming max ts_rank of 1.0
    }
  }

  /**
   * Apply search filters to hybrid results
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
   * Get hybrid search configuration recommendations based on query
   */
  static getRecommendedConfig(query: string): HybridSearchOptions {
    // Simple heuristics for configuration
    const hasQuotes = query.includes('"')
    const hasSpecialChars = /[&|!()]/.test(query)
    const wordCount = query.trim().split(/\s+/).length

    if (hasQuotes || hasSpecialChars) {
      // Favor text search for exact phrases or boolean queries
      return {
        vectorWeight: 0.3,
        textWeight: 0.7,
        combineMethod: 'weighted_sum',
      }
    }

    if (wordCount <= 2) {
      // Short queries benefit more from vector search
      return {
        vectorWeight: 0.7,
        textWeight: 0.3,
        combineMethod: 'weighted_sum',
      }
    }

    // Default balanced configuration
    return {
      vectorWeight: 0.6,
      textWeight: 0.4,
      combineMethod: 'weighted_sum',
    }
  }

  /**
   * Analyze search results quality and suggest improvements
   */
  static analyzeResultsQuality(
    results: SearchResult[],
    query: string
  ): {
    quality: 'high' | 'medium' | 'low'
    suggestions: string[]
    metrics: {
      avgScore: number
      scoreVariance: number
      hasHighlights: boolean
    }
  } {
    if (results.length === 0) {
      return {
        quality: 'low',
        suggestions: ['Try a different query', 'Check if documents are indexed'],
        metrics: { avgScore: 0, scoreVariance: 0, hasHighlights: false },
      }
    }

    const scores = results.map((r) => r.score || 0)
    const avgScore = scores.reduce((a, b) => a + b, 0) / scores.length
    const scoreVariance =
      scores.reduce((acc, score) => acc + Math.pow(score - avgScore, 2), 0) / scores.length
    const hasHighlights = results.some((r) => r.highlights && r.highlights.length > 0)

    const suggestions: string[] = []

    if (avgScore < 0.3) {
      suggestions.push('Try more specific keywords')
      suggestions.push('Check spelling and terminology')
    }

    if (scoreVariance < 0.01) {
      suggestions.push('Results have similar relevance - try more specific filters')
    }

    if (!hasHighlights) {
      suggestions.push('No text matches found - results are based on semantic similarity only')
    }

    const quality = avgScore > 0.6 ? 'high' : avgScore > 0.3 ? 'medium' : 'low'

    return {
      quality,
      suggestions,
      metrics: {
        avgScore,
        scoreVariance,
        hasHighlights,
      },
    }
  }
}
