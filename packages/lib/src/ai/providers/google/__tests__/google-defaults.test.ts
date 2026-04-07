// packages/lib/src/ai/providers/google/__tests__/google-defaults.test.ts

import { describe, expect, it } from 'vitest'
import { ModelType } from '../../types'
import { GOOGLE_CAPABILITIES, GOOGLE_MODELS } from '../google-defaults'

describe('GOOGLE_CAPABILITIES', () => {
  it('has correct provider identity', () => {
    expect(GOOGLE_CAPABILITIES.id).toBe('google')
    expect(GOOGLE_CAPABILITIES.displayName).toBe('Google')
    expect(GOOGLE_CAPABILITIES.icon).toBe('google')
    expect(GOOGLE_CAPABILITIES.color).toBe('#4285F4')
  })

  it('supports expected model types', () => {
    expect(GOOGLE_CAPABILITIES.supportedModelTypes).toContain(ModelType.LLM)
    expect(GOOGLE_CAPABILITIES.supportedModelTypes).toContain(ModelType.VISION)
    expect(GOOGLE_CAPABILITIES.supportedModelTypes).toContain(ModelType.TEXT_EMBEDDING)
  })

  it('has gemini-2.5-flash as default model', () => {
    expect(GOOGLE_CAPABILITIES.defaultModel).toBe('gemini-2.5-flash')
  })

  it('requires an API key', () => {
    expect(GOOGLE_CAPABILITIES.requiresApiKey).toBe(true)
  })

  it('has valid credential schema', () => {
    expect(GOOGLE_CAPABILITIES.credentialSchema).toHaveLength(1)

    const apiKeyField = GOOGLE_CAPABILITIES.credentialSchema[0]
    expect(apiKeyField.variable).toBe('google_api_key')
    expect(apiKeyField.type).toBe('secret-input')
    expect(apiKeyField.required).toBe(true)
    expect(apiKeyField.validation?.pattern).toBe('^AIza[0-9A-Za-z-_]{35}$')
  })

  it('has rate limits configured', () => {
    expect(GOOGLE_CAPABILITIES.rateLimits).toBeDefined()
    expect(GOOGLE_CAPABILITIES.rateLimits!.requestsPerMinute).toBe(60)
    expect(GOOGLE_CAPABILITIES.rateLimits!.tokensPerMinute).toBe(30000)
  })
})

