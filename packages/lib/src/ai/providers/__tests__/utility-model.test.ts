// packages/lib/src/ai/providers/__tests__/utility-model.test.ts

import { describe, expect, it } from 'vitest'
import { blendedCostPer1kTokens } from '../../quota/model-cost'
import { ProviderRegistry } from '../provider-registry'
import { ModelType } from '../types'
import { resolveUtilityModel } from '../utility-model'

const blended = (model: string) => {
  const cost = ProviderRegistry.getModelCapabilities(model)?.costPer1kTokens
  return cost ? blendedCostPer1kTokens(cost) : Number.POSITIVE_INFINITY
}

describe('resolveUtilityModel', () => {
  it('downgrades an expensive primary (Opus) to a cheaper same-provider sibling', () => {
    const util = resolveUtilityModel({ provider: 'anthropic', model: 'claude-opus-4-6' })
    expect(util.provider).toBe('anthropic') // never crosses providers
    expect(util.model).not.toBe('claude-opus-4-6')
    const caps = ProviderRegistry.getModelCapabilities(util.model)
    expect(blended(util.model)).toBeLessThan(blended('claude-opus-4-6')) // cheaper
    expect(caps?.modelType).toBe(ModelType.LLM)
    expect(caps?.supports.structured).toBe(true) // classifiers require it
    expect(caps?.deprecated).toBeFalsy()
    expect(caps?.retired).toBeFalsy()
  })

  it('downgrades a mid-tier primary (Sonnet) to a cheaper same-provider sibling', () => {
    const util = resolveUtilityModel({ provider: 'anthropic', model: 'claude-sonnet-4-6' })
    expect(util.provider).toBe('anthropic')
    expect(blended(util.model)).toBeLessThan(blended('claude-sonnet-4-6'))
  })

  it('leaves an already-cheapest primary unchanged — nothing cheaper to pick', () => {
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
