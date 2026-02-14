// packages/lib/src/datasets/processors/text-chunker.ts

import { createScopedLogger } from '@auxx/logger'
import type { ChunkingOptions, DocumentChunk } from '../types'

const logger = createScopedLogger('text-chunker')

/**
 * Text chunking service using sliding window approach
 *
 * Implements predictable text segmentation with proper overlap handling
 * and semantic boundary detection
 */
export class TextChunker {
  /**
   * Split text into segments using sliding window approach
   */
  static async chunkText(content: string, options: ChunkingOptions): Promise<DocumentChunk[]> {
    logger.info('Starting text chunking', {
      contentLength: content.length,
      chunkSize: options.chunkSize,
      chunkOverlap: options.chunkOverlap,
      delimiter: options.delimiter,
    })

    try {
      TextChunker.validateChunkingOptions(options)

      if (!content || content.trim().length === 0) {
        logger.warn('Empty content provided for chunking')
        return []
      }

      const segments = TextChunker.slidingWindowChunk(content, options)

      logger.info('Text chunking completed', {
        originalLength: content.length,
        segmentCount: segments.length,
        averageSegmentSize:
          segments.length > 0
            ? Math.round(
                segments.reduce((acc, seg) => acc + seg.content.length, 0) / segments.length
              )
            : 0,
      })

      return segments
    } catch (error) {
      logger.error('Text chunking failed', {
        error: error instanceof Error ? error.message : error,
        contentLength: content.length,
        options,
      })
      throw error
    }
  }

  /**
   * Validate chunking options
   */
  private static validateChunkingOptions(options: ChunkingOptions): void {
    if (options.chunkSize <= 0) {
      throw new Error('Chunk size must be positive')
    }

    if (options.chunkOverlap < 0) {
      throw new Error('Chunk overlap cannot be negative')
    }

    if (options.chunkOverlap >= options.chunkSize) {
      throw new Error('Chunk overlap must be less than chunk size')
    }

    // Ensure effective advancement is at least 20% of chunk size
    const effectiveStep = options.chunkSize - options.chunkOverlap
    if (effectiveStep < options.chunkSize * 0.2) {
      throw new Error(
        `Overlap too large: effective step (${effectiveStep}) must be at least 20% of chunk size (${options.chunkSize}). ` +
          `Maximum overlap for this chunk size: ${Math.floor(options.chunkSize * 0.8)}`
      )
    }

    if (options.maxTokens && options.maxTokens <= 0) {
      throw new Error('Max tokens must be positive')
    }
  }

  /**
   * Sliding window chunking with semantic boundary detection
   */
  private static slidingWindowChunk(content: string, options: ChunkingOptions): DocumentChunk[] {
    const { chunkSize, chunkOverlap } = options
    const effectiveStep = chunkSize - chunkOverlap
    const segments: DocumentChunk[] = []

    let position = 0
    let segmentIndex = 0

    while (position < content.length) {
      // Calculate the maximum end position for this chunk
      const maxEnd = Math.min(position + chunkSize, content.length)

      // Find the best break point within the window
      const chunkEnd = TextChunker.findBestBreakPoint(content, position, maxEnd, options)

      // Extract and trim the chunk
      const chunkContent = content.slice(position, chunkEnd).trim()

      if (chunkContent.length > 0) {
        segments.push({
          content: chunkContent,
          position: segmentIndex,
          startOffset: position,
          endOffset: chunkEnd,
          tokenCount: TextChunker.estimateTokens(chunkContent),
          metadata: {
            chunkMethod: 'sliding-window',
            originalLength: chunkEnd - position,
            wordCount: TextChunker.countWords(chunkContent),
          },
        })
        segmentIndex++
      }

      // Advance position by effective step (chunkSize - overlap)
      // Ensure we always advance by at least 1 to prevent infinite loops
      const nextPosition = position + effectiveStep
      position = Math.max(nextPosition, position + 1)

      // If we've reached the end, break
      if (chunkEnd >= content.length) break
    }

    return segments
  }

