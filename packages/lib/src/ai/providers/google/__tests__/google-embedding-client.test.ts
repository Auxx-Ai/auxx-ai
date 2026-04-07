// packages/lib/src/ai/providers/google/__tests__/google-embedding-client.test.ts

import { GoogleGenerativeAI } from '@google/generative-ai'
import { describe, expect, it } from 'vitest'
import { DEFAULT_CLIENT_CONFIG } from '../../../clients/base/types'
import { GoogleTextEmbeddingClient } from '../google-embedding-client'

/**
 * Integration tests for the Google embedding client.
 * These hit the real Google AI API — requires GOOGLE_API_KEY in .env.
 */

const apiKey = process.env.GOOGLE_API_KEY

describe.skipIf(!apiKey)('GoogleTextEmbeddingClient integration', () => {
  function createClient() {
    const genAI = new GoogleGenerativeAI(apiKey!)
    return new GoogleTextEmbeddingClient(genAI, {
      ...DEFAULT_CLIENT_CONFIG,
      retries: { ...DEFAULT_CLIENT_CONFIG.retries, maxAttempts: 1 },
    })
  }

  it('embeds a single text', async () => {
    const client = createClient()

    const response = await client.invoke({
      model: 'gemini-embedding-001',
      text: 'Hello world',
    })

    expect(response.embeddings).toHaveLength(1)
    expect(response.embeddings[0].length).toBeGreaterThan(0)
    expect(response.model).toBe('gemini-embedding-001')
    expect(response.usage.prompt_tokens).toBeGreaterThan(0)
    expect(response.usage.completion_tokens).toBe(0)
  }, 15_000)

  it('returns embeddings with valid dimensions', async () => {
    const client = createClient()

    const response = await client.invoke({
      model: 'gemini-embedding-001',
      text: 'Dimension test',
    })

    // gemini-embedding-001 returns a valid embedding vector
    expect(response.embeddings[0].length).toBeGreaterThan(0)
    // Should be one of the valid dimension sizes
    expect([128, 256, 512, 768, 1536, 3072]).toContain(response.embeddings[0].length)
  }, 15_000)
})

describe('GoogleTextEmbeddingClient unit', () => {
  function createMockClient() {
    // Create with a dummy API key — tests that don't hit the API
    const genAI = new GoogleGenerativeAI('AIzaDummyKeyForUnitTests1234567890')
    return new GoogleTextEmbeddingClient(genAI, {
      ...DEFAULT_CLIENT_CONFIG,
      retries: { ...DEFAULT_CLIENT_CONFIG.retries, maxAttempts: 1 },
    })
  }

  describe('getSupportedModels', () => {
    it('returns current embedding models', () => {
      const client = createMockClient()
      const models = client.getSupportedModels()
      expect(models).toContain('gemini-embedding-2-preview')
      expect(models).toContain('gemini-embedding-001')
      expect(models).toHaveLength(2)
    })
  })

  describe('getDefaultDimensions', () => {
    it('returns 3072 for gemini-embedding-2-preview', () => {
      const client = createMockClient()
      expect(client.getDefaultDimensions('gemini-embedding-2-preview')).toBe(3072)
    })

    it('returns 768 for gemini-embedding-001', () => {
      const client = createMockClient()
      expect(client.getDefaultDimensions('gemini-embedding-001')).toBe(768)
    })

    it('returns 768 as default for unknown models', () => {
      const client = createMockClient()
      expect(client.getDefaultDimensions('unknown-model')).toBe(768)
    })
  })

  describe('getMaxInputLength', () => {
    it('returns 8192 for gemini-embedding-2-preview', () => {
      const client = createMockClient()
      expect(client.getMaxInputLength('gemini-embedding-2-preview')).toBe(8192)
    })

    it('returns 2048 for gemini-embedding-001', () => {
      const client = createMockClient()
      expect(client.getMaxInputLength('gemini-embedding-001')).toBe(2048)
    })

    it('returns 2048 as default for unknown models', () => {
      const client = createMockClient()
      expect(client.getMaxInputLength('unknown-model')).toBe(2048)
    })
  })

  describe('supportsCustomDimensions', () => {
    it('returns true for gemini-embedding-2-preview', () => {
      const client = createMockClient()
      expect(client.supportsCustomDimensions('gemini-embedding-2-preview')).toBe(true)
    })

    it('returns true for gemini-embedding-001', () => {
      const client = createMockClient()
      expect(client.supportsCustomDimensions('gemini-embedding-001')).toBe(true)
    })

    it('returns false for unsupported models', () => {
      const client = createMockClient()
      expect(client.supportsCustomDimensions('text-embedding-004')).toBe(false)
    })
  })
})
