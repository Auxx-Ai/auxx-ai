// packages/lib/src/ai/providers/anthropic/voyage-embedding-client.ts

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
 * Voyage AI embedding client (accessed via Anthropic provider)
 */
export class VoyageEmbeddingClient extends TextEmbeddingClient {
  private apiKey: string
  private baseUrl = 'https://api.voyageai.com/v1'

  constructor(
    credentials: { apiKey: string },
    config: ClientConfig,
    logger?: Logger
  ) {
    super(config, 'Voyage-Embedding', logger)
    this.apiKey = credentials.apiKey
  }

  async invoke(params: EmbeddingParams): Promise<EmbeddingResponse> {
    this.validateEmbeddingParams(params)
    
    const startTime = this.getTimestamp()
    
    this.logOperationStart('Voyage embedding invoke', {
      model: params.model,
      textType: typeof params.text,
      textCount: Array.isArray(params.text) ? params.text.length : 1,
    })

    try {
      return await this.withRetryAndCircuitBreaker(async () => {
        const texts = Array.isArray(params.text) ? params.text : [params.text]
        
        const requestBody = {
          input: texts,
          model: params.model,
          input_type: this.getInputType(params.purpose),
        }

        // Add truncate option for better handling of long texts
        if (this.shouldTruncate(params.model)) {
          requestBody.truncate = true
        }

        const response = await fetch(`${this.baseUrl}/embeddings`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(requestBody),
        })

        if (!response.ok) {
          const errorData = await response.text()
          throw new Error(`Voyage API error: ${response.status} - ${errorData}`)
        }

        const data = await response.json()

        const embeddings = data.data.map((item: any) => item.embedding)
        const usage = this.convertVoyageUsage(data.usage)

        return {
          embeddings,
          model: data.model || params.model,
          usage,
        }
      }, {
        operation: 'voyage_embedding_invoke',
        model: params.model,
      })
    } catch (error) {
      this.handleApiError(error, 'invoke')
    } finally {
      this.logOperationSuccess('Voyage embedding invoke', this.getTimestamp() - startTime, {
        model: params.model,
      })
    }
  }

  async batchInvoke(params: BatchEmbeddingParams): Promise<BatchEmbeddingResponse> {
    const { texts, batchSize, ...singleParams } = params
    const effectiveBatchSize = batchSize || this.getVoyageBatchSize(params.model)
    
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
   * Get Voyage-specific batch size based on model
   */
  private getVoyageBatchSize(model: string): number {
    // Voyage models have generous batch limits
    const batchLimits: Record<string, number> = {
      'voyage-2': 128,
      'voyage-large-2': 128,
      'voyage-code-2': 128,
      'voyage-large-2-instruct': 128,
    }

    return batchLimits[model] || 128
  }

  /**
   * Get input type for Voyage embeddings
   */
  private getInputType(purpose?: string): string {
    switch (purpose?.toLowerCase()) {
      case 'search':
      case 'retrieval':
        return 'document'
      case 'query':
        return 'query'
      case 'classification':
        return 'classification'
      case 'clustering':
        return 'clustering'
      default:
        return 'document'
    }
  }

  /**
   * Check if model should use truncation
   */
  private shouldTruncate(model: string): boolean {
    // Enable truncation for better handling of long texts
    return true
  }

  private convertVoyageUsage(usage: any): UsageMetrics {
    return {
      prompt_tokens: usage?.total_tokens || 0,
      completion_tokens: 0, // Embeddings don't have completion tokens
      total_tokens: usage?.total_tokens || 0,
    }
  }

  /**
   * Get supported embedding models
   */
  getSupportedModels(): string[] {
    return [
      'voyage-2',
      'voyage-large-2',
      'voyage-code-2',
      'voyage-large-2-instruct',
    ]
  }

  /**
   * Get default dimensions for a model
   */
  getDefaultDimensions(model: string): number {
    const dimensionMap: Record<string, number> = {
      'voyage-2': 1024,
      'voyage-large-2': 1536,
      'voyage-code-2': 1536,
      'voyage-large-2-instruct': 1024,
    }

    return dimensionMap[model] || 1024
  }

  /**
   * Get maximum input length for a model
   */
  getMaxInputLength(model: string): number {
    const lengthMap: Record<string, number> = {
      'voyage-2': 4000,
      'voyage-large-2': 16000,
      'voyage-code-2': 16000,
      'voyage-large-2-instruct': 4000,
    }

    return lengthMap[model] || 4000
  }

  /**
   * Check if model supports custom dimensions
   */
  supportsCustomDimensions(model: string): boolean {
    return false // Voyage models have fixed dimensions
  }

  /**
   * Validate model and dimensions compatibility
   */
  protected validateModelDimensions(model: string, dimensions?: number): void {
    if (!this.getSupportedModels().includes(model)) {
      throw new Error(`Unsupported Voyage embedding model: ${model}`)
    }

    if (dimensions && !this.supportsCustomDimensions(model)) {
      throw new Error(`Voyage model ${model} does not support custom dimensions`)
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
      const estimatedTokens = Math.ceil(text.length / 4) // Rough estimation
      if (estimatedTokens > maxLength) {
        this.logger.warn('Text may exceed Voyage model token limit', {
          textLength: text.length,
          estimatedTokens,
          maxTokens: maxLength,
          model: params.model,
        })
      }
    }
  }
}