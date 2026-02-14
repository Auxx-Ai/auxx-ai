// packages/lib/src/ai/clients/base/text-embedding-client.ts

import { BaseSpecializedClient } from './base-specialized-client'
import type {
  BatchEmbeddingParams,
  BatchEmbeddingResponse,
  ClientConfig,
  EmbeddingParams,
  EmbeddingResponse,
} from './types'

/**
 * Abstract base class for text embedding clients
 */
export abstract class TextEmbeddingClient extends BaseSpecializedClient {
  constructor(config: ClientConfig, clientName: string, logger?: any) {
    super(config, clientName, logger)
  }

  // ===== ABSTRACT METHODS =====

  /**
   * Generate embeddings for text input
   */
  abstract invoke(params: EmbeddingParams): Promise<EmbeddingResponse>

  /**
   * Batch embedding generation (optional - providers can override for efficiency)
   */
  batchInvoke?(params: BatchEmbeddingParams): Promise<BatchEmbeddingResponse>

  // ===== IMPLEMENTED METHODS =====

  /**
   * Validate embedding parameters
   */
  protected validateEmbeddingParams(params: EmbeddingParams): void {
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

    if (params.dimensions !== undefined) {
      if (!Number.isInteger(params.dimensions) || params.dimensions <= 0) {
        throw new Error('Dimensions must be a positive integer')
      }
    }
  }

  /**
   * Default batch implementation using multiple single requests
   */
  async defaultBatchInvoke(params: BatchEmbeddingParams): Promise<BatchEmbeddingResponse> {
    const { texts, batchSize = 100, ...singleParams } = params
    const allEmbeddings: number[][] = []
    const totalUsage = {
      prompt_tokens: 0,
      completion_tokens: 0,
      total_tokens: 0,
    }

    // Process in batches
    for (let i = 0; i < texts.length; i += batchSize) {
      const batch = texts.slice(i, i + batchSize)

      const response = await this.invoke({
        ...singleParams,
        text: batch,
      })

      allEmbeddings.push(...response.embeddings)
      totalUsage.prompt_tokens += response.usage.prompt_tokens
      totalUsage.completion_tokens += response.usage.completion_tokens
      totalUsage.total_tokens += response.usage.total_tokens
    }

    return {
      embeddings: allEmbeddings,
      model: params.model,
      usage: totalUsage,
      batchInfo: {
        totalBatches: Math.ceil(texts.length / batchSize),
        processedTexts: texts.length,
      },
    }
  }

  /**
   * Calculate cosine similarity between two embeddings
   */
  static calculateCosineSimilarity(embedding1: number[], embedding2: number[]): number {
    if (embedding1.length !== embedding2.length) {
      throw new Error('Embeddings must have the same length')
    }

    let dotProduct = 0
    let norm1 = 0
    let norm2 = 0

    for (let i = 0; i < embedding1.length; i++) {
      dotProduct += embedding1[i] * embedding2[i]
      norm1 += embedding1[i] * embedding1[i]
      norm2 += embedding2[i] * embedding2[i]
    }

    norm1 = Math.sqrt(norm1)
    norm2 = Math.sqrt(norm2)

    if (norm1 === 0 || norm2 === 0) {
      return 0
    }

    return dotProduct / (norm1 * norm2)
  }

  /**
   * Find most similar embeddings
   */
  static findMostSimilar(
    queryEmbedding: number[],
    embeddings: number[][],
    topK: number = 5
  ): Array<{ index: number; similarity: number }> {
    const similarities = embeddings.map((embedding, index) => ({
      index,
      similarity: TextEmbeddingClient.calculateCosineSimilarity(queryEmbedding, embedding),
    }))

    return similarities.sort((a, b) => b.similarity - a.similarity).slice(0, topK)
  }
}
