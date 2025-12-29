// packages/lib/src/datasets/services/embedding-service.ts

import { ProviderRegistry } from '../../ai/providers/provider-registry'
import { ProviderManager } from '../../ai/providers/provider-manager'
import {
  SmartChunkingService,
  type ChunkingOptions,
} from '../../ai/services/smart-chunking-service'
import { ModelType, type CredentialSourceType, type ProviderTypeValue } from '../../ai/providers/types'
import { TextEmbeddingClient } from '../../ai/clients/base/text-embedding-client'
import { createScopedLogger } from '@auxx/logger'
import { UsageTrackingService } from '../../ai/usage/usage-tracking-service'
import { SystemUserService } from '../../users/system-user-service'
import { QuotaExceededError } from '../../ai/orchestrator/types'
import {
  isSupportedDimension,
  normalizeToSupportedDimension,
} from '../utils/embedding-columns'

const logger = createScopedLogger('EmbeddingService')

/**
 * Options for embedding generation
 */
export interface EmbeddingOptions {
  modelId?: string // "provider:model" format (e.g., "openai:text-embedding-3-small")
  dimensions?: number
  batchSize?: number
  enableChunking?: boolean
  chunkingOptions?: Partial<ChunkingOptions>
  trackUsage?: boolean
}

/**
 * Result of embedding generation
 */
export interface EmbeddingResult {
  embeddings: number[][]
  model: string
  provider: string
  usage?: {
    inputTokens: number
    totalTokens: number
    chunks?: number
  }
  metadata?: {
    chunked: boolean
    originalCount: number
    processedCount: number
  }
}

/**
 * Modern embedding service with smart chunking and multi-provider support
 */
export class EmbeddingService {
  private providerManager: ProviderManager
  private usageTracker?: UsageTrackingService

  constructor(
    private db: any,
    private organizationId: string,
    private userId?: string
  ) {
    this.providerManager = new ProviderManager(db, organizationId, userId || 'system')
    this.usageTracker = new UsageTrackingService(db)
  }

  /**
   * Generate embeddings with automatic provider selection and chunking
   */
  async generateEmbeddings(
    texts: string | string[],
    options?: EmbeddingOptions
  ): Promise<EmbeddingResult> {
    const startTime = Date.now()
    const inputTexts = Array.isArray(texts) ? texts : [texts]

    // Validate dimension is supported for database storage
    let validatedOptions = options
    if (options?.dimensions && !isSupportedDimension(options.dimensions)) {
      const normalized = normalizeToSupportedDimension(options.dimensions)
      logger.warn('Requested dimension not supported for storage, normalizing', {
        requested: options.dimensions,
        normalized,
      })
      validatedOptions = { ...options, dimensions: normalized }
    }

    try {
      // Get provider and model
      const { provider, model } = await this.resolveProviderAndModel(validatedOptions)

      logger.info('Generating embeddings', {
        provider,
        model,
        textCount: inputTexts.length,
        dimensions: validatedOptions?.dimensions,
        enableChunking: validatedOptions?.enableChunking !== false,
      })

      // Get embedding client WITH credential metadata for quota tracking
      const { client, providerType, credentialSource } = await this.getEmbeddingClient(
        provider,
        model
      )

      // Pre-flight quota check for SYSTEM providers (throws QuotaExceededError if exhausted)
      await this.checkQuotaForSystemProvider(provider, providerType)

      // Apply smart chunking if enabled
      let processedTexts = inputTexts
      let chunkMapping: { originalIndex: number; chunkIndices: number[] }[] = []
      let wasChunked = false

      if (validatedOptions?.enableChunking !== false) {
        const chunkingResult = await this.applySmartChunking(
          inputTexts,
          provider,
          model,
          validatedOptions?.chunkingOptions
        )
        processedTexts = chunkingResult.texts
        chunkMapping = chunkingResult.mapping
        wasChunked = chunkingResult.wasChunked
      }

      // Generate embeddings
      const response = await client.batchInvoke({
        texts: processedTexts,
        model,
        dimensions: validatedOptions?.dimensions,
        batchSize: validatedOptions?.batchSize,
      })

      // Aggregate chunked embeddings if necessary
      let finalEmbeddings = response.embeddings
      if (wasChunked && chunkMapping.length > 0) {
        finalEmbeddings = this.aggregateChunkedEmbeddings(
          response.embeddings,
          chunkMapping,
          processedTexts
        )
      }

      // Track usage with proper providerType (only SYSTEM will deduct quota)
      if (validatedOptions?.trackUsage !== false && this.usageTracker) {
        await this.trackUsage({
          provider,
          model,
          inputTokens: response.usage.prompt_tokens,
          processingTime: Date.now() - startTime,
          providerType,
          credentialSource,
        })
      }

      return {
        embeddings: finalEmbeddings,
        model,
        provider,
        usage: {
          inputTokens: response.usage.prompt_tokens,
          totalTokens: response.usage.total_tokens,
          chunks: processedTexts.length,
        },
        metadata: wasChunked
          ? {
              chunked: true,
              originalCount: inputTexts.length,
              processedCount: processedTexts.length,
            }
          : undefined,
      }
    } catch (error) {
      const processingTime = Date.now() - startTime
      const errorMessage = error instanceof Error ? error.message : 'Unknown error'

      logger.error('Embedding generation failed', {
        error: errorMessage,
        organizationId: this.organizationId,
        textCount: inputTexts.length,
        processingTime,
      })

      throw new Error(`Failed to generate embedding: ${errorMessage}`)
    }
  }