describe('GOOGLE_MODELS', () => {
  it('contains all expected models', () => {
    const modelIds = Object.keys(GOOGLE_MODELS)
    // Current LLM models
    expect(modelIds).toContain('gemini-3.1-pro-preview')
    expect(modelIds).toContain('gemini-3-flash-preview')
    expect(modelIds).toContain('gemini-3.1-flash-lite-preview')
    expect(modelIds).toContain('gemini-2.5-pro')
    expect(modelIds).toContain('gemini-2.5-flash')
    expect(modelIds).toContain('gemini-2.5-flash-lite')
    // Deprecated LLM models
    expect(modelIds).toContain('gemini-2.0-flash')
    expect(modelIds).toContain('gemini-2.0-flash-lite')
    expect(modelIds).toContain('gemini-1.5-pro-latest')
    expect(modelIds).toContain('gemini-1.5-flash-latest')
    // Embedding models
    expect(modelIds).toContain('gemini-embedding-2-preview')
    expect(modelIds).toContain('gemini-embedding-001')
    expect(modelIds).toContain('text-embedding-004')
    expect(modelIds).toContain('textembedding-gecko@003')
  })

  describe('current LLM models', () => {
    const currentLlmModels = [
      'gemini-3.1-pro-preview',
      'gemini-3-flash-preview',
      'gemini-3.1-flash-lite-preview',
      'gemini-2.5-pro',
      'gemini-2.5-flash',
      'gemini-2.5-flash-lite',
    ]

    it.each(currentLlmModels)('%s has correct base properties', (modelId) => {
      const model = GOOGLE_MODELS[modelId]
      expect(model.provider).toBe('google')
      expect(model.modelId).toBe(modelId)
      expect(model.modelType).toBe(ModelType.LLM)
      expect(model.contextLength).toBe(1048576)
      expect(model.maxTokens).toBe(65536)
    })

    it.each(currentLlmModels)('%s supports full LLM capabilities', (modelId) => {
      const model = GOOGLE_MODELS[modelId]
      expect(model.supports.streaming).toBe(true)
      expect(model.supports.structured).toBe(true)
      expect(model.supports.vision).toBe(true)
      expect(model.supports.toolCalling).toBe(true)
      expect(model.supports.systemMessages).toBe(true)
      expect(model.supports.fileInput).toBe(true)
    })

    it.each(currentLlmModels)('%s has thinking capabilities', (modelId) => {
      const model = GOOGLE_MODELS[modelId]
      expect(model.features).toContain('thinking')
      expect(model.parameterRestrictions?.isReasoningModel).toBe(true)
    })

    it.each(currentLlmModels)('%s has thinking parameter rules', (modelId) => {
      const model = GOOGLE_MODELS[modelId]
      const paramNames = model.parameterRules?.map((r) => r.name) ?? []
      expect(paramNames).toContain('temperature')
      expect(paramNames).toContain('topP')
      expect(paramNames).toContain('topK')
      expect(paramNames).toContain('maxOutputTokens')
      expect(paramNames).toContain('thinkingBudget')
    })

    it.each(currentLlmModels)('%s is not deprecated', (modelId) => {
      expect(GOOGLE_MODELS[modelId].deprecated).toBeFalsy()
    })

    it.each(currentLlmModels)('%s has pricing defined', (modelId) => {
      const model = GOOGLE_MODELS[modelId]
      expect(model.costPer1kTokens).toBeDefined()
      expect(model.costPer1kTokens!.input).toBeGreaterThan(0)
      expect(model.costPer1kTokens!.output).toBeGreaterThan(0)
    })
  })

  describe('deprecated LLM models', () => {
    const deprecatedModels = ['gemini-2.0-flash', 'gemini-2.0-flash-lite']

    it.each(deprecatedModels)('%s is marked as deprecated', (modelId) => {
      expect(GOOGLE_MODELS[modelId].deprecated).toBe(true)
    })

    it.each(deprecatedModels)('%s has a replacement', (modelId) => {
      expect(GOOGLE_MODELS[modelId].replacement).toBeTruthy()
    })

    it.each(deprecatedModels)('%s has deprecation notice in description', (modelId) => {
      expect(GOOGLE_MODELS[modelId].description).toContain('Deprecated')
    })
  })

  describe('retired LLM models', () => {
    const retiredModels = ['gemini-1.5-pro-latest', 'gemini-1.5-flash-latest']

    it.each(retiredModels)('%s is marked as retired', (modelId) => {
      expect(GOOGLE_MODELS[modelId].retired).toBe(true)
    })

    it.each(retiredModels)('%s has a replacement', (modelId) => {
      expect(GOOGLE_MODELS[modelId].replacement).toBeTruthy()
    })

    it.each(retiredModels)('%s is not marked as deprecated', (modelId) => {
      expect(GOOGLE_MODELS[modelId].deprecated).toBeFalsy()
    })
  })

  describe('retired embedding models', () => {
    const retiredEmbeddings = ['text-embedding-004', 'textembedding-gecko@003']

    it.each(retiredEmbeddings)('%s is marked as retired', (modelId) => {
      expect(GOOGLE_MODELS[modelId].retired).toBe(true)
    })

    it.each(retiredEmbeddings)('%s has a replacement', (modelId) => {
      expect(GOOGLE_MODELS[modelId].replacement).toBe('gemini-embedding-001')
    })
  })

  describe('embedding models', () => {
    it('gemini-embedding-2-preview has correct config', () => {
      const model = GOOGLE_MODELS['gemini-embedding-2-preview']
      expect(model.modelType).toBe(ModelType.TEXT_EMBEDDING)
      expect(model.contextLength).toBe(8192)
      expect(model.features).toContain('text-embedding')
      expect(model.features).toContain('multimodal-embedding')
      expect(model.costPer1kTokens!.output).toBe(0)
    })

    it('gemini-embedding-001 has correct config', () => {
      const model = GOOGLE_MODELS['gemini-embedding-001']
      expect(model.modelType).toBe(ModelType.TEXT_EMBEDDING)
      expect(model.contextLength).toBe(2048)
      expect(model.features).toContain('text-embedding')
      expect(model.costPer1kTokens!.output).toBe(0)
    })

    it('embedding models have no streaming/tool support', () => {
      for (const modelId of ['gemini-embedding-2-preview', 'gemini-embedding-001']) {
        const model = GOOGLE_MODELS[modelId]
        expect(model.supports.streaming).toBe(false)
        expect(model.supports.toolCalling).toBe(false)
        expect(model.supports.structured).toBe(false)
      }
    })

    it('embedding models have dimension parameter rules', () => {
      for (const modelId of ['gemini-embedding-2-preview', 'gemini-embedding-001']) {
        const model = GOOGLE_MODELS[modelId]
        const dimParam = model.parameterRules?.find((r) => r.name === 'dimensions')
        expect(dimParam).toBeDefined()
        expect(dimParam!.options).toContain('768')
        expect(dimParam!.options).toContain('3072')
      }
    })
  })
})
