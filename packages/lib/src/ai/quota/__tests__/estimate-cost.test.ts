// packages/lib/src/ai/quota/__tests__/estimate-cost.test.ts

import { describe, expect, it, vi } from 'vitest'
import { estimateUsageCostUsd } from '../estimate-cost'

const PRICES: Record<string, object> = {
  // Anthropic-style: explicit cache prices ($3/M in, $15/M out, $0.30/M read, $3.75/M write)
  'sonnet-like': {
    input: 0.003,
    output: 0.015,
    cachedInput: 0.0003,
    cacheWrite: 0.00375,
  },
  // OpenAI-style without per-model cache prices — falls back to multipliers
  'gpt-legacy': { input: 0.001, output: 0.004 },
  // OpenAI-style with explicit cached price ($0.05/M in, $0.005/M cached, $0.40/M out)
  'gpt-nano-like': { input: 0.00005, output: 0.0004, cachedInput: 0.000005 },
  // Tiered: base + >200k tier at 2x input / 1.5x output
  tiered: {
    input: 0.00125,
    output: 0.01,
    cachedInput: 0.0003125,
    longContext: [{ over: 200_000, input: 0.0025, output: 0.015, cachedInput: 0.000625 }],
  },
}

vi.mock('../../providers/provider-registry', () => ({
  ProviderRegistry: {
    getModelCapabilities: (model: string) =>
      PRICES[model] ? { costPer1kTokens: PRICES[model] } : null,
  },
}))

describe('estimateUsageCostUsd', () => {
  it('returns undefined for unpriced models', () => {
    expect(
      estimateUsageCostUsd('openai', 'unknown', { prompt_tokens: 100, completion_tokens: 10 })
    ).toBeUndefined()
  })

  it('uses per-model cache prices when present (Anthropic semantics: prompt excludes cache)', () => {
    const cost = estimateUsageCostUsd('anthropic', 'sonnet-like', {
      prompt_tokens: 1000,
      completion_tokens: 1000,
      cached_input_tokens: 1000,
      cache_write_tokens: 1000,
    })
    // 1k uncached*0.003 + 1k write*0.00375 + 1k read*0.0003 + 1k out*0.015, per 1k
    expect(cost).toBeCloseTo(0.003 + 0.00375 + 0.0003 + 0.015, 10)
  })

  it('treats OpenAI prompt_tokens as inclusive of cached reads', () => {
    const cost = estimateUsageCostUsd('openai', 'gpt-nano-like', {
      prompt_tokens: 2000, // 1k cached + 1k uncached
      completion_tokens: 1000,
      cached_input_tokens: 1000,
    })
    expect(cost).toBeCloseTo(0.00005 + 0.000005 + 0.0004, 10)
  })

  it('falls back to provider multipliers when the model has no cache prices', () => {
    const cost = estimateUsageCostUsd('openai', 'gpt-legacy', {
      prompt_tokens: 2000,
      completion_tokens: 0,
      cached_input_tokens: 1000,
    })
    // 1k uncached at 0.001 + 1k cached at 0.1x
    expect(cost).toBeCloseTo(0.001 + 0.0001, 10)
  })

  it('bills at base tier below the long-context threshold', () => {
    const cost = estimateUsageCostUsd('google', 'tiered', {
      prompt_tokens: 100_000,
      completion_tokens: 1000,
    })
    expect(cost).toBeCloseTo(100 * 0.00125 + 0.01, 10)
  })

  it('bills the whole call at the higher tier once total input crosses the threshold', () => {
    const cost = estimateUsageCostUsd('google', 'tiered', {
      prompt_tokens: 300_000,
      completion_tokens: 1000,
      cached_input_tokens: 100_000,
    })
    // total input 300k (google semantics: prompt excludes cached → 300k + 100k = 400k > 200k)
    // 300k uncached*0.0025 + 100k cached*0.000625 + 1k out*0.015, per 1k
    expect(cost).toBeCloseTo(300 * 0.0025 + 100 * 0.000625 + 0.015, 10)
  })
})