  /**
   * Find the best break point within a chunk window
   * Prioritizes: custom delimiter > paragraphs > sentences > words > exact position
   */
  private static findBestBreakPoint(
    content: string,
    start: number,
    maxEnd: number,
    options: ChunkingOptions
  ): number {
    // If we're at the end of content, return maxEnd
    if (maxEnd >= content.length) {
      return content.length
    }

    const window = content.slice(start, maxEnd)

    // Minimum position for custom delimiter - allow breaking early but prevent tiny chunks
    // Use 10% of window size to allow delimiters in the first half while preventing tiny chunks
    const minDelimiterPosition = Math.floor(window.length * 0.1)

    // Minimum position for fallback heuristics (paragraph, sentence, word) - more conservative
    const minFallbackPosition = Math.floor(window.length * 0.5)

    // 1. Try custom delimiter first - use relaxed minimum to respect user's intent
    if (options.delimiter) {
      const delimiterPos = window.lastIndexOf(options.delimiter)
      if (delimiterPos >= minDelimiterPosition) {
        return start + delimiterPos + options.delimiter.length
      }
    }

    // 2. Try paragraph breaks (double newline)
    const paraBreak = window.lastIndexOf('\n\n')
    if (paraBreak >= minFallbackPosition) {
      return start + paraBreak + 2
    }

    // 3. Try single newline
    const lineBreak = window.lastIndexOf('\n')
    if (lineBreak >= minFallbackPosition) {
      return start + lineBreak + 1
    }

    // 4. Try sentence endings
    const sentenceEndings = ['. ', '? ', '! ', '.\n', '?\n', '!\n']
    let bestSentenceBreak = -1
    for (const ending of sentenceEndings) {
      const pos = window.lastIndexOf(ending)
      if (pos > bestSentenceBreak) {
        bestSentenceBreak = pos
      }
    }
    if (bestSentenceBreak >= minFallbackPosition) {
      // Include the punctuation but not the space/newline
      return start + bestSentenceBreak + 1
    }

    // 5. Try word breaks (space)
    const wordBreak = window.lastIndexOf(' ')
    if (wordBreak >= Math.floor(window.length * 0.3)) {
      // Allow word breaks at 30%
      return start + wordBreak + 1
    }

    // 6. Fall back to exact max position
    return maxEnd
  }

  /**
   * Count words in text
   */
  private static countWords(text: string): number {
    if (!text || !text.trim()) return 0
    return text
      .trim()
      .split(/\s+/)
      .filter((word) => word.length > 0).length
  }

  /**
   * Estimate token count (rough approximation for planning)
   * Uses standard approximation: 1 token ≈ 4 characters for English text
   */
  private static estimateTokens(text: string): number {
    if (!text) return 0

    // More sophisticated estimation accounting for punctuation and whitespace
    const cleanText = text.replace(/\s+/g, ' ').trim()
    const baseTokens = Math.ceil(cleanText.length / 4)

    // Adjust for punctuation (tokens can be smaller)
    const punctuationCount = (cleanText.match(/[.,;:!?()[\]{}]/g) || []).length
    const adjustedTokens = baseTokens + Math.floor(punctuationCount * 0.5)

    return Math.max(adjustedTokens, 1)
  }

