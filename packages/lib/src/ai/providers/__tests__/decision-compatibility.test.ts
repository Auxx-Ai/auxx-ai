// packages/lib/src/ai/providers/__tests__/decision-compatibility.test.ts

import { afterEach, describe, expect, it, vi } from 'vitest'
import { getModelTypeForModel, isModelCompatible } from '../config/cache'
import { ProviderRegistry } from '../provider-registry'
import { type ModelCapabilities, ModelType } from '../types'

function fakeModel(features: string[], structured: boolean): ModelCapabilities {
  return {
    features,
    supports: {
      streaming: false,
      structured,
      vision: false,
      toolCalling: false,
      systemMessages: false,
      fileInput: false,
    },
  } as unknown as ModelCapabilities
}

function withModel(model: ModelCapabilities) {
  vi.spyOn(ProviderRegistry, 'getModelCapabilities').mockReturnValue(model)
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('isModelCompatible — DECISION', () => {
  it('accepts a native decision model', () => {
    withModel(fakeModel(['decision'], false))
    expect(isModelCompatible('jev', ModelType.DECISION)).toBe(true)
  })

  it('accepts a chat model with structured output', () => {
    withModel(fakeModel(['chat'], true))
    expect(isModelCompatible('mini', ModelType.DECISION)).toBe(true)
  })

  it('rejects a chat model without structured output', () => {
    withModel(fakeModel(['chat'], false))
    expect(isModelCompatible('legacy', ModelType.DECISION)).toBe(false)
  })

  it('rejects a non-chat model even if it claims structured output', () => {
    withModel(fakeModel(['text-embedding'], true))
    expect(isModelCompatible('embed', ModelType.DECISION)).toBe(false)
  })

  it('does not make a decision-only model an LLM', () => {
    withModel(fakeModel(['decision'], false))
    expect(isModelCompatible('jev', ModelType.LLM)).toBe(false)
  })
})

describe('getModelTypeForModel — decision', () => {
  it('infers DECISION for a decision-only model', () => {
    withModel(fakeModel(['decision'], false))
    expect(getModelTypeForModel('jev')).toBe(ModelType.DECISION)
  })

  it('still infers LLM for a structured chat model', () => {
    withModel(fakeModel(['chat'], true))
    expect(getModelTypeForModel('mini')).toBe(ModelType.LLM)
  })
})
