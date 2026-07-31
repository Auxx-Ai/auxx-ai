// packages/lib/src/ai/providers/deepseek/__tests__/deepseek-model-restrictions.test.ts

import { describe, expect, it } from 'vitest'
import { ModelConfigService } from '../../../model-config-service'
import { type ModelCapabilities, ModelType } from '../../types'
import { DEEPSEEK_MODELS } from '../deepseek-defaults'

const DEEPSEEK_LLM_MODELS = Object.entries(DEEPSEEK_MODELS).filter(
  ([_, capabilities]) => capabilities.modelType === ModelType.LLM
)

/**
 * Registry lookup that fails the test loudly when a model is missing, instead of
 * letting every downstream assertion read as `undefined`.
 */
function getModel(modelId: string): ModelCapabilities {
  const capabilities = DEEPSEEK_MODELS[modelId]
  if (!capabilities) {
    throw new Error(`Missing model capabilities for ${modelId}`)
  }
  return capabilities
}

function getAllowedParameterNames(modelId: string): Set<string> {
  const capabilities = getModel(modelId)

  const names = new Set(capabilities.parameterRules.map((rule) => rule.name))

  for (const mappedName of Object.values(
    capabilities.parameterRestrictions?.parameterMapping || {}
  )) {
    names.add(mappedName)
  }

  return names
}

