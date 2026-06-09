// packages/lib/src/ai/quota/estimate-cost.ts

import type { UsageMetrics } from '../clients/base/types'
import { ProviderRegistry } from '../providers/provider-registry'

/**
 * Prompt-cache price multipliers relative to a model's base input price, keyed
 * by provider. Cached reads are heavily discounted; cache writes carry a premium
 * on Anthropic. These are list-price ratios, not our negotiated rate.
 */
const CACHE_PRICE_MULTIPLIERS: Record<string, { read: number; write: number }> = {
  // Anthropic: cached reads 0.1x base input; 5-minute ephemeral writes 1.25x.
  anthropic: { read: 0.1, write: 1.25 },
  // OpenAI: cached reads ~0.5x; cache population is billed as normal input
  // (it's already inside prompt_tokens), so the write multiplier is a no-op.
  openai: { read: 0.5, write: 1.0 },
}
const DEFAULT_CACHE_MULTIPLIER = { read: 1, write: 1 }

/**
 * Estimate the provider COGS (USD, list price) for a single LLM call, accounting
 * for prompt-cache read/write pricing. Returns `undefined` when the model has no
 * registry pricing so callers can leave `cost` null rather than store a wrong 0.
 *
 * Provider token semantics differ and are normalized here:
 * - Anthropic `prompt_tokens` EXCLUDES both cache reads and writes (they arrive
 *   as separate counts), so it already is the uncached input.
 * - OpenAI `prompt_tokens` INCLUDES cached reads, so the uncached portion is
 *   `prompt_tokens - cached_input_tokens` and there is no separate write count.
 */
export function estimateUsageCostUsd(
  provider: string,
  model: string,
  usage: UsageMetrics
): number | undefined {
  const price = ProviderRegistry.getModelCapabilities(model)?.costPer1kTokens
  if (!price) return undefined

  const key = provider.toLowerCase()
  const mult = CACHE_PRICE_MULTIPLIERS[key] ?? DEFAULT_CACHE_MULTIPLIER
  const output = usage.completion_tokens || 0
  const cachedInput = usage.cached_input_tokens || 0
  const cacheWrite = usage.cache_write_tokens || 0
  const includesCached = key.includes('openai')
  const uncachedInput = includesCached
    ? Math.max(0, (usage.prompt_tokens || 0) - cachedInput)
    : usage.prompt_tokens || 0

  const inputUnits = uncachedInput + cacheWrite * mult.write + cachedInput * mult.read
  return (inputUnits * price.input + output * price.output) / 1000
}
