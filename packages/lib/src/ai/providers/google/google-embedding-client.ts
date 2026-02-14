// packages/lib/src/ai/providers/google/google-embedding-client.ts

import { type GoogleGenerativeAI, TaskType } from '@google/generative-ai'
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
 * Google specialized text embedding client
 */
export class GoogleTextEmbeddingClient extends TextEmbeddingClient {
  constructor(
    private apiClient: GoogleGenerativeAI,
    config: ClientConfig,
    logger?: Logger
  ) {
    super(config, 'Google-Embedding', logger)
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
          const texts = Array.isArray(params.text) ? params.text : [params.text]

          const model = this.apiClient.getGenerativeModel({
            model: params.model,
          })

          const embeddings: number[][] = []
          let totalTokens = 0

          // Google embedding API processes texts individually or in small batches
          const batchSize = this.getGoogleBatchSize(params.model)

          for (let i = 0; i < texts.length; i += batchSize) {
            const batch = texts.slice(i, i + batchSize)

            if (batch.length === 1) {
              // Single text embedding
              const result = await model.embedContent(batch[0])
              embeddings.push(result.embedding.values)
            } else {
              // Batch embedding
              const results = await model.batchEmbedContents(
                batch.map((text) => ({ content: { parts: [{ text }] } }))
              )

              for (const result of results.embeddings) {
                embeddings.push(result.values)
              }
            }

            // Estimate tokens (Google doesn't provide exact counts)
            totalTokens += batch.reduce((sum, text) => sum + this.estimateTokens(text), 0)
          }

          const usage = this.convertUsage(totalTokens)

          return {
            embeddings,
            model: params.model,
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
    const { texts, batchSize, ...singleParams } = params
    const effectiveBatchSize = batchSize || this.getGoogleBatchSize(params.model)

    if (texts.length <= effectiveBatchSize) {
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

  /**
   * Get Google-specific batch size based on model
   */
  private getGoogleBatchSize(model: string): number {
    // Google Vertex AI embedding models have specific batch limits
    const batchLimits: Record<string, number> = {
      'text-embedding-004': 100,
      'textembedding-gecko@003': 50,
      'textembedding-gecko@002': 50,
      'textembedding-gecko@001': 50,
    }

    return batchLimits[model] || 50 // Conservative default
  }

  /**
   * Estimate tokens for Google models (approximate)
   */
  private estimateTokens(text: string): number {
    // Google models typically have ~4 characters per token
    // This is an approximation since Google doesn't provide exact token counts
    return Math.ceil(text.length / 4)
  }

  private convertUsage(totalTokens: number): UsageMetrics {
    return {
      prompt_tokens: totalTokens,
      completion_tokens: 0, // Embeddings don't have completion tokens
      total_tokens: totalTokens,
    }
  }

  /**
   * Get supported embedding models
   */
  getSupportedModels(): string[] {
    return [
      'text-embedding-004',
      'textembedding-gecko@003',
      'textembedding-gecko@002',
      'textembedding-gecko@001',
    ]
  }

  /**
   * Get default dimensions for a model
   */
  getDefaultDimensions(model: string): number {
    const dimensionMap: Record<string, number> = {
      'text-embedding-004': 768,
      'textembedding-gecko@003': 768,
      'textembedding-gecko@002': 768,
      'textembedding-gecko@001': 768,
    }

    return dimensionMap[model] || 768
  }

  /**
   * Get maximum input length for a model
   */
  getMaxInputLength(model: string): number {
    const lengthMap: Record<string, number> = {
      'text-embedding-004': 2048,
      'textembedding-gecko@003': 3072,
      'textembedding-gecko@002': 3072,
      'textembedding-gecko@001': 3072,
    }

    return lengthMap[model] || 2048
  }

  /**
   * Check if model supports custom dimensions (Google models generally don't)
   */
  supportsCustomDimensions(model: string): boolean {
    return false // Google embedding models have fixed dimensions
  }

  /**
   * Validate model and dimensions compatibility
   */
  protected validateModelDimensions(model: string, dimensions?: number): void {
    if (!this.getSupportedModels().includes(model)) {
      throw new Error(`Unsupported Google embedding model: ${model}`)
    }

    if (dimensions && !this.supportsCustomDimensions(model)) {
      throw new Error(`Google model ${model} does not support custom dimensions`)
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
      const estimatedTokens = this.estimateTokens(text)
      if (estimatedTokens > maxLength) {
        this.logger.warn('Text may exceed Google model token limit', {
          textLength: text.length,
          estimatedTokens,
          maxTokens: maxLength,
          model: params.model,
        })
      }
    }
  }

  /**
   * Get task type for Google embedding (used for different use cases)
   */
  private getTaskType(purpose?: string): TaskType {
    // Map common purposes to Google task types
    switch (purpose?.toLowerCase()) {
      case 'search':
      case 'retrieval':
        return TaskType.RETRIEVAL_DOCUMENT
      case 'query':
        return TaskType.RETRIEVAL_QUERY
      case 'classification':
        return TaskType.CLASSIFICATION
      case 'clustering':
        return TaskType.CLUSTERING
      default:
        return TaskType.RETRIEVAL_DOCUMENT
    }
  }
}
