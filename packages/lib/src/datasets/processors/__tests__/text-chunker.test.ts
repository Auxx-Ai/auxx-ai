// packages/lib/src/datasets/processors/__tests__/text-chunker.test.ts

import { describe, it, expect } from 'vitest'
import { TextChunker } from '../text-chunker'

describe('TextChunker', () => {
  describe('chunkText - sliding window approach', () => {
    it('should create predictable number of chunks for a document', async () => {
      // 10,000 char document, chunkSize=1000, overlap=200
      // Expected: ~12-13 chunks (10000 / 800 ≈ 12.5)
      const content = 'A'.repeat(10000)
      const chunks = await TextChunker.chunkText(content, {
        chunkSize: 1000,
        chunkOverlap: 200,
      })

      // With sliding window: ceil(10000 / 800) = 13 chunks expected
      expect(chunks.length).toBeGreaterThanOrEqual(12)
      expect(chunks.length).toBeLessThanOrEqual(14)
    })

    it('should return single chunk when content is smaller than chunk size', async () => {
      const content = 'This is a short piece of content.'
      const chunks = await TextChunker.chunkText(content, {
        chunkSize: 1000,
        chunkOverlap: 100,
      })

      expect(chunks.length).toBe(1)
      expect(chunks[0].content).toBe(content)
    })

    it('should return empty array for empty content', async () => {
      const chunks = await TextChunker.chunkText('', {
        chunkSize: 1000,
        chunkOverlap: 100,
      })

      expect(chunks.length).toBe(0)
    })

    it('should return empty array for whitespace-only content', async () => {
      const chunks = await TextChunker.chunkText('   \n\n  \t  ', {
        chunkSize: 1000,
        chunkOverlap: 100,
      })

      expect(chunks.length).toBe(0)
    })

    it('should work with zero overlap', async () => {
      const content = 'Word '.repeat(200) // ~1000 chars
      const chunks = await TextChunker.chunkText(content, {
        chunkSize: 500,
        chunkOverlap: 0,
      })

      // With no overlap, should be ~2 chunks
      expect(chunks.length).toBeGreaterThanOrEqual(1)
      expect(chunks.length).toBeLessThanOrEqual(3)
    })

    it('should prefer paragraph breaks over word breaks', async () => {
      const content = 'First paragraph with some content here.\n\nSecond paragraph with more content that continues.'
      const chunks = await TextChunker.chunkText(content, {
        chunkSize: 60,
        chunkOverlap: 0,
      })

      // Should break at paragraph boundary
      expect(chunks[0].content).toBe('First paragraph with some content here.')
    })

    it('should prefer sentence breaks when no paragraph breaks available', async () => {
      const content = 'First sentence here. Second sentence continues. Third sentence ends.'
      const chunks = await TextChunker.chunkText(content, {
        chunkSize: 50,
        chunkOverlap: 0,
      })

      // First chunk should end at a sentence boundary
      expect(chunks[0].content).toMatch(/\.$/)
    })

    it('should use custom delimiter when specified', async () => {
      // Longer content to ensure delimiter is beyond the 100-char minimum
      const content =
        'Section one with enough content to pass minimum threshold here---' +
        'Section two content continues here with more text---' +
        'Section three content ends here'
      const chunks = await TextChunker.chunkText(content, {
        chunkSize: 80,
        chunkOverlap: 0,
        delimiter: '---',
      })

      // Should break at delimiter - first chunk ends with ---
      expect(chunks[0].content).toMatch(/---$/)
      expect(chunks.length).toBeGreaterThanOrEqual(2)
    })

    it('should respect delimiter even in first half of chunk window', async () => {
      // Content with delimiter at ~40% position (400 out of 1000)
      const content = 'A'.repeat(400) + '\n\n' + 'B'.repeat(600)
      const chunks = await TextChunker.chunkText(content, {
        chunkSize: 1000,
        chunkOverlap: 100,
        delimiter: '\n\n',
      })

      // First chunk should end at the delimiter (position 400), not continue to 1000
      expect(chunks[0].content).toBe('A'.repeat(400))
    })

    it('should respect delimiter with multiple occurrences in window', async () => {
      // Multiple paragraph breaks with longer paragraphs to exceed minimum threshold
      const content =
        'Paragraph one has enough content here to make it past the minimum.\n\n' +
        'Paragraph two continues with more substantial content.\n\n' +
        'Paragraph three adds even more text to the document.\n\n' +
        'Paragraph four concludes the content.'
      const chunks = await TextChunker.chunkText(content, {
        chunkSize: 150,
        chunkOverlap: 0,
        delimiter: '\n\n',
      })

      // Should create multiple chunks breaking at paragraph boundaries
      expect(chunks.length).toBeGreaterThanOrEqual(2)
    })

    it('should NOT create exponentially growing chunks (regression test)', async () => {
      // This was the original bug - chunks like:
      // "REVIEW THE FOLLOWING"
      // "REVIEW THE FOLLOWING IMPLEMENTATION"
      // "REVIEW THE FOLLOWING IMPLEMENTATION PLANS"
      const content = 'REVIEW THE FOLLOWING IMPLEMENTATION PLANS AND PROVIDE DETAILED FEEDBACK ON EACH ONE'
      const chunks = await TextChunker.chunkText(content, {
        chunkSize: 40,
        chunkOverlap: 10,
      })

      // Should NOT have exponential growth - each chunk should be roughly chunkSize or less
      for (const chunk of chunks) {
        expect(chunk.content.length).toBeLessThanOrEqual(50) // Allow some flexibility for word boundaries
      }

      // Should have predictable count: ceil(85 / 30) ≈ 3 chunks
      expect(chunks.length).toBeLessThanOrEqual(5)
    })

    it('should handle paragraph-heavy documents without explosion', async () => {
      // 100 short paragraphs (50 chars each), chunkSize=1000, overlap=50
      const paragraphs = Array(100)
        .fill(null)
        .map((_, i) => `Paragraph ${i + 1} with some filler text here.`)
      const content = paragraphs.join('\n\n')
      const chunks = await TextChunker.chunkText(content, {
        chunkSize: 1000,
        chunkOverlap: 50,
      })

      // Should be ~5-6 chunks, NOT 100+
      expect(chunks.length).toBeLessThan(20)
    })

    it('should not infinite loop on content without good break points', async () => {
      const content = 'A'.repeat(500) // Single long string with no spaces
      const chunks = await TextChunker.chunkText(content, {
        chunkSize: 100,
        chunkOverlap: 20,
      })

      // Should complete without hanging
      expect(chunks.length).toBeGreaterThanOrEqual(1)
      // With step of 80, should be ~7 chunks (500 / 80 ≈ 6.25)
      expect(chunks.length).toBeLessThanOrEqual(10)
    })

    it('should include proper metadata in chunks', async () => {
      const content = 'This is some test content for checking metadata inclusion.'
      const chunks = await TextChunker.chunkText(content, {
        chunkSize: 1000,
        chunkOverlap: 100,
      })

      expect(chunks[0]).toMatchObject({
        content: expect.any(String),
        position: 0,
        startOffset: expect.any(Number),
        endOffset: expect.any(Number),
        tokenCount: expect.any(Number),
        metadata: expect.objectContaining({
          chunkMethod: 'sliding-window',
          wordCount: expect.any(Number),
        }),
      })
    })
  })

  describe('validateChunkingOptions', () => {
    it('should throw error for negative chunk size', async () => {
      await expect(
        TextChunker.chunkText('content', { chunkSize: -1, chunkOverlap: 0 })
      ).rejects.toThrow('Chunk size must be positive')
    })

    it('should throw error for negative overlap', async () => {
      await expect(
        TextChunker.chunkText('content', { chunkSize: 100, chunkOverlap: -1 })
      ).rejects.toThrow('Chunk overlap cannot be negative')
    })

    it('should throw error when overlap >= chunk size', async () => {
      await expect(
        TextChunker.chunkText('content', { chunkSize: 100, chunkOverlap: 100 })
      ).rejects.toThrow('Chunk overlap must be less than chunk size')
    })

    it('should throw error when overlap is too large (< 20% effective step)', async () => {
      // chunkSize=100, overlap=85 → step=15 < 20 (100*0.2)
      await expect(
        TextChunker.chunkText('content', { chunkSize: 100, chunkOverlap: 85 })
      ).rejects.toThrow(/Overlap too large/)
    })

    it('should accept valid overlap (80% max)', async () => {
      // chunkSize=100, overlap=80 → step=20 = 20% (boundary case)
      const chunks = await TextChunker.chunkText('A'.repeat(500), {
        chunkSize: 100,
        chunkOverlap: 80,
      })
      expect(chunks.length).toBeGreaterThan(0)
    })
  })

  describe('getChunkingStats', () => {
    it('should return correct statistics for chunks', async () => {
      const chunks = await TextChunker.chunkText('Word '.repeat(100), {
        chunkSize: 100,
        chunkOverlap: 20,
      })

      const stats = TextChunker.getChunkingStats(chunks)

      expect(stats.totalSegments).toBe(chunks.length)
      expect(stats.totalCharacters).toBeGreaterThan(0)
      expect(stats.totalWords).toBeGreaterThan(0)
      expect(stats.totalTokens).toBeGreaterThan(0)
      expect(stats.averageChunkSize).toBeGreaterThan(0)
      expect(stats.minChunkSize).toBeLessThanOrEqual(stats.maxChunkSize)
    })

    it('should handle empty segments array', () => {
      const stats = TextChunker.getChunkingStats([])

      expect(stats).toEqual({
        totalSegments: 0,
        totalCharacters: 0,
        totalWords: 0,
        totalTokens: 0,
        averageChunkSize: 0,
        minChunkSize: 0,
        maxChunkSize: 0,
        chunkSizeDistribution: [],
      })
    })
  })

  describe('validateChunks', () => {
    it('should return valid quality for well-formed chunks', async () => {
      const chunks = await TextChunker.chunkText(
        'This is a well-formed sentence. Here is another sentence. And a third one for good measure.',
        { chunkSize: 1000, chunkOverlap: 100 }
      )

      const validation = TextChunker.validateChunks(chunks, { chunkSize: 1000, chunkOverlap: 100 })

      expect(validation.qualityScore).toBeGreaterThan(50)
    })
  })
})
