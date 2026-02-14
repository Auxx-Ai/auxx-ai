// packages/lib/src/ai/providers/openai/openai-embedding-client.ts

import type OpenAI from 'openai'
import type { Logger } from '../../../logger'
import { TextEmbeddingClient } from '../../clients/base/text-embedding-client'
import type {
  BatchEmbeddingParams,
  BatchEmbeddingResponse,
  ClientConfig,
  EmbeddingParams,
  EmbeddingResponse,
  UsageMetrics,
} from '../../clients/base/types'

/**
 * OpenAI specialized text embedding client
 */
export class OpenAITextEmbeddingClient extends TextEmbeddingClient {
  constructor(
    private apiClient: OpenAI,
    config: ClientConfig,
    logger?: Logger
  ) {
    super(config, 'OpenAI-Embedding', logger)
  }

  async invoke(params: EmbeddingParams): Promise<EmbeddingResponse> {
    this.validateEmbeddingParams(params)

    const startTime = this.getTimestamp()

    this.logOperationStart('Embedding invoke', {
      model: params.model,
      textType: typeof params.text,
      textCount: Array.isArray(params.text) ? params.text.length : 1,
    })

    try {
      return await this.withRetryAndCircuitBreaker(
        async () => {
          const requestParams: any = {
            model: params.model,
            input: params.text,
          }

          // Add dimensions if specified and supported
          if (params.dimensions) {
            requestParams.dimensions = params.dimensions
          }

          if (params.user) {
            requestParams.user = params.user
          }

          const response = await this.apiClient.embeddings.create(requestParams)

          const embeddings = response.data.map((item: any) => item.embedding)
          const usage = this.convertUsage(response.usage)

          return {
            embeddings,
            model: response.model,
            usage,
          }
        },
        {
          operation: 'embedding_invoke',
          model: params.model,
        }
      )
    } catch (error) {
      this.handleApiError(error, 'invoke')
    } finally {
      this.logOperationSuccess('Embedding invoke', this.getTimestamp() - startTime, {
        model: params.model,
      })
    }
  }

  async batchInvoke(params: BatchEmbeddingParams): Promise<BatchEmbeddingResponse> {
    const { texts, batchSize = 2048, ...singleParams } = params // OpenAI allows up to 2048 inputs

    if (texts.length <= batchSize) {
      // Single request can handle all texts
      const response = await this.invoke({
        ...singleParams,
        text: texts,
      })

      return {
        embeddings: response.embeddings,
        model: response.model,
        usage: response.usage,
        batchInfo: {
          totalBatches: 1,
          processedTexts: texts.length,
        },
      }
    }

    // Use default batch implementation for large batches
    return await this.defaultBatchInvoke(params)
  }

  private convertUsage(usage: any): UsageMetrics {
    return {
      prompt_tokens: usage?.prompt_tokens || 0,
      completion_tokens: 0, // Embeddings don't have completion tokens
      total_tokens: usage?.total_tokens || usage?.prompt_tokens || 0,
    }
  }

  /**
   * Get supported embedding models
   */
  getSupportedModels(): string[] {
    return ['text-embedding-3-small', 'text-embedding-3-large', 'text-embedding-ada-002']
  }

  /**
   * Get default dimensions for a model
   */
  getDefaultDimensions(model: string): number {
    const dimensionMap: Record<string, number> = {
      'text-embedding-3-small': 1536,
      'text-embedding-3-large': 3072,
      'text-embedding-ada-002': 1536,
    }

    return dimensionMap[model] || 1536
  }

  /**
   * Get maximum input length for a model
   */
  getMaxInputLength(model: string): number {
    // OpenAI embedding models typically support 8192 tokens
    return 8192
  }

  /**
   * Check if model supports custom dimensions
   */
  supportsCustomDimensions(model: string): boolean {
    return model.startsWith('text-embedding-3-')
  }

  /**
   * Validate model and dimensions compatibility
   */
  protected validateModelDimensions(model: string, dimensions?: number): void {
    if (!this.getSupportedModels().includes(model)) {
      throw new Error(`Unsupported embedding model: ${model}`)
    }

    if (dimensions && !this.supportsCustomDimensions(model)) {
      throw new Error(`Model ${model} does not support custom dimensions`)
    }

    if (dimensions) {
      const defaultDims = this.getDefaultDimensions(model)

      // For text-embedding-3 models, dimensions must be <= default
      if (model.startsWith('text-embedding-3-') && dimensions > defaultDims) {
        throw new Error(
          `Dimensions ${dimensions} exceeds maximum ${defaultDims} for model ${model}`
        )
      }

      // Minimum dimensions check
      if (dimensions < 1) {
        throw new Error('Dimensions must be at least 1')
      }
    }
  }

  /**
   * Override validation to include model-specific checks
   */
  protected validateEmbeddingParams(params: EmbeddingParams): void {
    super.validateEmbeddingParams(params)
    this.validateModelDimensions(params.model, params.dimensions)

    // Check input length
    const maxLength = this.getMaxInputLength(params.model)
    const texts = Array.isArray(params.text) ? params.text : [params.text]

    for (const text of texts) {
      if (text.length > maxLength * 4) {
        // Rough character to token ratio
        this.logger.warn('Text may exceed model token limit', {
          textLength: text.length,
          estimatedTokens: Math.ceil(text.length / 4),
          maxTokens: maxLength,
        })
      }
    }
  }
}