  /**
   * Generate single embedding (convenience method)
   */
  async generateSingle(text: string, options?: EmbeddingOptions): Promise<number[]> {
    const result = await this.generateEmbeddings([text], options)
    return result.embeddings[0] || []
  }

  /**
   * Generate batch embeddings (convenience method)
   */
  async generateBatch(texts: string[], options?: EmbeddingOptions): Promise<number[][]> {
    const result = await this.generateEmbeddings(texts, options)
    return result.embeddings
  }

  /**
   * Get embedding dimensions for a model ID
   * @param modelId - Model ID in "provider:model" format
   * @returns The default dimensions for this model
   */
  getModelDimensions(modelId: string): number {
    const [, ...modelParts] = modelId.split(':')
    const model = modelParts.join(':')

    if (!model) {
      return 1536 // Default fallback
    }

    return EmbeddingService.MODEL_DIMENSIONS[model] ?? 1536
  }

  /**
   * Model dimension mappings for common embedding models
   */
  private static MODEL_DIMENSIONS: Record<string, number> = {
    // OpenAI models
    'text-embedding-3-small': 1536,
    'text-embedding-3-large': 3072,
    'text-embedding-ada-002': 1536,
    // Google models
    'text-embedding-004': 768,
    'textembedding-gecko@001': 768,
    'textembedding-gecko@003': 768,
    // Cohere models
    'embed-english-v3.0': 1024,
    'embed-multilingual-v3.0': 1024,
    // HuggingFace models
    'sentence-transformers/all-MiniLM-L6-v2': 384,
    'sentence-transformers/all-mpnet-base-v2': 768,
  }

  /**
   * Apply smart chunking to texts
   */
  private async applySmartChunking(
    texts: string[],
    provider: string,
    model: string,
    chunkingOptions?: Partial<ChunkingOptions>
  ) {
    const allChunks: string[] = []
    const mapping: { originalIndex: number; chunkIndices: number[] }[] = []
    let wasChunked = false

    for (let i = 0; i < texts.length; i++) {
      const result = await SmartChunkingService.chunkText(texts[i], {
        provider,
        model,
        ...chunkingOptions,
      })

      const startIdx = allChunks.length
      allChunks.push(...result.chunks)
      const endIdx = allChunks.length

      mapping.push({
        originalIndex: i,
        chunkIndices: Array.from({ length: endIdx - startIdx }, (_, idx) => startIdx + idx),
      })

      if (result.chunks.length > 1) {
        wasChunked = true
      }
    }

    return { texts: allChunks, mapping, wasChunked }
  }

  /**
   * Aggregate embeddings from chunks with weighted averaging
   */
  private aggregateChunkedEmbeddings(
    embeddings: number[][],
    mapping: { originalIndex: number; chunkIndices: number[] }[],
    texts: string[]
  ): number[][] {
    return mapping.map(({ chunkIndices }) => {
      if (chunkIndices.length === 1) {
        return embeddings[chunkIndices[0]]
      }

      // Weighted average by text length (token count proxy)
      const chunkEmbeddings = chunkIndices.map((idx) => embeddings[idx])
      const chunkWeights = chunkIndices.map((idx) => Math.max(1, texts[idx]?.length || 1))
      const dimensions = chunkEmbeddings[0].length
      const averaged = new Array(dimensions).fill(0)
      let totalWeight = 0

      for (let i = 0; i < chunkEmbeddings.length; i++) {
        const weight = chunkWeights[i]
        const embedding = chunkEmbeddings[i]
        totalWeight += weight

        for (let d = 0; d < dimensions; d++) {
          averaged[d] += embedding[d] * weight
        }
      }

      for (let d = 0; d < dimensions; d++) {
        averaged[d] /= totalWeight
      }

      return averaged
    })
  }

  /**
   * Resolve provider and model from options
   * Parses modelId in "provider:model" format, or falls back to system default
   */
  private async resolveProviderAndModel(options?: EmbeddingOptions) {
    if (options?.modelId) {
      const [provider, ...modelParts] = options.modelId.split(':')
      const model = modelParts.join(':')
      if (provider && model) {
        return { provider, model }
      }
    }

    // Fall back to system default for TEXT_EMBEDDING
    return this.getDefaultEmbeddingProvider()
  }

