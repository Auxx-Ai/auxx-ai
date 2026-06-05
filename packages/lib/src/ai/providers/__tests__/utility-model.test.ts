// packages/lib/src/ai/providers/__tests__/utility-model.test.ts

import { describe, expect, it } from 'vitest'
import { ProviderRegistry } from '../provider-registry'
import { ModelType } from '../types'
import { resolveUtilityModel } from '../utility-model'

describe('resolveUtilityModel', () => {
  it('downgrades a tier-5 primary (Opus) to a cheap same-provider sibling', () => {
    const util = resolveUtilityModel({ provider: 'anthropic', model: 'claude-opus-4-6' })
    expect(util.provider).toBe('anthropic') // never crosses providers
    expect(util.model).not.toBe('claude-opus-4-6')
    const caps = ProviderRegistry.getModelCapabilities(util.model)
    expect(caps?.creditMultiplier ?? 1).toBe(1) // tier-1
    expect(caps?.modelType).toBe(ModelType.LLM)
    expect(caps?.supports.structured).toBe(true) // classifiers require it
    expect(caps?.deprecated).toBeFalsy()
    expect(caps?.retired).toBeFalsy()
  })

  it('downgrades a tier-3 primary (Sonnet) to a cheap same-provider sibling', () => {
    const util = resolveUtilityModel({ provider: 'anthropic', model: 'claude-sonnet-4-6' })
    expect(util.provider).toBe('anthropic')
    expect(ProviderRegistry.getModelCapabilities(util.model)?.creditMultiplier ?? 1).toBe(1)
  })

  it('leaves an already-cheap (tier-1) primary unchanged — nothing cheaper to pick', () => {
    const primary = { provider: 'anthropic', model: 'claude-haiku-4-5-20251001' }
    expect(resolveUtilityModel(primary)).toEqual(primary)
  })

  it('leaves an unknown/custom model unchanged (best-effort, never throws)', () => {
    const primary = { provider: 'anthropic', model: 'some-self-hosted-llama' }
    expect(resolveUtilityModel(primary)).toEqual(primary)
  })

  it('never crosses provider families', () => {
    // Whatever the OpenAI primary, the utility pick stays an OpenAI model so the
    // org's existing credentials still apply.
    const util = resolveUtilityModel({ provider: 'openai', model: 'gpt-5.4-pro' })
    expect(util.provider).toBe('openai')
  })
})
