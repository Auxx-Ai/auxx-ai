// packages/lib/src/ai/providers/openai/__tests__/openai-model-restrictions.test.ts

import { describe, expect, it } from 'vitest'
import { ModelConfigService } from '../../../model-config-service'
import { ModelType } from '../../types'
import { OPENAI_MODELS } from '../openai-defaults'

/** Table of all OpenAI LLM models for model-by-model checks. */
const OPENAI_LLM_MODELS = Object.entries(OPENAI_MODELS).filter(
  ([_, capabilities]) => capabilities.modelType === ModelType.LLM
)

/** Returns the strict allowlist of parameter names for a model. */
function getAllowedParameterNames(modelId: string): Set<string> {
  const capabilities = OPENAI_MODELS[modelId]
  if (!capabilities) {
    throw new Error(`Missing model capabilities for ${modelId}`)
  }

  const names = new Set(capabilities.parameterRules.map((rule) => rule.name))

  for (const mappedName of Object.values(
    capabilities.parameterRestrictions?.parameterMapping || {}
  )) {
    names.add(mappedName)
  }

  return names
}

/** All deprecated models for batch testing. */
const DEPRECATED_MODELS = [
  'gpt-4-turbo',
  'chatgpt-4o-latest',
  'o1-preview',
  'o1-preview-2024-09-12',
  'o1-mini',
  'o1-mini-2024-09-12',
  'text-moderation-stable',
  'text-embedding-ada-002',
  'gpt-5.1',
]

/** All o-series LLM models. */
const O_SERIES_MODELS = [
  'o4-mini',
  'o4-mini-2025-04-16',
  'o3',
  'o3-2025-04-16',
  'o3-mini',
  'o3-mini-2025-01-31',
  'o3-pro',
  'o3-pro-2025-06-10',
  'o1',
]

