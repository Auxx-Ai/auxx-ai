// packages/lib/src/ai/services/smart-chunking-service.ts

import { createScopedLogger } from '@auxx/logger'
import crypto from 'crypto'
import { LRUCache } from 'lru-cache'
import { TextChunker } from '../../datasets/processors/text-chunker'

const logger = createScopedLogger('SmartChunkingService')

/**
 * Chunking strategy configuration
 */
export interface ChunkingStrategy {
  type: 'character' | 'token' | 'semantic' | 'hybrid'
  preserveBoundaries?: boolean
  useModelSpecific?: boolean
}

/**
 * Options for text chunking
 */
export interface ChunkingOptions {
  model: string
  provider: string
  strategy?: ChunkingStrategy
  maxTokens?: number
  chunkOverlap?: number
  preserveSemantics?: boolean
  cacheResults?: boolean
}

/**
 * Result of text chunking
 */
export interface ChunkResult {
  chunks: string[]
  metadata: {
    originalLength: number
    chunkCount: number
    strategy: ChunkingStrategy
    averageChunkSize: number
    estimatedTokens: number[]
  }
}

/**
 * Smart chunking service with provider-aware token limits and intelligent text segmentation
 */
export class SmartChunkingService {
  private static chunkCache = new LRUCache<string, ChunkResult>({
    max: 1000,
    ttl: 1000 * 60 * 60, // 1 hour
  })

  /**
   * Get model-specific token limits with safety margins
   */
  static getModelTokenLimit(model: string, provider: string): number {
    // Model-specific overrides for known embedding models
    const embeddingLimits: Record<string, number> = {
      // OpenAI
      'text-embedding-ada-002': 8191,
      'text-embedding-3-small': 8191,
      'text-embedding-3-large': 8191,

      // Google
      'gemini-embedding-2-preview': 8192,
      'gemini-embedding-001': 2048,
      'text-embedding-004': 2048,
      'textembedding-gecko@003': 3072,

      // Cohere
      'embed-english-v3.0': 512,
      'embed-multilingual-v3.0': 512,

      // Voyage AI (via Anthropic)
      'voyage-2': 4000,
      'voyage-large-2': 16000,

      // Default per provider
      'openai:default': 8191,
      'google:default': 2048,
      'anthropic:default': 4000,
      'cohere:default': 512,
    }

    // Check specific model first, then provider default
    const limit = embeddingLimits[model] || embeddingLimits[`${provider}:default`] || 8000

    // Apply safety margin (90% of limit)
    return Math.floor(limit * 0.9)
  }

  /**
   * Smart chunking with multiple strategies
   */
  static async chunkText(text: string, options: ChunkingOptions): Promise<ChunkResult> {
    // Check cache if enabled
    if (options.cacheResults !== false) {
      const cacheKey = SmartChunkingService.getCacheKey(text, options)
      const cached = SmartChunkingService.chunkCache.get(cacheKey)
      if (cached) {
        logger.debug('Using cached chunks', { cacheKey })
        return cached
      }
    }

    const maxTokens =
      options.maxTokens || SmartChunkingService.getModelTokenLimit(options.model, options.provider)

    const estimatedTokens = SmartChunkingService.estimateTokens(text, options.model)

    // No chunking needed
    if (estimatedTokens <= maxTokens) {
      const result: ChunkResult = {
        chunks: [text],
        metadata: {
          originalLength: text.length,
          chunkCount: 1,
          strategy: { type: 'character' },
          averageChunkSize: text.length,
          estimatedTokens: [estimatedTokens],
        },
      }
      return result
    }

    // Select chunking strategy
    const strategy = options.strategy || SmartChunkingService.selectStrategy(text, options)

    let chunks: string[]
    switch (strategy.type) {
      case 'semantic':
        chunks = await SmartChunkingService.semanticChunking(text, maxTokens, options)
        break
      case 'token':
        chunks = await SmartChunkingService.tokenAwareChunking(text, maxTokens, options)
        break
      case 'hybrid':
        chunks = await SmartChunkingService.hybridChunking(text, maxTokens, options)
        break
      default:
        chunks = await SmartChunkingService.characterChunking(text, maxTokens, options)
    }

    const result: ChunkResult = {
      chunks,
      metadata: {
        originalLength: text.length,
        chunkCount: chunks.length,
        strategy,
        averageChunkSize: Math.floor(chunks.reduce((sum, c) => sum + c.length, 0) / chunks.length),
        estimatedTokens: chunks.map((c) => SmartChunkingService.estimateTokens(c, options.model)),
      },
    }

    // Cache result
    if (options.cacheResults !== false) {
      const cacheKey = SmartChunkingService.getCacheKey(text, options)
      SmartChunkingService.chunkCache.set(cacheKey, result)
    }

    logger.info('Text chunked successfully', {
      ...result.metadata,
      model: options.model,
      provider: options.provider,
    })

    return result
  }

  /**
   * Semantic-aware chunking using TextChunker
   */
  private static async semanticChunking(
    text: string,
    maxTokens: number,
    options: ChunkingOptions
  ): Promise<string[]> {
    const chunkSize = maxTokens * 3.5 // Approximate chars from tokens

    const chunker = new TextChunker()
    const chunks = await chunker.chunkText(text, {
      chunkSize: Math.floor(chunkSize),
      chunkOverlap: options.chunkOverlap || 200,
      preserveParagraphs: true,
      maxTokens,
    })

    return chunks.map((c) => c.content)
  }

