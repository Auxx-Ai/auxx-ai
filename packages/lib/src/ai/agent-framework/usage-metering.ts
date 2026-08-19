// packages/lib/src/ai/agent-framework/usage-metering.ts

import type { UsageMetrics } from '../clients/base/types'

/**
 * Providers whose `prompt_tokens` **excludes** cached reads and cache writes,
 * reporting them as separate counts instead.
 *
 * Anthropic is the only one: `anthropic-llm-client` builds `prompt_tokens` from
 * `usage.input_tokens`, which the API defines as the uncached remainder, and
 * carries `cache_read_input_tokens` / `cache_creation_input_tokens` alongside.
 *
 * Every other provider in the registry (openai, google, groq, deepseek, qwen,
 * kimi, zai, grok) routes through the single `OpenAILLMClient.convertUsage`,
 * where `prompt_tokens` INCLUDES the cached portion and `cached_input_tokens`
 * is a subset of it rather than an addend — so the rule is stated as "Anthropic
 * is the exception" rather than "OpenAI is the special case". A substring test
 * for `openai` would silently treat the six OpenAI-shaped vendors as
 * cache-separate and double-count their cached prefix.
 */
const PROMPT_EXCLUDES_CACHED_PROVIDERS: ReadonlySet<string> = new Set(['anthropic'])

/** True when the provider's `prompt_tokens` already contains its cached reads. */
export function promptIncludesCachedReads(provider: string | undefined): boolean {
  return !PROMPT_EXCLUDES_CACHED_PROVIDERS.has((provider ?? '').toLowerCase())
}

/** Provider-neutral view of one LLM call's token usage. */
export interface NormalizedCallUsage {
  /** `prompt_tokens` exactly as the provider reported it. */
  promptInput: number
  /** Input served from the provider's prompt cache. */
  cachedInput: number
  /** Input written to the provider's prompt cache on this call. */
  cacheWrite: number
  /** `completion_tokens` as reported. */
  completion: number
  /** Every input token presented to the model, cached prefix included. */
  totalInput: number
  /**
   * Input the provider actually had to process — i.e. what counts toward its
   * input rate limit. Cached reads are free on the providers we use; cache
   * writes are not.
   */
  rateLimitInput: number
  /**
   * The per-turn budget unit: `rateLimitInput + completion`. Charges for work
   * that is genuinely new, so re-sending a cached conversation prefix on every
   * tool round-trip costs nothing. Falls back to `prompt + completion` when the
   * provider reports no cache fields at all.
   */
  meteredTokens: number
  /** Which of the two provider semantics was applied. */
  includesCached: boolean
}

/** Coerce a reported count to a usable non-negative number (never NaN). */
function count(value: number | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0
}

/**
 * Normalize one LLM call's `UsageMetrics` into provider-neutral totals.
 *
 * This exists because the two provider semantics disagree about what
 * `prompt_tokens` contains, and the disagreement used to live inside
 * `llm-adapter`'s log block — so the numbers we *logged* and the numbers the
 * turn budget *metered* were computed from different formulas. Both now call
 * here, and they cannot drift.
 *
 * When a provider reports neither cache field both branches collapse to
 * `prompt + completion`, which is the documented fallback: never `NaN`, and
 * never a silent `0` — a zero would disable the turn budget outright, which is
 * the worst available failure mode.
 */
export function normalizeCallUsage(
  usage: UsageMetrics | undefined,
  provider?: string
): NormalizedCallUsage {
  const promptInput = count(usage?.prompt_tokens)
  const cachedInput = count(usage?.cached_input_tokens)
  const cacheWrite = count(usage?.cache_write_tokens)
  const completion = count(usage?.completion_tokens)
  const includesCached = promptIncludesCachedReads(provider)

  const totalInput = includesCached
    ? promptInput + cacheWrite
    : promptInput + cachedInput + cacheWrite
  // `Math.max` guards the subtraction: a provider that reports more cached
  // tokens than prompt tokens must not produce a negative charge.
  const rateLimitInput = includesCached
    ? Math.max(0, promptInput - cachedInput) + cacheWrite
    : promptInput + cacheWrite

  return {
    promptInput,
    cachedInput,
    cacheWrite,
    completion,
    totalInput,
    rateLimitInput,
    meteredTokens: rateLimitInput + completion,
    includesCached,
  }
}

/**
 * The metered charge for a usage roll-up whose provider is unknown.
 *
 * A roll-up sums calls that may have come from different providers, so neither
 * cache semantics can be applied soundly — `prompt + completion` is the
 * documented fallback. Reachable only when an assistant message finishes with a
 * usage roll-up but no per-call `IterationUsage` records, which the query loop
 * builds under the same condition the roll-up accumulates under; the meter
 * prefers the per-call records precisely because they keep the provider.
 */
export function meterRollupTokens(usage: UsageMetrics | undefined): number {
  return count(usage?.prompt_tokens) + count(usage?.completion_tokens)
}