describe('OpenAI model restrictions', () => {
  // ── Registration ────────────────────────────────────────────────

  it('registers GPT-5.4 models', () => {
    expect(OPENAI_MODELS['gpt-5.4']).toBeDefined()
    expect(OPENAI_MODELS['gpt-5.4-mini']).toBeDefined()
    expect(OPENAI_MODELS['gpt-5.4-nano']).toBeDefined()
    expect(OPENAI_MODELS['gpt-5.4-pro']).toBeDefined()
  })

  it('registers GPT-5.3 models', () => {
    expect(OPENAI_MODELS['gpt-5.3-chat-latest']).toBeDefined()
    expect(OPENAI_MODELS['gpt-5.3-codex']).toBeDefined()
  })

  it('registers GPT-5.2 and earlier models', () => {
    expect(OPENAI_MODELS['gpt-5.1']).toBeDefined()
    expect(OPENAI_MODELS['gpt-5.2']).toBeDefined()
    expect(OPENAI_MODELS['gpt-5.2-chat-latest']).toBeDefined()
  })

  // ── Strict parameter allowlist (every LLM model) ───────────────

  it.each(
    OPENAI_LLM_MODELS
  )('enforces strict parameter allowlist for %s', (modelId, capabilities) => {
    const inputParameters = {
      __unknown__: 'drop-me',
      max_tokens: 512,
      reasoning_effort: 'high',
      verbosity: 'medium',
      temperature: 0.2,
      top_p: 0.9,
      logprobs: 2,
      top_logprobs: 2,
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

  // ── Legacy GPT-5 (no conditional sampling) ─────────────────────

  it('drops sampling/logprob params for legacy GPT-5 models', () => {
    const capabilities = OPENAI_MODELS['gpt-5']
    const filtered = ModelConfigService.filterParameters(
      capabilities,
      {
        reasoning_effort: 'high',
        verbosity: 'medium',
        max_tokens: 1000,
        temperature: 0.2,
        top_p: 0.8,
        logprobs: 2,
        top_logprobs: 2,
      },
      { enforceRuleAllowlist: true }
    )

    expect(filtered.temperature).toBeUndefined()
    expect(filtered.top_p).toBeUndefined()
    expect(filtered.logprobs).toBeUndefined()
    expect(filtered.top_logprobs).toBeUndefined()
    expect(filtered.max_completion_tokens).toBe(1000)
  })

  // ── GPT-5.2 conditional params ─────────────────────────────────

  it('enforces GPT-5.2 conditional params when reasoning is not none', () => {
    const capabilities = OPENAI_MODELS['gpt-5.2']
    const filtered = ModelConfigService.filterParameters(
      capabilities,
      {
        reasoning_effort: 'medium',
        temperature: 0.2,
        top_p: 0.8,
        logprobs: 2,
        top_logprobs: 2,
      },
      { enforceRuleAllowlist: true }
    )

    expect(filtered.temperature).toBeUndefined()
    expect(filtered.top_p).toBeUndefined()
    expect(filtered.logprobs).toBeUndefined()
    expect(filtered.top_logprobs).toBeUndefined()
  })

  it('strips sampling params for GPT-5.2 when reasoning is active', () => {
    const capabilities = OPENAI_MODELS['gpt-5.2']
    const filtered = ModelConfigService.filterParameters(
      capabilities,
      {
        reasoning_effort: 'low',
        temperature: 0.2,
        top_p: 0.8,
        logprobs: 2,
        top_logprobs: 2,
      },
      { enforceRuleAllowlist: true }
    )

    // Sampling params are stripped when reasoning is active (none is not supported for GPT-5.2+)
    expect(filtered.temperature).toBeUndefined()
    expect(filtered.top_p).toBeUndefined()
    expect(filtered.logprobs).toBeUndefined()
    expect(filtered.top_logprobs).toBeUndefined()
    expect(filtered.reasoning_effort).toBe('low')
  })

  it('drops top_logprobs when logprobs is absent on GPT-5.2', () => {
    const capabilities = OPENAI_MODELS['gpt-5.2']
    const filtered = ModelConfigService.filterParameters(
      capabilities,
      {
        reasoning_effort: 'low',
        top_logprobs: 5,
      },
      { enforceRuleAllowlist: true }
    )

    expect(filtered.top_logprobs).toBeUndefined()
  })

  // ── GPT-5.4 conditional params ─────────────────────────────────

  it('strips sampling params for GPT-5.4 when reasoning is active', () => {
    const capabilities = OPENAI_MODELS['gpt-5.4']
    const filtered = ModelConfigService.filterParameters(
      capabilities,
      {
        reasoning_effort: 'high',
        temperature: 0.5,
        top_p: 0.9,
        logprobs: 3,
        top_logprobs: 3,
      },
      { enforceRuleAllowlist: true }
    )

    expect(filtered.temperature).toBeUndefined()
    expect(filtered.top_p).toBeUndefined()
    expect(filtered.logprobs).toBeUndefined()
    expect(filtered.top_logprobs).toBeUndefined()
    expect(filtered.reasoning_effort).toBe('high')
  })

  it('strips sampling params for GPT-5.4-nano when reasoning is active', () => {
    const capabilities = OPENAI_MODELS['gpt-5.4-nano']
    const filtered = ModelConfigService.filterParameters(
      capabilities,
      {
        reasoning_effort: 'low',
        temperature: 0.7,
        top_p: 0.95,
      },
      { enforceRuleAllowlist: true }
    )

    // Sampling params are stripped when reasoning is active (none is not supported for GPT-5.4+)
    expect(filtered.temperature).toBeUndefined()
    expect(filtered.top_p).toBeUndefined()
    expect(filtered.reasoning_effort).toBe('low')
  })

  it('GPT-5.4-pro has structured: false and restricted reasoning levels', () => {
    const pro = OPENAI_MODELS['gpt-5.4-pro']
    expect(pro.supports.structured).toBe(false)

    // Only medium/high/xhigh — no none or low
    const reasoningRule = pro.parameterRules.find((r) => r.name === 'reasoning_effort')
    expect(reasoningRule?.options).toEqual(['medium', 'high', 'xhigh'])
  })

  it('GPT-5.3-codex has no none reasoning level', () => {
    const codex = OPENAI_MODELS['gpt-5.3-codex']
    const reasoningRule = codex.parameterRules.find((r) => r.name === 'reasoning_effort')
    expect(reasoningRule?.options).toEqual(['low', 'medium', 'high', 'xhigh'])
    expect(reasoningRule?.options).not.toContain('none')
  })

  it('strips sampling params for GPT-5.3-chat-latest when reasoning is active', () => {
    const capabilities = OPENAI_MODELS['gpt-5.3-chat-latest']
    const filtered = ModelConfigService.filterParameters(
      capabilities,
      {
        reasoning_effort: 'low',
        temperature: 0.5,
        top_p: 0.9,
      },
      { enforceRuleAllowlist: true }
    )

    expect(filtered.temperature).toBeUndefined()
    expect(filtered.top_p).toBeUndefined()
  })

  // ── O-series reasoning models ──────────────────────────────────

  it.each(
    O_SERIES_MODELS
  )('%s has isReasoningModel and max_completion_tokens mapping', (modelId) => {
    const caps = OPENAI_MODELS[modelId]
    expect(caps).toBeDefined()
    expect(caps.parameterRestrictions?.isReasoningModel).toBe(true)
    expect(caps.parameterRestrictions?.parameterMapping?.max_tokens).toBe('max_completion_tokens')
  })

  it.each(O_SERIES_MODELS)('%s strips temperature/top_p via unsupportedParams', (modelId) => {
    const caps = OPENAI_MODELS[modelId]
    expect(caps.parameterRestrictions?.unsupportedParams).toContain('temperature')
    expect(caps.parameterRestrictions?.unsupportedParams).toContain('top_p')
  })

  it('has updated o-series capability flags from docs', () => {
    expect(OPENAI_MODELS.o1?.supports.streaming).toBe(true)
    expect(OPENAI_MODELS.o1?.supports.structured).toBe(true)
    expect(OPENAI_MODELS['o1-mini']?.supports.streaming).toBe(true)
    expect(OPENAI_MODELS['o1-mini']?.supports.toolCalling).toBe(false)
    expect(OPENAI_MODELS['o3-pro']?.supports.streaming).toBe(false)
  })

  // ── Deprecated models ──────────────────────────────────────────

  it.each(DEPRECATED_MODELS)('%s is marked as deprecated or retired', (modelId) => {
    const caps = OPENAI_MODELS[modelId]
    expect(caps).toBeDefined()
    expect(caps.deprecated === true || caps.retired === true).toBe(true)
  })

  // ── GPT-5.4 pricing ────────────────────────────────────────────

  it('GPT-5.4 models have correct pricing', () => {
    expect(OPENAI_MODELS['gpt-5.4'].costPer1kTokens).toEqual({ input: 0.0025, output: 0.015 })
    expect(OPENAI_MODELS['gpt-5.4-mini'].costPer1kTokens).toEqual({
      input: 0.00075,
      output: 0.0045,
    })
    expect(OPENAI_MODELS['gpt-5.4-nano'].costPer1kTokens).toEqual({
      input: 0.0002,
      output: 0.00125,
    })
    expect(OPENAI_MODELS['gpt-5.4-pro'].costPer1kTokens).toEqual({ input: 0.03, output: 0.18 })
  })
})
