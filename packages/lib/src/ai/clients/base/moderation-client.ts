// packages/lib/src/ai/clients/base/moderation-client.ts

import { BaseSpecializedClient } from './base-specialized-client'
import type {
  ClientConfig,
  ModerationParams,
  ModerationResponse,
  ModerationResult,
} from './types'

/**
 * Abstract base class for content moderation clients
 */
export abstract class ModerationClient extends BaseSpecializedClient {
  constructor(config: ClientConfig, clientName: string, logger?: any) {
    super(config, clientName, logger)
  }

  // ===== ABSTRACT METHODS =====

  /**
   * Moderate text content
   */
  abstract invoke(params: ModerationParams): Promise<ModerationResponse>

  // ===== IMPLEMENTED METHODS =====

  /**
   * Validate moderation parameters
   */
  protected validateModerationParams(params: ModerationParams): void {
    this.validateRequiredParams(params, ['text', 'model'])

    if (typeof params.text !== 'string' && !Array.isArray(params.text)) {
      throw new Error('Text must be a string or array of strings')
    }

    if (Array.isArray(params.text)) {
      if (params.text.length === 0) {
        throw new Error('Text array cannot be empty')
      }

      for (const [index, text] of params.text.entries()) {
        if (typeof text !== 'string') {
          throw new Error(`Text at index ${index} must be a string`)
        }
      }
    }
  }

  /**
   * Check if any results are flagged
   */
  protected hasAnyFlagged(results: ModerationResult[]): boolean {
    return results.some(result => result.flagged)
  }

  /**
   * Get highest severity score across all categories
   */
  protected getHighestSeverityScore(results: ModerationResult[]): number {
    let highest = 0
    
    for (const result of results) {
      const scores = Object.values(result.category_scores)
      const maxScore = Math.max(...scores)
      highest = Math.max(highest, maxScore)
    }

    return highest
  }

  /**
   * Get flagged categories across all results
   */
  protected getFlaggedCategories(results: ModerationResult[]): string[] {
    const flaggedCategories = new Set<string>()

    for (const result of results) {
      Object.entries(result.categories).forEach(([category, flagged]) => {
        if (flagged) {
          flaggedCategories.add(category)
        }
      })
    }

    return Array.from(flaggedCategories)
  }

  /**
   * Filter results by severity threshold
   */
  protected filterBySeverity(
    results: ModerationResult[],
    threshold: number = 0.5
  ): ModerationResult[] {
    return results.filter(result => {
      const maxScore = Math.max(...Object.values(result.category_scores))
      return maxScore >= threshold
    })
  }

  /**
   * Create moderation summary
   */
  protected createModerationSummary(results: ModerationResult[]): {
    totalInputs: number
    flaggedInputs: number
    flaggedCategories: string[]
    highestSeverity: number
    averageSeverity: number
  } {
    const flaggedInputs = results.filter(r => r.flagged).length
    const flaggedCategories = this.getFlaggedCategories(results)
    const highestSeverity = this.getHighestSeverityScore(results)
    
    // Calculate average severity across all category scores
    let totalScores = 0
    let scoreCount = 0
    
    for (const result of results) {
      const scores = Object.values(result.category_scores)
      totalScores += scores.reduce((sum, score) => sum + score, 0)
      scoreCount += scores.length
    }
    
    const averageSeverity = scoreCount > 0 ? totalScores / scoreCount : 0

    return {
      totalInputs: results.length,
      flaggedInputs,
      flaggedCategories,
      highestSeverity,
      averageSeverity,
    }
  }

  /**
   * Standard category mappings (can be overridden by providers)
   */
  protected getStandardCategories(): string[] {
    return [
      'hate',
      'hate/threatening',
      'harassment',
      'harassment/threatening',
      'self-harm',
      'self-harm/intent',
      'self-harm/instructions',
      'sexual',
      'sexual/minors',
      'violence',
      'violence/graphic',
    ]
  }

  /**
   * Normalize category names to standard format
   */
  protected normalizeCategories(categories: Record<string, boolean>): Record<string, boolean> {
    const normalized: Record<string, boolean> = {}
    
    Object.entries(categories).forEach(([category, flagged]) => {
      // Convert to lowercase and replace underscores with forward slashes
      const standardCategory = category.toLowerCase().replace(/_/g, '/')
      normalized[standardCategory] = flagged
    })

    return normalized
  }

  /**
   * Apply custom thresholds to category scores
   */
  protected applyCustomThresholds(
    categoryScores: Record<string, number>,
    thresholds: Record<string, number> = {}
  ): Record<string, boolean> {
    const categories: Record<string, boolean> = {}

    Object.entries(categoryScores).forEach(([category, score]) => {
      const threshold = thresholds[category] || 0.5 // Default threshold
      categories[category] = score >= threshold
    })

    return categories
  }
}