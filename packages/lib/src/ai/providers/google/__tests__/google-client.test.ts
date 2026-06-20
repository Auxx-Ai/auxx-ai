// packages/lib/src/ai/providers/google/__tests__/google-client.test.ts

import { describe, expect, it } from 'vitest'
import { ModelType } from '../../types'
import { GoogleClient } from '../google-client'

describe('GoogleClient', () => {
  function createClient() {
    return new GoogleClient('org-123', 'user-123')
  }

  describe('extractCredentials', () => {
    it('extracts from the canonical apiKey field', () => {
      const client = createClient()
      const result = client.extractCredentials({ apiKey: 'AIzaTest789' })
      expect(result.apiKey).toBe('AIzaTest789')
    })

    it('returns an empty apiKey when none is provided', () => {
      const client = createClient()
      const result = client.extractCredentials({})
      expect(result.apiKey).toBe('')
    })
  })

  describe('getModels', () => {
    it('returns all Google models', () => {
      const client = createClient()
      const models = client.getModels()
      expect(Object.keys(models).length).toBeGreaterThan(0)
      expect(models['gemini-2.5-flash']).toBeDefined()
    })

    it('includes both LLM and embedding models', () => {
      const client = createClient()
      const models = client.getModels()
      const types = new Set(Object.values(models).map((m) => m.modelType))
      expect(types).toContain(ModelType.LLM)
      expect(types).toContain(ModelType.TEXT_EMBEDDING)
    })
  })

  describe('getClient', () => {
    it('returns embedding client for TEXT_EMBEDDING type', () => {
      const client = createClient()
      const credentials = { apiKey: 'AIzaTestKey12345678901234567890123' }
      const embeddingClient = client.getClient(ModelType.TEXT_EMBEDDING, credentials)
      expect(embeddingClient).toBeDefined()
    })

    it('throws for unsupported model types', () => {
      const client = createClient()
      const credentials = { apiKey: 'AIzaTestKey12345678901234567890123' }
      expect(() => client.getClient(ModelType.RERANK, credentials)).toThrow('not yet implemented')
    })
  })

  describe('testConnection', () => {
    it('returns success for valid credentials', async () => {
      const client = createClient()
      const result = await client.testConnection({
        apiKey: 'AIzaValidTestKey1234567890123456789',
      })
      expect(result.success).toBe(true)
      expect(result.responseTime).toBeGreaterThanOrEqual(0)
    })

    it('returns failure when no API key provided', async () => {
      const client = createClient()
      const result = await client.testConnection({})
      expect(result.success).toBe(false)
    })
  })
})