  /**
   * Token-aware chunking with precise counting
   */
  private static async tokenAwareChunking(
    text: string,
    maxTokens: number,
    options: ChunkingOptions
  ): Promise<string[]> {
    // For now, fall back to character-based with better estimation
    return SmartChunkingService.characterChunking(text, maxTokens, options)
  }

  /**
   * Hybrid chunking combining multiple strategies
   */
  private static async hybridChunking(
    text: string,
    maxTokens: number,
    options: ChunkingOptions
  ): Promise<string[]> {
    // Try semantic first, fall back to character if chunks too large
    const semanticChunks = await SmartChunkingService.semanticChunking(text, maxTokens, options)

    const finalChunks: string[] = []
    for (const chunk of semanticChunks) {
      const tokens = SmartChunkingService.estimateTokens(chunk, options.model)
      if (tokens > maxTokens) {
        // Re-chunk this piece
        const subChunks = await SmartChunkingService.characterChunking(chunk, maxTokens, options)
        finalChunks.push(...subChunks)
      } else {
        finalChunks.push(chunk)
      }
    }

    return finalChunks
  }

  /**
   * Character-based chunking with intelligent boundaries
   */
  private static async characterChunking(
    text: string,
    maxTokens: number,
    options: ChunkingOptions
  ): Promise<string[]> {
    const targetChars = Math.floor(maxTokens * 3.5) // Conservative char to token ratio
    const overlap = Math.max(50, Math.min(500, Math.ceil(targetChars * 0.1))) // Dynamic overlap

    const chunks: string[] = []
    let position = 0

    while (position < text.length) {
      let chunkEnd = Math.min(position + targetChars, text.length)

      // Find optimal break point if not at end
      if (chunkEnd < text.length) {
        chunkEnd = SmartChunkingService.findBreakPoint(text, chunkEnd)
      }

      chunks.push(text.substring(position, chunkEnd))

      // Move position with overlap
      position = chunkEnd - overlap
      if (position >= text.length - overlap) {
        break
      }
    }

    return chunks
  }

  /**
   * Find optimal break point for chunk splitting with multi-language support
   */
  private static findBreakPoint(text: string, maxLength: number): number {
    // Try paragraph break
    const lastNewline = text.lastIndexOf('\n\n', maxLength)
    if (lastNewline > maxLength * 0.7) return lastNewline

    // Try sentence break with CJK support - FIXED regex patterns
    const punctuation = /[.!?。！？\n]/g
    let lastPunc = -1
    let match
    while ((match = punctuation.exec(text)) && match.index <= maxLength) {
      lastPunc = match.index + match[0].length
    }
    if (lastPunc > maxLength * 0.7) return lastPunc

    // Try word break
    const lastSpace = text.lastIndexOf(' ', maxLength)
    if (lastSpace > maxLength * 0.7) return lastSpace

    // Use Intl.Segmenter for better language support
    if (typeof Intl !== 'undefined' && Intl.Segmenter) {
      try {
        const segmenter = new Intl.Segmenter(undefined, { granularity: 'word' })
        const segments = Array.from(segmenter.segment(text.slice(0, maxLength)))
        if (segments.length > 1) {
          const lastSegment = segments[segments.length - 1]
          return lastSegment.index
        }
      } catch (e) {
        // Fallback if segmenter fails
      }
    }

    // Hard cut as last resort
    return maxLength
  }

  /**
   * Select optimal chunking strategy based on text content
   */
  private static selectStrategy(text: string, options: ChunkingOptions): ChunkingStrategy {
    // FIXED regex patterns to actually match markdown/code
    const hasMarkdown = /^#+\s|\*\*|\[.*\]\(.*\)/m.test(text)
    const hasParagraphs = /\n\n/.test(text)
    const hasCode = /```|{\s*}|[[\]]|function|class|def|import|export/m.test(text)

    if (hasMarkdown || hasParagraphs) {
      return { type: 'semantic', preserveBoundaries: true }
    }

    if (hasCode) {
      return { type: 'hybrid', preserveBoundaries: true }
    }

    return { type: 'character' }
  }

  /**
   * Estimate token count for text
   */
  private static estimateTokens(text: string, model: string): number {
    // Basic estimation: ~4 characters per token for most models
    // TODO: Implement proper tokenizer registry for accurate counting
    return Math.ceil(text.length / 4)
  }

  /**
   * Generate cache key for chunking results
   */
  private static getCacheKey(text: string, options: ChunkingOptions): string {
    const hash = crypto.createHash('sha256')
    hash.update(text)
    hash.update(
      JSON.stringify({
        model: options.model,
        provider: options.provider,
        maxTokens: options.maxTokens,
        strategy: options.strategy,
      })
    )
    return hash.digest('hex')
  }

  /**
   * Batch chunking for multiple texts
   */
  static async batchChunk(texts: string[], options: ChunkingOptions): Promise<ChunkResult[]> {
    const results = await Promise.all(
      texts.map((text) => SmartChunkingService.chunkText(text, options))
    )
    return results
  }
}