  /**
   * Optimize chunk size based on content characteristics
   */
  static optimizeChunkSize(
    content: string,
    baseOptions: ChunkingOptions,
    targetTokens?: number
  ): ChunkingOptions {
    logger.debug('Optimizing chunk size for content', {
      contentLength: content.length,
      baseChunkSize: baseOptions.chunkSize,
      targetTokens,
    })

    const contentAnalysis = TextChunker.analyzeContent(content)
    let optimizedSize = baseOptions.chunkSize

    // Adjust based on content density
    if (contentAnalysis.averageParagraphLength > 0) {
      // If paragraphs are very short, increase chunk size to include multiple paragraphs
      if (contentAnalysis.averageParagraphLength < optimizedSize * 0.3) {
        optimizedSize = Math.min(optimizedSize * 1.5, optimizedSize + 500)
      }

      // If paragraphs are very long, decrease chunk size to maintain coherence
      if (contentAnalysis.averageParagraphLength > optimizedSize * 0.8) {
        optimizedSize = Math.max(optimizedSize * 0.7, optimizedSize - 300)
      }
    }

    // Adjust based on sentence structure
    if (contentAnalysis.averageSentenceLength > 0) {
      const sentencesPerChunk = optimizedSize / contentAnalysis.averageSentenceLength

      // Try to keep 3-8 sentences per chunk for good semantic coherence
      if (sentencesPerChunk < 3) {
        optimizedSize = Math.ceil(contentAnalysis.averageSentenceLength * 4)
      } else if (sentencesPerChunk > 10) {
        optimizedSize = Math.ceil(contentAnalysis.averageSentenceLength * 7)
      }
    }

    // Adjust for target token count if specified
    if (targetTokens) {
      const estimatedTokensPerChar = TextChunker.estimateTokens(content) / content.length
      const targetCharacters = Math.floor(targetTokens / estimatedTokensPerChar)

      // Blend target size with content-optimized size
      optimizedSize = Math.round((optimizedSize + targetCharacters) / 2)
    }

    // Apply reasonable bounds
    optimizedSize = Math.max(100, Math.min(optimizedSize, 8000))

    // Adjust overlap proportionally but maintain semantic boundaries
    const overlapRatio = baseOptions.chunkOverlap / baseOptions.chunkSize
    const optimizedOverlap = Math.round(optimizedSize * overlapRatio)

    const optimized = {
      ...baseOptions,
      chunkSize: optimizedSize,
      chunkOverlap: Math.min(optimizedOverlap, Math.floor(optimizedSize * 0.3)),
    }

    logger.debug('Chunk size optimization complete', {
      originalSize: baseOptions.chunkSize,
      optimizedSize: optimized.chunkSize,
      originalOverlap: baseOptions.chunkOverlap,
      optimizedOverlap: optimized.chunkOverlap,
      contentAnalysis,
    })

    return optimized
  }

