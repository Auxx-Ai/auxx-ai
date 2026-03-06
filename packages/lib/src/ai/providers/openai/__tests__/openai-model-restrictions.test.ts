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

describe('OpenAI model restrictions', () => {
  it('registers newer GPT-5 models', () => {
    expect(OPENAI_MODELS['gpt-5.1']).toBeDefined()
    expect(OPENAI_MODELS['gpt-5.2']).toBeDefined()
    expect(OPENAI_MODELS['gpt-5.2-chat-latest']).toBeDefined()
  })

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

  it('allows GPT-5.2 conditional params when reasoning is none', () => {
    const capabilities = OPENAI_MODELS['gpt-5.2']
    const filtered = ModelConfigService.filterParameters(
      capabilities,
      {
        reasoning_effort: 'none',
        temperature: 0.2,
        top_p: 0.8,
        logprobs: 2,
        top_logprobs: 2,
      },
      { enforceRuleAllowlist: true }
    )

    expect(filtered.temperature).toBe(0.2)
    expect(filtered.top_p).toBe(0.8)
    expect(filtered.logprobs).toBe(2)
    expect(filtered.top_logprobs).toBe(2)
  })

  it('drops top_logprobs when logprobs is absent on GPT-5.2', () => {
    const capabilities = OPENAI_MODELS['gpt-5.2']
    const filtered = ModelConfigService.filterParameters(
      capabilities,
      {
        reasoning_effort: 'none',
        top_logprobs: 5,
      },
      { enforceRuleAllowlist: true }
    )

    expect(filtered.top_logprobs).toBeUndefined()
  })

  it('has updated o-series capability flags from docs', () => {
    expect(OPENAI_MODELS.o1?.supports.streaming).toBe(true)
    expect(OPENAI_MODELS.o1?.supports.structured).toBe(true)
    expect(OPENAI_MODELS['o1-mini']?.supports.streaming).toBe(true)
    expect(OPENAI_MODELS['o1-mini']?.supports.toolCalling).toBe(false)
    expect(OPENAI_MODELS['o3-pro']?.supports.streaming).toBe(false)
  })
})