  /**
   * Get embedding client for provider and model with credential metadata
   * @returns Client and credential metadata for quota tracking
   */
  private async getEmbeddingClient(
    provider: string,
    model: string
  ): Promise<{
    client: TextEmbeddingClient
    providerType: ProviderTypeValue
    credentialSource: CredentialSourceType
  }> {
    try {
      // Get effective userId with fallback
      const effectiveUserId =
        this.userId || (await SystemUserService.getSystemUserForActions(this.organizationId))

      // Create provider client using registry
      const providerClient = await ProviderRegistry.createClient(
        provider,
        this.organizationId,
        effectiveUserId
      )

      // Get credentials WITH metadata for quota tracking (don't obfuscate - we need real credentials)
      const credentialsResponse = await this.providerManager.getCurrentCredentials(
        provider,
        model,
        ModelType.TEXT_EMBEDDING,
        false // Don't obfuscate - we need real credentials
      )

      // Get specialized embedding client
      const embeddingClient = providerClient.getClient(
        ModelType.TEXT_EMBEDDING,
        credentialsResponse.credentials
      )

      if (!embeddingClient) {
        throw new Error(`No embedding client available for provider: ${provider}`)
      }

      return {
        client: embeddingClient as TextEmbeddingClient,
        providerType: credentialsResponse.providerType || 'CUSTOM',
        credentialSource: credentialsResponse.credentialSource || 'CUSTOM',
      }
    } catch (error) {
      logger.error('Failed to get embedding client', {
        error: error instanceof Error ? error.message : error,
        provider,
        model,
      })
      throw error
    }
  }

  /**
   * Check if quota is available for SYSTEM provider type
   * Only validates quota for SYSTEM providers - CUSTOM providers bypass quota checks
   * @throws QuotaExceededError if quota is exhausted for SYSTEM provider
   */
  private async checkQuotaForSystemProvider(
    provider: string,
    providerType: ProviderTypeValue,
    estimatedCredits: number = 1
  ): Promise<void> {
    // Only check quota for SYSTEM providers
    if (providerType !== 'SYSTEM') {
      return
    }

    if (!this.usageTracker) {
      logger.warn('Usage tracker not available, skipping quota check')
      return
    }

    const quotaCheck = await this.usageTracker.checkQuotaAvailable(
      this.organizationId,
      provider,
      estimatedCredits
    )

    if (!quotaCheck.available) {
      throw new QuotaExceededError(
        quotaCheck.reason || 'Embedding quota exceeded',
        provider,
        this.organizationId,
        estimatedCredits
      )
    }
  }

  /**
   * Get default embedding provider for organization using SystemModelService
   */
  private async getDefaultEmbeddingProvider(): Promise<{ provider: string; model: string }> {
    try {
      const { SystemModelService } = await import('../../ai/providers/system-model-service')
      const systemModelService = new SystemModelService(this.db, this.organizationId)
      const systemDefault = await systemModelService.getDefault(ModelType.TEXT_EMBEDDING)

      if (systemDefault) {
        return { provider: systemDefault.provider, model: systemDefault.model }
      }

      // Fallback to OpenAI as app-level default
      return { provider: 'openai', model: 'text-embedding-3-small' }
    } catch (error) {
      logger.warn('Failed to get default embedding provider, using OpenAI fallback', {
        error: error instanceof Error ? error.message : error,
        organizationId: this.organizationId,
      })
      return { provider: 'openai', model: 'text-embedding-3-small' }
    }
  }

  /**
   * Track usage for embedding generation using modern trackUsage interface
   * Embeddings use creditsUsed: 0 - tracked for analytics but don't consume credits
   */
  private async trackUsage({
    provider,
    model,
    inputTokens,
    processingTime,
    providerType,
    credentialSource,
  }: {
    provider: string
    model: string
    inputTokens: number
    processingTime: number
    providerType: ProviderTypeValue
    credentialSource: CredentialSourceType
  }) {
    try {
      // Resolve userId if not provided
      const userId =
        this.userId || (await SystemUserService.getSystemUserForActions(this.organizationId))

      // Use modern trackUsage - embeddings use 0 credits (tracked but not charged)
      await this.usageTracker?.trackUsage({
        organizationId: this.organizationId,
        userId,
        provider,
        model,
        usage: {
          prompt_tokens: inputTokens,
          completion_tokens: 0, // Embeddings don't have output tokens
          total_tokens: inputTokens,
        },
        context: 'embedding',
        timestamp: new Date(),
        metadata: {
          processingTime,
          modelType: 'text-embedding',
        },
        providerType,
        credentialSource,
        creditsUsed: 0, // Embeddings are free - tracked for analytics but don't consume credits
        // Source tracking for embeddings
        source: 'dataset',
      })
    } catch (error) {
      logger.warn('Failed to track embedding usage', {
        error: error instanceof Error ? error.message : error,
        provider,
        model,
      })
    }
  }
}
