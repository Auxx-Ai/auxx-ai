// packages/lib/src/datasets/types/embedding.types.ts

/**
 * Options for embedding generation
 */
export interface EmbeddingOptions {
  organizationId: string
  userId?: string
  provider?: string // Uses existing SupportedProvider type
  model?: string
  batchSize?: number
  cacheEnabled?: boolean
}

/**
 * Result of single embedding generation
 */
export interface EmbeddingResult {
  embedding: number[]
  model: string
  provider: string
  tokenCount?: number
}

/**
 * Result of batch embedding generation
 */
export interface BatchEmbeddingResult {
  embeddings: number[][]
  model: string
  provider: string
  totalTokens?: number
  errors: EmbeddingError[]
}

/**
 * Embedding generation error
 */
export interface EmbeddingError {
  index: number
  error: string
  text?: string
}

/**
 * Usage metrics for embedding operations
 */
export interface EmbeddingUsageMetrics {
  totalRequests: number
  successfulRequests: number
  failedRequests: number
  totalTokens: number
  averageLatency: number
  provider: string
  model: string
}

/**
 * Provider-specific configuration
 */
export interface EmbeddingProviderConfig {
  maxBatchSize: number
  maxTokens: number
  defaultModel: string
  supportedModels: string[]
}

/**
 * Cache entry for embeddings
 */
export interface CachedEmbedding {
  embedding: number[]
  model: string
  provider: string
  createdAt: Date
  tokenCount?: number
}

/**
 * Embedding service error class
 */
export class EmbeddingServiceError extends Error {
  constructor(
    message: string,
    public provider?: string,
    public model?: string,
    public code?: string
  ) {
    super(message)
    this.name = 'EmbeddingServiceError'
  }
}
