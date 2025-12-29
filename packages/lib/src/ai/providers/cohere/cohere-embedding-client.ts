// packages/lib/src/ai/providers/cohere/cohere-embedding-client.ts

import { CohereClient } from 'cohere-ai'
import { TextEmbeddingClient } from '../../clients/base/text-embedding-client'
import type {
  ClientConfig,
  EmbeddingParams,
  EmbeddingResponse,
  BatchEmbeddingParams,
  BatchEmbeddingResponse,
  UsageMetrics,
} from '../../clients/base/types'
import { createScopedLogger, Logger } from '../../../logger'

/**
 * Cohere specialized text embedding client
 */
export class CohereTextEmbeddingClient extends TextEmbeddingClient {
  constructor(
    private apiClient: CohereClient,
    config: ClientConfig,
    logger?: Logger
  ) {
    super(config, 'Cohere-Embedding', logger)
  }

  async invoke(params: EmbeddingParams): Promise<EmbeddingResponse> {
    this.validateEmbeddingParams(params)
    
    const startTime = this.getTimestamp()
    
    this.logOperationStart('Cohere embedding invoke', {
      model: params.model,
      textType: typeof params.text,
      textCount: Array.isArray(params.text) ? params.text.length : 1,
    })

    try {
      return await this.withRetryAndCircuitBreaker(async () => {
        const texts = Array.isArray(params.text) ? params.text : [params.text]
        
        const response = await this.apiClient.embed({
          texts,
          model: params.model,
          inputType: this.getInputType(params.purpose),
          embeddingTypes: ['float'], // Use float embeddings
          truncate: 'END', // Truncate from end if text is too long
        })

        const embeddings = response.embeddings.float || []
        const usage = this.convertCohereUsage(response.meta)

        return {
          embeddings,
          model: params.model,
          usage,
        }
      }, {
        operation: 'cohere_embedding_invoke',
        model: params.model,
      })
    } catch (error) {
      this.handleApiError(error, 'invoke')
    } finally {
      this.logOperationSuccess('Cohere embedding invoke', this.getTimestamp() - startTime, {
        model: params.model,
      })
    }
  }

  async batchInvoke(params: BatchEmbeddingParams): Promise<BatchEmbeddingResponse> {
    const { texts, batchSize, ...singleParams } = params
    const effectiveBatchSize = batchSize || this.getCohereBatchSize(params.model)
    
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
    return await this.defaultBatchInvoke({
      ...params,
      batchSize: effectiveBatchSize,
    })
  }

  /**
   * Get Cohere-specific batch size based on model
   */
  private getCohereBatchSize(model: string): number {
    // Cohere models have moderate batch limits
    const batchLimits: Record<string, number> = {
      'embed-english-v3.0': 96,
      'embed-multilingual-v3.0': 96,
      'embed-english-light-v3.0': 96,
      'embed-multilingual-light-v3.0': 96,
      'embed-english-v2.0': 96,
      'embed-english-light-v2.0': 96,
    }

    return batchLimits[model] || 96
  }

  /**
   * Get input type for Cohere embeddings
   */
  private getInputType(purpose?: string): 'search_document' | 'search_query' | 'classification' | 'clustering' {
    switch (purpose?.toLowerCase()) {
      case 'search':
      case 'retrieval':
        return 'search_document'
      case 'query':
        return 'search_query'
      case 'classification':
        return 'classification'
      case 'clustering':
        return 'clustering'
      default:
        return 'search_document'
    }
  }

  private convertCohereUsage(meta: any): UsageMetrics {
    const billedUnits = meta?.billedUnits || {}
    const inputTokens = billedUnits.inputTokens || 0
    
    return {
      prompt_tokens: inputTokens,
      completion_tokens: 0, // Embeddings don't have completion tokens
      total_tokens: inputTokens,
    }
  }

  /**
   * Get supported embedding models
   */
  getSupportedModels(): string[] {
    return [
      'embed-english-v3.0',
      'embed-multilingual-v3.0',
      'embed-english-light-v3.0',
      'embed-multilingual-light-v3.0',
      'embed-english-v2.0',
      'embed-english-light-v2.0',
    ]
  }

  /**
   * Get default dimensions for a model
   */
  getDefaultDimensions(model: string): number {
    const dimensionMap: Record<string, number> = {
      'embed-english-v3.0': 1024,
      'embed-multilingual-v3.0': 1024,
      'embed-english-light-v3.0': 384,
      'embed-multilingual-light-v3.0': 384,
      'embed-english-v2.0': 4096,
      'embed-english-light-v2.0': 1024,
    }

    return dimensionMap[model] || 1024
  }

  /**
   * Get maximum input length for a model (in tokens)
   */
  getMaxInputLength(model: string): number {
    const lengthMap: Record<string, number> = {
      'embed-english-v3.0': 512,
      'embed-multilingual-v3.0': 512,
      'embed-english-light-v3.0': 512,
      'embed-multilingual-light-v3.0': 512,
      'embed-english-v2.0': 512,
      'embed-english-light-v2.0': 512,
    }

    return lengthMap[model] || 512
  }

  /**
   * Check if model supports custom dimensions
   */
  supportsCustomDimensions(model: string): boolean {
    return false // Cohere models have fixed dimensions
  }

  /**
   * Check if model supports multilingual text
   */
  isMultilingual(model: string): boolean {
    return model.includes('multilingual')
  }

  /**
   * Validate model and dimensions compatibility
   */
  protected validateModelDimensions(model: string, dimensions?: number): void {
    if (!this.getSupportedModels().includes(model)) {
      throw new Error(`Unsupported Cohere embedding model: ${model}`)
    }

    if (dimensions && !this.supportsCustomDimensions(model)) {
      throw new Error(`Cohere model ${model} does not support custom dimensions`)
    }
  }

  /**
   * Override validation to include model-specific checks
   */
  protected validateEmbeddingParams(params: EmbeddingParams): void {
    super.validateEmbeddingParams(params)
    this.validateModelDimensions(params.model, params.dimensions)

    // Check input length (Cohere has strict token limits)
    const maxLength = this.getMaxInputLength(params.model)
    const texts = Array.isArray(params.text) ? params.text : [params.text]
    
    for (const text of texts) {
      const estimatedTokens = Math.ceil(text.length / 4) // Rough estimation
      if (estimatedTokens > maxLength) {
        this.logger.warn('Text exceeds Cohere model token limit, will be truncated', {
          textLength: text.length,
          estimatedTokens,
          maxTokens: maxLength,
          model: params.model,
        })
      }
    }

    // Validate batch size
    const textCount = Array.isArray(params.text) ? params.text.length : 1
    const maxBatchSize = this.getCohereBatchSize(params.model)
    if (textCount > maxBatchSize) {
      this.logger.info('Large batch will be processed in multiple requests', {
        textCount,
        maxBatchSize,
        model: params.model,
      })
    }
  }

  /**
   * Get model type (light vs standard)
   */
  isLightModel(model: string): boolean {
    return model.includes('light')
  }

  /**
   * Get model version
   */
  getModelVersion(model: string): string {
    if (model.includes('v3.0')) return 'v3.0'
    if (model.includes('v2.0')) return 'v2.0'
    return 'unknown'
  }
}