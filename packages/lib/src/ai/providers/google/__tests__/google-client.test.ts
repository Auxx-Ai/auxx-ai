// packages/lib/src/ai/providers/google/__tests__/google-client.test.ts

import { describe, expect, it } from 'vitest'
import { ModelType } from '../../types'
import { GoogleClient } from '../google-client'

describe('GoogleClient', () => {
  function createClient() {
    return new GoogleClient('org-123', 'user-123')
  }

  describe('extractCredentials', () => {
    it('extracts from google_api_key field', () => {
      const client = createClient()
      const result = client.extractCredentials({ google_api_key: 'AIzaTest123' })
      expect(result.google_api_key).toBe('AIzaTest123')
    })

    it('extracts from api_key field', () => {
      const client = createClient()
      const result = client.extractCredentials({ api_key: 'AIzaTest456' })
      expect(result.google_api_key).toBe('AIzaTest456')
    })

    it('extracts from apiKey field', () => {
      const client = createClient()
      const result = client.extractCredentials({ apiKey: 'AIzaTest789' })
      expect(result.google_api_key).toBe('AIzaTest789')
    })

    it('prefers api_key over apiKey', () => {
      const client = createClient()
      const result = client.extractCredentials({
        api_key: 'AIzaFirst',
        apiKey: 'AIzaSecond',
      })
      expect(result.google_api_key).toBe('AIzaFirst')
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
      const credentials = { google_api_key: 'AIzaTestKey12345678901234567890123' }
      const embeddingClient = client.getClient(ModelType.TEXT_EMBEDDING, credentials)
      expect(embeddingClient).toBeDefined()
    })

    it('throws for unsupported model types', () => {
      const client = createClient()
      const credentials = { google_api_key: 'AIzaTestKey12345678901234567890123' }
      expect(() => client.getClient(ModelType.RERANK, credentials)).toThrow('not yet implemented')
    })
  })

  describe('testConnection', () => {
    it('returns success for valid credentials', async () => {
      const client = createClient()
      const result = await client.testConnection({
        google_api_key: 'AIzaValidTestKey1234567890123456789',
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