  /**
   * Analyze content characteristics for optimization
   */
  private static analyzeContent(content: string): {
    paragraphCount: number
    averageParagraphLength: number
    sentenceCount: number
    averageSentenceLength: number
    wordCount: number
    averageWordLength: number
    hasCodeBlocks: boolean
    hasLists: boolean
    structuralComplexity: 'low' | 'medium' | 'high'
  } {
    const paragraphs = content.split(/\n\s*\n/).filter((p) => p.trim().length > 0)
    const sentences = content.split(/[.!?]+/).filter((s) => s.trim().length > 0)
    const words = content.split(/\s+/).filter((w) => w.trim().length > 0)

    // Detect structural elements
    const hasCodeBlocks = /```[\s\S]*?```|`[^`]+`/.test(content)
    const hasLists = /^\s*[-*+•]\s|^\s*\d+\.\s/m.test(content)

    // Determine structural complexity
    let structuralComplexity: 'low' | 'medium' | 'high' = 'low'

    if (hasCodeBlocks || hasLists) {
      structuralComplexity = 'medium'
    }

    if (hasCodeBlocks && hasLists && paragraphs.length > 10) {
      structuralComplexity = 'high'
    }

    return {
      paragraphCount: paragraphs.length,
      averageParagraphLength:
        paragraphs.length > 0
          ? paragraphs.reduce((sum, p) => sum + p.length, 0) / paragraphs.length
          : 0,
      sentenceCount: sentences.length,
      averageSentenceLength:
        sentences.length > 0
          ? sentences.reduce((sum, s) => sum + s.length, 0) / sentences.length
          : 0,
      wordCount: words.length,
      averageWordLength:
        words.length > 0 ? words.reduce((sum, w) => sum + w.length, 0) / words.length : 0,
      hasCodeBlocks,
      hasLists,
      structuralComplexity,
    }
  }

  /**
   * Get chunking statistics for analysis
   */
  static getChunkingStats(segments: DocumentChunk[]): {
    totalSegments: number
    totalCharacters: number
    totalWords: number
    totalTokens: number
    averageChunkSize: number
    minChunkSize: number
    maxChunkSize: number
    chunkSizeDistribution: { size: number; count: number }[]
  } {
    if (segments.length === 0) {
      return {
        totalSegments: 0,
        totalCharacters: 0,
        totalWords: 0,
        totalTokens: 0,
        averageChunkSize: 0,
        minChunkSize: 0,
        maxChunkSize: 0,
        chunkSizeDistribution: [],
      }
    }

    const sizes = segments.map((seg) => seg.content.length)
    const totalCharacters = sizes.reduce((sum, size) => sum + size, 0)
    const totalWords = segments.reduce(
      (sum, seg) =>
        sum + ((seg.metadata?.wordCount as number) || TextChunker.countWords(seg.content)),
      0
    )
    const totalTokens = segments.reduce((sum, seg) => sum + seg.tokenCount, 0)

    // Create size distribution buckets
    const maxSize = Math.max(...sizes)
    const bucketSize = Math.max(100, Math.ceil(maxSize / 10))
    const buckets: { [key: number]: number } = {}

    sizes.forEach((size) => {
      const bucket = Math.floor(size / bucketSize) * bucketSize
      buckets[bucket] = (buckets[bucket] || 0) + 1
    })

    return {
      totalSegments: segments.length,
      totalCharacters,
      totalWords,
      totalTokens,
      averageChunkSize: Math.round(totalCharacters / segments.length),
      minChunkSize: Math.min(...sizes),
      maxChunkSize: Math.max(...sizes),
      chunkSizeDistribution: Object.entries(buckets)
        .map(([size, count]) => ({ size: parseInt(size, 10), count }))
        .sort((a, b) => a.size - b.size),
    }
  }

  /**
   * Validate and score chunk quality
   */
  static validateChunks(
    segments: DocumentChunk[],
    options: ChunkingOptions
  ): {
    isValid: boolean
    qualityScore: number
    issues: string[]
    recommendations: string[]
  } {
    const issues: string[] = []
    const recommendations: string[] = []
    let qualityScore = 100 // Start with perfect score and deduct points

    // Check for empty or too-small chunks
    const tooSmallChunks = segments.filter((seg) => seg.content.trim().length < 50)
    if (tooSmallChunks.length > 0) {
      issues.push(`${tooSmallChunks.length} chunks are too small (< 50 characters)`)
      qualityScore -= tooSmallChunks.length * 5
      recommendations.push('Increase minimum chunk size or adjust chunk overlap')
    }

    // Check for overly large chunks
    const tooLargeChunks = segments.filter((seg) => seg.content.length > options.chunkSize * 1.2)
    if (tooLargeChunks.length > 0) {
      issues.push(`${tooLargeChunks.length} chunks exceed target size by >20%`)
      qualityScore -= tooLargeChunks.length * 3
      recommendations.push('Decrease chunk size or improve text splitting strategy')
    }

    // Check chunk size consistency
    const sizes = segments.map((seg) => seg.content.length)
    const averageSize = sizes.reduce((sum, size) => sum + size, 0) / sizes.length
    const sizeVariation = TextChunker.calculateStandardDeviation(sizes, averageSize)
    const variationRatio = sizeVariation / averageSize

    if (variationRatio > 0.5) {
      issues.push('High variation in chunk sizes (inconsistent splitting)')
      qualityScore -= 10
      recommendations.push('Consider content-aware chunking or size optimization')
    }

    // Check for broken sentences at chunk boundaries
    const brokenSentences = segments.filter((seg) => {
      const content = seg.content.trim()
      const startsWithLowercase = /^[a-z]/.test(content)
      const endsIncomplete = !/[.!?]$/.test(content) && content.length > 100
      return startsWithLowercase || endsIncomplete
    })

    if (brokenSentences.length > segments.length * 0.3) {
      issues.push('High number of chunks with broken sentence boundaries')
      qualityScore -= 15
      recommendations.push('Improve semantic boundary detection or increase chunk overlap')
    }

    // Check token distribution
    const tokenCounts = segments.map((seg) => seg.tokenCount)
    const avgTokens = tokenCounts.reduce((sum, count) => sum + count, 0) / tokenCounts.length

    if (options.maxTokens && avgTokens > options.maxTokens * 0.9) {
      issues.push('Average token count approaching maximum limit')
      qualityScore -= 10
      recommendations.push('Consider reducing chunk size to maintain token limits')
    }

    // Check for semantic coherence indicators
    const coherenceScore = TextChunker.assessSemanticCoherence(segments)
    qualityScore += coherenceScore - 50 // Adjust based on coherence (50 is neutral)

    if (coherenceScore < 40) {
      issues.push('Low semantic coherence in chunks')
      recommendations.push('Use paragraph-aware splitting or semantic segmentation')
    }

    // Final quality assessment
    qualityScore = Math.max(0, Math.min(100, qualityScore))
    const isValid = qualityScore >= 60 && issues.length === 0

    return {
      isValid,
      qualityScore: Math.round(qualityScore),
      issues,
      recommendations,
    }
  }

  /**
   * Calculate standard deviation for size consistency analysis
   */
  private static calculateStandardDeviation(values: number[], mean: number): number {
    const squaredDiffs = values.map((value) => (value - mean) ** 2)
    const avgSquaredDiff = squaredDiffs.reduce((sum, diff) => sum + diff, 0) / values.length
    return Math.sqrt(avgSquaredDiff)
  }

  /**
   * Assess semantic coherence of chunks
   * Returns score from 0-100 where higher is better
   */
  private static assessSemanticCoherence(segments: DocumentChunk[]): number {
    let coherenceScore = 50 // Start neutral

    for (const segment of segments) {
      const content = segment.content.trim()

      // Positive indicators
      if (content.match(/^[A-Z]/) && content.match(/[.!?]$/)) {
        coherenceScore += 2 // Complete sentences
      }

      if (content.split('\n\n').length > 1) {
        coherenceScore += 3 // Multiple paragraphs indicate structured content
      }

      const sentences = content.split(/[.!?]+/).filter((s: string) => s.trim())
      if (sentences.length >= 3 && sentences.length <= 8) {
        coherenceScore += 2 // Good sentence count per chunk
      }

      // Negative indicators
      if (content.match(/^\s*[a-z]/) && content.length > 50) {
        coherenceScore -= 3 // Starts mid-sentence
      }

      if (!content.match(/[.!?]$/) && content.length > 100) {
        coherenceScore -= 2 // Ends mid-sentence for longer chunks
      }

      if (content.split(/\s+/).length < 10) {
        coherenceScore -= 1 // Very short chunks may lack context
      }
    }

    return Math.max(0, Math.min(100, (coherenceScore / segments.length) * 50))
  }

  /**
   * Auto-improve chunking based on quality analysis
   */
  static improveChunking(
    content: string,
    originalOptions: ChunkingOptions,
    qualityAnalysis: ReturnType<typeof TextChunker.validateChunks>
  ): ChunkingOptions {
    const improvedOptions = { ...originalOptions }

    logger.info('Auto-improving chunking based on quality analysis', {
      originalQualityScore: qualityAnalysis.qualityScore,
      issueCount: qualityAnalysis.issues.length,
    })

    // Apply automatic improvements based on identified issues
    if (qualityAnalysis.issues.some((issue) => issue.includes('too small'))) {
      improvedOptions.chunkSize = Math.min(improvedOptions.chunkSize * 1.3, 4000)
      improvedOptions.chunkOverlap = Math.min(
        improvedOptions.chunkOverlap * 1.2,
        improvedOptions.chunkSize * 0.3
      )
    }

    if (qualityAnalysis.issues.some((issue) => issue.includes('exceed target size'))) {
      improvedOptions.chunkSize = Math.max(improvedOptions.chunkSize * 0.8, 200)
    }

    if (qualityAnalysis.issues.some((issue) => issue.includes('broken sentence'))) {
      improvedOptions.chunkOverlap = Math.min(
        improvedOptions.chunkOverlap * 1.5,
        improvedOptions.chunkSize * 0.4
      )
      improvedOptions.preserveParagraphs = true
    }

    if (qualityAnalysis.issues.some((issue) => issue.includes('High variation'))) {
      // Enable content-aware optimization
      const optimized = TextChunker.optimizeChunkSize(content, improvedOptions)
      return optimized
    }

    logger.info('Chunking improvements applied', {
      originalChunkSize: originalOptions.chunkSize,
      improvedChunkSize: improvedOptions.chunkSize,
      originalOverlap: originalOptions.chunkOverlap,
      improvedOverlap: improvedOptions.chunkOverlap,
    })

    return improvedOptions
  }
}