describe('DeepSeek model restrictions', () => {
  // ── Registration ────────────────────────────────────────────────

  it('registers deepseek-chat', () => {
    const model = getModel('deepseek-chat')
    expect(model.modelId).toBe('deepseek-chat')
    expect(model.provider).toBe('deepseek')
  })

  it('registers deepseek-reasoner', () => {
    const model = getModel('deepseek-reasoner')
    expect(model.modelId).toBe('deepseek-reasoner')
    expect(model.provider).toBe('deepseek')
  })

  // ── Context & token limits ─────────────────────────────────────

  it('deepseek-chat has 128k context and 8192 max output', () => {
    const model = getModel('deepseek-chat')
    expect(model.contextLength).toBe(128000)
    expect(model.maxTokens).toBe(8192)
  })

  it('deepseek-reasoner has 128k context and 64k max output', () => {
    const model = getModel('deepseek-reasoner')
    expect(model.contextLength).toBe(128000)
    expect(model.maxTokens).toBe(64000)
  })

  // ── Capabilities ───────────────────────────────────────────────

  it('both models support tool calling', () => {
    expect(getModel('deepseek-chat').supports.toolCalling).toBe(true)
    expect(getModel('deepseek-reasoner').supports.toolCalling).toBe(true)
  })

  it('both models support structured output', () => {
    expect(getModel('deepseek-chat').supports.structured).toBe(true)
    expect(getModel('deepseek-reasoner').supports.structured).toBe(true)
  })

  it('both models support streaming', () => {
    expect(getModel('deepseek-chat').supports.streaming).toBe(true)
    expect(getModel('deepseek-reasoner').supports.streaming).toBe(true)
  })

  it('neither model supports vision', () => {
    expect(getModel('deepseek-chat').supports.vision).toBe(false)
    expect(getModel('deepseek-reasoner').supports.vision).toBe(false)
  })

  // ── Pricing ────────────────────────────────────────────────────

  it('both models have cost per 1k tokens', () => {
    expect(getModel('deepseek-chat').costPer1kTokens).toEqual({
      input: 0.00014,
      output: 0.00028,
      cachedInput: 0.0000028,
    })
    expect(getModel('deepseek-reasoner').costPer1kTokens).toEqual({
      input: 0.00014,
      output: 0.00028,
      cachedInput: 0.0000028,
    })
  })

  // ── Reasoning model restrictions ───────────────────────────────

  it('deepseek-reasoner is marked as reasoning model', () => {
    const caps = getModel('deepseek-reasoner')
    expect(caps.parameterRestrictions?.isReasoningModel).toBe(true)
  })

  it('deepseek-chat is NOT marked as reasoning model', () => {
    const caps = getModel('deepseek-chat')
    expect(caps.parameterRestrictions?.isReasoningModel).toBeUndefined()
  })

  it('deepseek-reasoner unsupported params include sampling params', () => {
    const caps = getModel('deepseek-reasoner')
    expect(caps.parameterRestrictions?.unsupportedParams).toContain('temperature')
    expect(caps.parameterRestrictions?.unsupportedParams).toContain('top_p')
    expect(caps.parameterRestrictions?.unsupportedParams).toContain('presence_penalty')
    expect(caps.parameterRestrictions?.unsupportedParams).toContain('frequency_penalty')
  })

  it('deepseek-reasoner only allows max_tokens as supported param', () => {
    const caps = getModel('deepseek-reasoner')
    expect(caps.parameterRestrictions?.supportedParams).toEqual(['max_tokens'])
  })

  // ── Parameter rules ────────────────────────────────────────────

  it('deepseek-chat has temperature with max 2', () => {
    const rule = getModel('deepseek-chat').parameterRules.find((r) => r.name === 'temperature')
    expect(rule).toBeDefined()
    expect(rule?.max).toBe(2)
    expect(rule?.default).toBe(1)
  })

  it('deepseek-chat has all sampling parameters', () => {
    const ruleNames = getModel('deepseek-chat').parameterRules.map((r) => r.name)
    expect(ruleNames).toContain('temperature')
    expect(ruleNames).toContain('topP')
    expect(ruleNames).toContain('frequencyPenalty')
    expect(ruleNames).toContain('presencePenalty')
    expect(ruleNames).toContain('maxOutputTokens')
  })

  it('deepseek-reasoner only has maxOutputTokens parameter rule', () => {
    const ruleNames = getModel('deepseek-reasoner').parameterRules.map((r) => r.name)
    expect(ruleNames).toEqual(['maxOutputTokens'])
  })

  it('deepseek-reasoner maxOutputTokens has correct range', () => {
    const rule = getModel('deepseek-reasoner').parameterRules.find(
      (r) => r.name === 'maxOutputTokens'
    )
    expect(rule?.max).toBe(64000)
    expect(rule?.default).toBe(32000)
  })

  // ── Strict parameter allowlist (every LLM model) ──────────────

  it.each(
    DEEPSEEK_LLM_MODELS
  )('enforces strict parameter allowlist for %s', (modelId, capabilities) => {
    const inputParameters = {
      __unknown__: 'drop-me',
      max_tokens: 512,
      temperature: 0.5,
      top_p: 0.9,
    }

    const withDefaults = ModelConfigService.applyDefaults(capabilities, inputParameters)
    const validated = ModelConfigService.validateParameters(capabilities, withDefaults)
    const filtered = ModelConfigService.filterParameters(capabilities, validated, {
      enforceRuleAllowlist: true,
    })
    const allowedNames = getAllowedParameterNames(modelId)

    expect(filtered.__unknown__).toBeUndefined()
    expect(Object.keys(filtered).every((key) => allowedNames.has(key))).toBe(true)
  })

  it('deepseek-reasoner strips sampling params via filterParameters', () => {
    const capabilities = getModel('deepseek-reasoner')
    const filtered = ModelConfigService.filterParameters(
      capabilities,
      {
        temperature: 0.5,
        top_p: 0.8,
        presence_penalty: 0.5,
        frequency_penalty: 0.5,
        max_tokens: 1000,
      },
      { enforceRuleAllowlist: true }
    )

    expect(filtered.temperature).toBeUndefined()
    expect(filtered.top_p).toBeUndefined()
    expect(filtered.presence_penalty).toBeUndefined()
    expect(filtered.frequency_penalty).toBeUndefined()
  })

  // ── Features ───────────────────────────────────────────────────

  it('deepseek-chat has chat and code features', () => {
    expect(getModel('deepseek-chat').features).toEqual(['chat', 'code'])
  })

  it('deepseek-reasoner has chat, reasoning, and code features', () => {
    expect(getModel('deepseek-reasoner').features).toEqual(['chat', 'reasoning', 'code'])
  })
})
