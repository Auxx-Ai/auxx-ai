// packages/lib/src/ai/providers/openai/openai-moderation-client.ts

import type OpenAI from 'openai'
import type { Logger } from '../../../logger'
import { ModerationClient } from '../../clients/base/moderation-client'
import type {
  ClientConfig,
  ModerationParams,
  ModerationResponse,
  ModerationResult,
  UsageMetrics,
} from '../../clients/base/types'

/**
 * OpenAI specialized content moderation client
 */
export class OpenAIModerationClient extends ModerationClient {
  constructor(
    private apiClient: OpenAI,
    config: ClientConfig,
    logger?: Logger
  ) {
    super(config, 'OpenAI-Moderation', logger)
  }

  async invoke(params: ModerationParams): Promise<ModerationResponse> {
    this.validateModerationParams(params)

    const startTime = this.getTimestamp()

    this.logOperationStart('Moderation invoke', {
      model: params.model,
      textType: typeof params.text,
      textCount: Array.isArray(params.text) ? params.text.length : 1,
    })

    try {
      return await this.withRetryAndCircuitBreaker(
        async () => {
          const requestParams: any = {
            input: params.text,
            model: params.model,
          }

          if (params.user) {
            requestParams.user = params.user
          }

          const response = await this.apiClient.moderations.create(requestParams)

          const results = response.results.map((result: any) =>
            this.processOpenAIModerationResult(result)
          )
          const usage = this.calculateUsage(params.text)

          return {
            results,
            model: response.model,
            usage,
          }
        },
        {
          operation: 'moderation_invoke',
          model: params.model,
        }
      )
    } catch (error) {
      this.handleApiError(error, 'invoke')
    } finally {
      this.logOperationSuccess('Moderation invoke', this.getTimestamp() - startTime, {
        model: params.model,
      })
    }
  }

  private processOpenAIModerationResult(result: any): ModerationResult {
    return {
      flagged: result.flagged,
      categories: this.normalizeCategories(result.categories),
      category_scores: this.normalizeCategoryScores(result.category_scores),
    }
  }

  private normalizeCategories(categories: Record<string, boolean>): Record<string, boolean> {
    // OpenAI categories are already in the correct format
    return categories
  }

  private normalizeCategoryScores(categoryScores: Record<string, number>): Record<string, number> {
    // OpenAI category scores are already in the correct format (0-1 range)
    return categoryScores
  }

  private calculateUsage(text: string | string[]): UsageMetrics {
    // OpenAI moderation typically charges per input token
    const texts = Array.isArray(text) ? text : [text]
    const totalLength = texts.reduce((sum, t) => sum + t.length, 0)
    const estimatedTokens = Math.ceil(totalLength / 4) // Rough estimation

    return {
      prompt_tokens: estimatedTokens,
      completion_tokens: 0, // Moderation doesn't produce text
      total_tokens: estimatedTokens,
    }
  }

  /**
   * Get supported moderation models
   */
  getSupportedModels(): string[] {
    return ['text-moderation-latest', 'text-moderation-stable']
  }

  /**
   * Get OpenAI moderation categories
   */
  getModerationCategories(): string[] {
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
   * Get category descriptions
   */
  getCategoryDescriptions(): Record<string, string> {
    return {
      hate: 'Content that expresses, incites, or promotes hate based on race, gender, ethnicity, religion, nationality, sexual orientation, disability status, or caste.',
      'hate/threatening':
        'Hateful content that also includes violence or serious harm towards the targeted group.',
      harassment:
        'Content that expresses, incites, or promotes harassing language towards any target.',
      'harassment/threatening':
        'Harassment content that also includes violence or serious harm towards any target.',
      'self-harm': 'Content that promotes, encourages, or depicts acts of self-harm.',
      'self-harm/intent':
        'Content where the speaker expresses that they are engaging or intend to engage in acts of self-harm.',
      'self-harm/instructions': 'Content that encourages performing acts of self-harm.',
      sexual: 'Content meant to arouse sexual excitement or promote sexual services.',
      'sexual/minors': 'Sexual content that includes an individual who is under 18 years old.',
      violence:
        'Content that promotes or glorifies violence or celebrates the suffering or humiliation of others.',
      'violence/graphic': 'Violent content that includes graphic material.',
    }
  }

  /**
   * Check if content is safe (not flagged)
   */
  isSafeContent(response: ModerationResponse): boolean {
    return !this.hasAnyFlagged(response.results)
  }

  /**
   * Get violation details
   */
  getViolationDetails(response: ModerationResponse): {
    totalViolations: number
    flaggedCategories: string[]
    highestRiskCategory: { category: string; score: number }
    riskAssessment: 'low' | 'medium' | 'high'
  } {
    const flaggedCategories = this.getFlaggedCategories(response.results)
    const highestSeverity = this.getHighestSeverityScore(response.results)

    // Find the category with highest score
    let highestCategory = ''
    let highestScore = 0

    for (const result of response.results) {
      Object.entries(result.category_scores).forEach(([category, score]) => {
        if (score > highestScore) {
          highestScore = score
          highestCategory = category
        }
      })
    }

    // Risk assessment based on highest severity
    let riskAssessment: 'low' | 'medium' | 'high'
    if (highestSeverity < 0.3) riskAssessment = 'low'
    else if (highestSeverity < 0.7) riskAssessment = 'medium'
    else riskAssessment = 'high'

    return {
      totalViolations: flaggedCategories.length,
      flaggedCategories,
      highestRiskCategory: {
        category: highestCategory,
        score: highestScore,
      },
      riskAssessment,
    }
  }

  /**
   * Batch moderate content with custom thresholds
   */
  async moderateWithCustomThresholds(
    texts: string[],
    model: string,
    categoryThresholds: Record<string, number> = {}
  ): Promise<
    Array<{
      text: string
      flagged: boolean
      customFlagged: boolean
      categories: Record<string, boolean>
      customCategories: Record<string, boolean>
      category_scores: Record<string, number>
    }>
  > {
    const response = await this.invoke({ text: texts, model })

    return texts.map((text, index) => {
      const result = response.results[index]
      const customCategories = this.applyCustomThresholds(
        result.category_scores,
        categoryThresholds
      )
      const customFlagged = Object.values(customCategories).some(Boolean)

      return {
        text,
        flagged: result.flagged,
        customFlagged,
        categories: result.categories,
        customCategories,
        category_scores: result.category_scores,
      }
    })
  }

  /**
   * Override validation to include OpenAI-specific checks
   */
  protected validateModerationParams(params: ModerationParams): void {
    super.validateModerationParams(params)

    if (!this.getSupportedModels().includes(params.model)) {
      throw new Error(`Unsupported moderation model: ${params.model}`)
    }

    // Check input length limits
    const texts = Array.isArray(params.text) ? params.text : [params.text]

    for (const text of texts) {
      if (text.length > 32768) {
        // OpenAI's typical character limit
        throw new Error(`Text too long: ${text.length} characters (max: 32768)`)
      }
    }

    // Check batch size
    if (texts.length > 1000) {
      throw new Error(`Too many texts: ${texts.length} (max: 1000 per request)`)
    }
  }
}
