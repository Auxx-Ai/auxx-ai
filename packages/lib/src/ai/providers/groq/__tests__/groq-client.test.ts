// packages/lib/src/ai/providers/groq/__tests__/groq-client.test.ts

import { describe, expect, it, vi } from 'vitest'
import { ModelType } from '../../types'
import { GroqClient } from '../groq-client'

// Constructible override of the global setup mock (which uses a non-constructible arrow fn)
vi.mock('openai', () => ({
  default: vi.fn(function MockOpenAI() {
    return {
      chat: {
        completions: {
          create: vi.fn().mockResolvedValue({
            choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }],
            usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
          }),
        },
      },
    }
  }),
}))

describe('GroqClient', () => {
  function createClient() {
    return new GroqClient('org-123', 'user-123')
  }

  const validCredentials = { apiKey: `gsk_${'a'.repeat(52)}` }

  describe('extractCredentials', () => {
    it('extracts from the canonical apiKey field', () => {
      const client = createClient()
      const result = client.extractCredentials({ apiKey: 'gsk_test' })
      expect(result.apiKey).toBe('gsk_test')
    })

    it('returns an empty apiKey when none is provided', () => {
      const client = createClient()
      const result = client.extractCredentials({})
      expect(result.apiKey).toBe('')
    })
  })

  describe('getModels', () => {
    it('returns all Groq models', () => {
      const client = createClient()
      const models = client.getModels()
      expect(Object.keys(models).length).toBeGreaterThan(0)
      expect(models['llama-3.3-70b-versatile']).toBeDefined()
    })
  })

  describe('getClient', () => {
    it('returns an LLM client for LLM type', () => {
      const client = createClient()
      const llmClient = client.getClient(ModelType.LLM, validCredentials)
      expect(llmClient).toBeDefined()
    })

    it('reuses the same LLM client instance', () => {
      const client = createClient()
      const first = client.getClient(ModelType.LLM, validCredentials)
      const second = client.getClient(ModelType.LLM, validCredentials)
      expect(second).toBe(first)
    })

    it('throws for unsupported model types', () => {
      const client = createClient()
      expect(() => client.getClient(ModelType.RERANK, validCredentials)).toThrow('does not support')
    })
  })

  describe('testConnection', () => {
    it('performs a real chat completion against the default model', async () => {
      const client = createClient()
      const result = await client.testConnection(validCredentials)
      // The openai module is globally mocked, so the "API call" resolves.
      expect(result.success).toBe(true)
      expect(result.modelsTested).toEqual(['llama-3.3-70b-versatile'])
      expect(result.responseTime).toBeGreaterThanOrEqual(0)
    })

    it('returns failure when no API key provided', async () => {
      const client = createClient()
      const result = await client.testConnection({})
      expect(result.success).toBe(false)
      expect(result.error).toBeTruthy()
    })
  })
})
