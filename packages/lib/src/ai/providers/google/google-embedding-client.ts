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
    const batchLimits: Record<string, number> = {
      'gemini-embedding-2-preview': 100,
      'gemini-embedding-001': 100,
      'text-embedding-004': 100,
      'textembedding-gecko@003': 50,
    }

    return batchLimits[model] || 100
  }

  /**
   * Estimate tokens for Google models (approximate)
   */
  private estimateTokens(text: string): number {
    // Google models typically have ~4 characters per token
    return Math.ceil(text.length / 4)
  }

  private convertUsage(totalTokens: number): UsageMetrics {
    return {
      prompt_tokens: totalTokens,
      completion_tokens: 0,
      total_tokens: totalTokens,
    }
  }

  /**
   * Get supported embedding models
   */
  getSupportedModels(): string[] {
    return ['gemini-embedding-2-preview', 'gemini-embedding-001']
  }

  /**
   * Get default dimensions for a model
   */
  getDefaultDimensions(model: string): number {
    const dimensionMap: Record<string, number> = {
      'gemini-embedding-2-preview': 3072,
      'gemini-embedding-001': 768,
    }

    return dimensionMap[model] || 768
  }

  /**
   * Get maximum input length for a model
   */
  getMaxInputLength(model: string): number {
    const lengthMap: Record<string, number> = {
      'gemini-embedding-2-preview': 8192,
      'gemini-embedding-001': 2048,
    }

    return lengthMap[model] || 2048
  }

  /**
   * Check if model supports custom dimensions
   * Both current Gemini embedding models support Matryoshka dimensions (128-3072)
   */
  supportsCustomDimensions(model: string): boolean {
    return model === 'gemini-embedding-2-preview' || model === 'gemini-embedding-001'
  }

  /**
   * Validate model and dimensions compatibility
   */
  protected validateModelDimensions(model: string, dimensions?: number): void {
    const supported = this.getSupportedModels()
    if (!supported.includes(model)) {
      throw new Error(`Unsupported Google embedding model: ${model}`)
    }

    if (dimensions && this.supportsCustomDimensions(model)) {
      const validDimensions = [128, 256, 512, 768, 1536, 3072]
      if (!validDimensions.includes(dimensions)) {
        throw new Error(
          `Invalid dimensions ${dimensions} for ${model}. Valid options: ${validDimensions.join(', ')}`
        )
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
